import { ParseError, ParseErrorCode } from '../parse/parse-error';
import type { CaptionsParser, CaptionsParserInit, ParsedCaptionsResult } from '../parse/types';
import { replaceHTMLEntities } from '../vtt/tokenize-cue';
import { VTTCue } from '../vtt/vtt-cue';

const TAG_RE = /<(\/?)([a-zA-Z][\w:-]*)\s*([^>]*)>/y,
  ATTR_RE = /([^\s="'>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g,
  // `.ENCC { Name: English; lang: en-US; SAMIType: CC; }` class rules in the `<STYLE>` block.
  CLASS_RULE_RE = /\.([\w-]+)\s*\{([^}]*)\}/g,
  // The bare `P { ... }` rule that applies to every paragraph.
  P_RULE_RE = /(?:^|[\s,}>])p\s*\{([^}]*)\}/i,
  // Lookbehind keeps the scan linear on long runs of word characters.
  DECL_RE = /(?<![\w-])([\w-]+)\s*:\s*([^;]+)/g,
  MARKUP_RE = /<[^<>]*>/g,
  // HTML whitespace (`&nbsp;` decodes to U+00A0 and is deliberately preserved).
  WS_RE = /[ \t\n\r\f]+/g,
  TRAILING_SPACE_RE = / ((?:<\/[a-z]+>)*)$/,
  NBSP_RE = /\u00a0/g,
  AMP_RE = /&/g,
  LT_RE = /</g,
  TIME_RE = /^\d+(?:\.\d+)?$/,
  HEX_COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i,
  BARE_HEX_COLOR_RE = /^(?:[0-9a-f]{6}|[0-9a-f]{8})$/i,
  ALIGNS = /*#__PURE__*/ new Set(['left', 'center', 'right']),
  VTT_COLORS = /*#__PURE__*/ new Set([
    'white',
    'lime',
    'cyan',
    'red',
    'yellow',
    'magenta',
    'blue',
    'black',
  ]),
  // HTML colour names commonly used in SAMI files that are not part of the WebVTT palette.
  HTML_COLORS = {
    green: '#008000',
    orange: '#ffa500',
    purple: '#800080',
    gray: '#808080',
    grey: '#808080',
    silver: '#c0c0c0',
    pink: '#ffc0cb',
    gold: '#ffd700',
    brown: '#a52a2a',
    navy: '#000080',
    teal: '#008080',
    olive: '#808000',
    maroon: '#800000',
    aqua: '#00ffff',
    fuchsia: '#ff00ff',
  },
  // Inline HTML formatting mapped onto WebVTT tags; everything else is dropped.
  FORMAT_TAGS = { b: 'b', strong: 'b', i: 'i', em: 'i', u: 'u' },
  /** Duration of a cue that is never cleared, measured from the last `<SYNC>` in the file. */
  DEFAULT_CUE_DURATION = 5;

/** A language class declared in the `<STYLE>` block (e.g., `.ENCC { Name: English; lang: en-US; }`). */
interface SAMIClass {
  name?: string;
  lang?: string;
  type?: string;
  align?: string;
}

/** A `<P>` inside a `<SYNC>`: the caption for `cls` from `time` until the class is next synced. */
interface SAMIEvent {
  time: number;
  /** Class name as written in the document (becomes `cue.id`). */
  cls: string;
  /** Lower-cased class name; SAMI class references are matched case-insensitively. */
  key: string;
  /** WebVTT cue text; empty when the paragraph clears the class (`&nbsp;`). */
  text: string;
}

/** The `<P>` currently being collected. */
interface Paragraph {
  cls: string;
  text: string;
  /** Open formatting tags, innermost last. */
  stack: { kind: string; open: string }[];
  /** Whether the current line is empty or ends with a space (collapses HTML whitespace). */
  trailingSpace: boolean;
}

/**
 * Parses SAMI (Synchronized Accessible Media Interchange, `.smi`) documents.
 *
 * SAMI is HTML-like and rarely well-formed, so the whole document is buffered and scanned with a
 * tolerant tag scanner rather than a DOM. Each `<SYNC Start=ms>` marks a time, each `<P Class=X>`
 * inside it sets the text shown for language class `X` from that time until the next `<SYNC>`
 * that contains a `<P>` of the same class. A paragraph that is empty or only `&nbsp;` clears the
 * class. A class that is never cleared ends 5 seconds after the last `<SYNC>` in the file.
 *
 * All language classes are emitted. Each cue's `id` is its class name and, when the class
 * declares a `lang` in the `<STYLE>` block, its text is wrapped in `<lang xx>...</lang>`, so
 * consumers pick one language by filtering on `cue.id` or on the `lang` span. The declared
 * languages are reported as `metadata.Languages` (comma-separated) alongside `metadata.Title`.
 */
export class SAMIParser implements CaptionsParser {
  protected _init!: CaptionsParserInit;
  protected _lines: string[] = [];
  protected _classes: Record<string, SAMIClass> = {};
  protected _align: string | undefined;
  protected _metadata: Record<string, string> = {};
  protected _events: SAMIEvent[] = [];
  protected _cues: VTTCue[] = [];
  protected _errors: ParseError[] = [];
  protected _done = false;

  init(init: CaptionsParserInit) {
    this._init = init;
  }

  parse(line: string) {
    // Tags span lines freely so the whole document is buffered.
    this._lines.push(line);
  }

  done(cancelled: boolean): ParsedCaptionsResult {
    if (!cancelled && !this._done) {
      this._done = true;
      this._parseDocument(this._lines.join('\n'));
      this._lines = [];
    }

    return {
      metadata: this._metadata,
      regions: [],
      cues: this._cues,
      errors: this._errors,
    };
  }

  protected _parseDocument(src: string) {
    let i = 0,
      line = 1,
      linePos = 0,
      sawSAMI = false,
      sawBody = false,
      sync: number | null = null,
      lastSync = -1,
      p = null as Paragraph | null;

    const lineAt = (pos: number) => {
      while (linePos < pos) {
        if (src.charCodeAt(linePos) === 10) line++;
        linePos++;
      }
      return line;
    };

    const flushParagraph = () => {
      if (!p) return;
      this._pushEvent(sync!, p);
      p = null;
    };

    const openParagraph = (cls: string) => {
      flushParagraph();
      p = { cls, text: '', stack: [], trailingSpace: true };
    };

    const appendText = (chunk: string) => {
      if (sync === null) return;
      let text = replaceHTMLEntities(chunk).replace(WS_RE, ' ');
      // Text directly inside `<SYNC>` without a `<P>` is tolerated as an anonymous paragraph.
      if (!p) {
        if (text.trim() === '') return;
        openParagraph('');
      }
      if (p!.trailingSpace && text[0] === ' ') text = text.slice(1);
      if (!text) return;
      p!.text += escapeText(text);
      p!.trailingSpace = text[text.length - 1] === ' ';
    };

    while (i < src.length) {
      const lt = src.indexOf('<', i);

      if (lt < 0) {
        appendText(src.slice(i));
        break;
      }

      if (lt > i) appendText(src.slice(i, lt));

      if (src.startsWith('<!--', lt)) {
        const end = src.indexOf('-->', lt + 4);
        i = end < 0 ? src.length : end + 3;
        continue;
      }

      const next = src.charCodeAt(lt + 1);
      // `<!DOCTYPE ...>` and processing instructions.
      if (next === 33 /* ! */ || next === 63 /* ? */) {
        const end = src.indexOf('>', lt);
        i = end < 0 ? src.length : end + 1;
        continue;
      }

      TAG_RE.lastIndex = lt;
      const match = TAG_RE.exec(src);

      // A stray `<` (e.g., `<3`) is text.
      if (!match) {
        appendText('<');
        i = lt + 1;
        continue;
      }

      i = TAG_RE.lastIndex;

      const closing = match[1] === '/',
        name = match[2].toLowerCase(),
        format = FORMAT_TAGS[name];

      if (format) {
        if (p) {
          if (closing) closeTag(p, format);
          else openTag(p, format, `<${format}>`);
        }
        continue;
      }

      switch (name) {
        case 'sami':
          sawSAMI = true;
          break;
        case 'body':
          if (closing) {
            flushParagraph();
            sync = null;
          } else {
            sawBody = true;
          }
          break;
        case 'style':
          if (!closing) {
            const [content, end] = readRawContent(src, i, 'style');
            this._parseStyle(content);
            i = end;
          }
          break;
        case 'title':
          if (!closing) {
            const [content, end] = readRawContent(src, i, 'title'),
              title = replaceHTMLEntities(content).replace(WS_RE, ' ').trim();
            if (title) this._metadata.Title = title;
            i = end;
          }
          break;
        case 'sync': {
          flushParagraph();
          if (closing) {
            sync = null;
            break;
          }
          const attrs = parseAttributes(match[3]),
            start = attrs.start;
          if (start === undefined || !TIME_RE.test(start)) {
            const lineCount = lineAt(lt);
            this._handleError(
              ParseErrorCode.BadTimestamp,
              `sync start \`${start ?? ''}\` is invalid on line ${lineCount}`,
              lineCount,
            );
            sync = null;
            break;
          }
          sync = parseFloat(start) / 1000;
          if (sync > lastSync) lastSync = sync;
          break;
        }
        case 'p':
          flushParagraph();
          if (!closing && sync !== null) {
            const attrs = parseAttributes(match[3]);
            openParagraph((attrs.class ?? '').split(/\s+/)[0]);
          }
          break;
        case 'br':
          if (p) {
            p.text = p.text.replace(TRAILING_SPACE_RE, '$1') + '\n';
            p.trailingSpace = true;
          }
          break;
        case 'font':
          if (p) {
            if (closing) {
              closeTag(p, 'c');
            } else {
              const color = parseAttributes(match[3]).color,
                vttColor = color && toVTTColor(color);
              openTag(p, 'c', vttColor ? `<c.${vttColor}>` : '<c>');
            }
          }
          break;
      }
    }

    flushParagraph();

    if (!sawSAMI || !sawBody) {
      this._handleError(
        ParseErrorCode.BadSignature,
        sawSAMI ? 'missing SAMI `<BODY>` element' : 'missing SAMI `<SAMI>` root element',
        1,
      );
    }

    this._buildCues(lastSync);
  }

  protected _pushEvent(time: number, p: Paragraph) {
    for (let i = p.stack.length - 1; i >= 0; i--) p.text += `</${p.stack[i].kind}>`;

    let text = p.text.replace(TRAILING_SPACE_RE, '$1');
    // Empty or `&nbsp;`-only paragraphs clear the class.
    if (text.replace(MARKUP_RE, '').replace(NBSP_RE, '').trim() === '') text = '';

    // Several paragraphs of one class in the same `<SYNC>` stack into one cue.
    const events = this._events,
      key = p.cls.toLowerCase(),
      last = events[events.length - 1];
    if (last && last.time === time && last.key === key && last.text && text) {
      last.text += '\n' + text;
    } else {
      events.push({ time, cls: p.cls, key, text });
    }
  }

  protected _buildCues(lastSync: number) {
    const classes = this._classes,
      languages: string[] = [];

    for (const key in classes) {
      const lang = classes[key].lang;
      if (lang && !languages.includes(lang)) languages.push(lang);
    }

    if (languages.length) this._metadata.Languages = languages.join(',');
    if (Object.keys(this._metadata).length) this._init.onHeaderMetadata?.(this._metadata);

    // `<SYNC>` blocks are occasionally out of order; sort (stably) so cues chain correctly.
    const events = this._events.sort((a, b) => a.time - b.time);

    for (let i = 0; i < events.length; i++) {
      const { time, cls, key, text } = events[i];
      if (!text) continue;

      let end = -1;
      for (let j = i + 1; j < events.length; j++) {
        if (events[j].key === key && events[j].time > time) {
          end = events[j].time;
          break;
        }
      }

      if (end < 0) end = Math.max(time, lastSync) + DEFAULT_CUE_DURATION;

      const style = classes[key],
        cue = new VTTCue(time, end, style?.lang ? `<lang ${style.lang}>${text}</lang>` : text);

      cue.id = cls;

      const align = style?.align ?? this._align;
      if (align) cue.align = align as VTTCue['align'];

      this._cues.push(cue);
      this._init.onCue?.(cue);
    }
  }

  protected _parseStyle(css: string) {
    let match: RegExpExecArray | null;

    CLASS_RULE_RE.lastIndex = 0;
    while ((match = CLASS_RULE_RE.exec(css))) {
      const cls: SAMIClass = (this._classes[match[1].toLowerCase()] ??= {}),
        decls = parseDeclarations(match[2]);
      if (decls.name) cls.name = decls.name;
      if (decls.lang) cls.lang = decls.lang;
      if (decls.samitype) cls.type = decls.samitype;
      if (decls['text-align'] && ALIGNS.has(decls['text-align'])) {
        cls.align = decls['text-align'];
      }
    }

    const p = css.match(P_RULE_RE);
    if (p) {
      const align = parseDeclarations(p[1])['text-align'];
      if (align && ALIGNS.has(align)) this._align = align;
    }
  }

  protected _handleError(code: ParseError['code'], reason: string, line: number) {
    if (!this._init.errors) return;
    const error = new ParseError({ code, reason, line });
    this._errors.push(error);
    if (this._init.strict) {
      this._init.cancel();
      throw error;
    } else {
      this._init.onError?.(error);
    }
  }
}

/**
 * Returns the raw text up to the matching closing tag (case-insensitive) and the index after
 * it. Used for `<STYLE>` and `<TITLE>` whose content is not caption markup.
 */
function readRawContent(src: string, from: number, tag: string): [string, number] {
  const lower = src.toLowerCase(),
    close = lower.indexOf(`</${tag}`, from);
  if (close < 0) return [src.slice(from), src.length];
  const gt = src.indexOf('>', close);
  return [src.slice(from, close), gt < 0 ? src.length : gt + 1];
}

/** Parses HTML attributes with or without quotes; names are lower-cased. */
function parseAttributes(text: string) {
  const attrs: Record<string, string> = {};
  let match: RegExpExecArray | null;
  ATTR_RE.lastIndex = 0;
  while ((match = ATTR_RE.exec(text))) {
    attrs[match[1].toLowerCase()] = (match[2] ?? match[3] ?? match[4] ?? '').trim();
  }
  return attrs;
}

/** Parses `name: value;` CSS declarations; names and values are lower-cased except `Name`. */
function parseDeclarations(text: string) {
  const decls: Record<string, string> = {};
  let match: RegExpExecArray | null;
  DECL_RE.lastIndex = 0;
  while ((match = DECL_RE.exec(text))) {
    const name = match[1].toLowerCase(),
      value = match[2].trim();
    decls[name] = name === 'name' || name === 'lang' ? value : value.toLowerCase();
  }
  return decls;
}

function openTag(p: Paragraph, kind: string, open: string) {
  p.text += open;
  p.stack.push({ kind, open });
}

/**
 * Closes the innermost open tag of `kind`. Tags opened after it are closed and re-opened so the
 * WebVTT output stays properly nested even when the SAMI markup is not.
 */
function closeTag(p: Paragraph, kind: string) {
  const stack = p.stack;
  let index = stack.length - 1;
  while (index >= 0 && stack[index].kind !== kind) index--;
  if (index < 0) return;

  const reopen = stack.splice(index + 1);
  for (let i = reopen.length - 1; i >= 0; i--) p.text += `</${reopen[i].kind}>`;
  p.text += `</${kind}>`;
  stack.pop();
  for (const tag of reopen) openTag(p, tag.kind, tag.open);
}

function escapeText(text: string) {
  return text.replace(AMP_RE, '&amp;').replace(LT_RE, '&lt;');
}

function toVTTColor(color: string): string | null {
  const name = color.toLowerCase();
  if (VTT_COLORS.has(name)) return name;
  if (HEX_COLOR_RE.test(name)) return name;
  // SAMI files frequently omit the `#` (`<FONT COLOR=FFFF00>`).
  if (BARE_HEX_COLOR_RE.test(name)) return '#' + name;
  if (HTML_COLORS[name]) return HTML_COLORS[name];
  return null;
}

export default function createSAMIParser() {
  return new SAMIParser();
}
