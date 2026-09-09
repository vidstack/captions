/**
 * Parser fuzzing. Inputs come from a tiny seeded PRNG so every run is deterministic and any
 * failure can be regenerated from its `<format>/<strategy>#<index>` label.
 *
 * Strategies, per text format:
 *
 * - `noise`: random bytes, random UTF-16 code units (including lone surrogates) and soups of
 *   format-ish tokens, optionally prefixed by the format's header;
 * - `mutation`: a corpus fixture (`../corpus/files`) with random ranges deleted or duplicated,
 *   random characters inserted, lines shuffled, hostile tokens injected (`-->`, `<`, `&`, `{\`,
 *   NUL, ...), very long lines and 10k nested `<b>`;
 * - `stress`: structurally huge documents (20k cues, a 50k-character cue, 5k regions).
 *
 * Invariants checked for every input:
 *
 * - `parseText` resolves without throwing in non-strict mode and within `PARSE_BUDGET_MS`;
 * - every cue has finite times with `start <= end`, or the file reported at least one error;
 * - `renderVTTCueString` does not throw and the total rendered length stays below
 *   `RENDER_RATIO` x the input length (with a small floor for tiny inputs);
 * - strict mode either resolves or rejects with a `ParseError` (never any other error type).
 *
 * The CEA-608/708 decoders are fed random `cc_data` triplets and byte pairs and must never throw
 * or emit more cues than commits.
 */
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import {
  type CaptionsFileFormat,
  ParseError,
  parseText,
  renderVTTCueString,
  VTTCue,
} from 'media-captions';

import { type CCDataTriplet, CEA608Decoder, CEA708Decoder } from '../../src/cea/index';

const CORPUS = fileURLToPath(new URL('../corpus/files/', import.meta.url));

/** Inputs generated per strategy per format. */
const N = 300;
// Throughput regressions worth catching are orders of magnitude, so the budget is loose on CI
// runners, which are several times slower than a developer machine and run under V8 coverage.
const PARSE_BUDGET_MS = process.env.CI ? 8000 : 2000;
const RENDER_RATIO = 20;
const RENDER_FLOOR = 512;
/** Generous per-test timeout; the per-input budget is what actually matters. */
const TEST_TIMEOUT = 120_000;

const FORMATS: CaptionsFileFormat[] = ['vtt', 'srt', 'ass', 'ssa', 'ttml', 'scc', 'lrc', 'sbv'];

/**
 * Failures caused by bugs that are already known, matched against `<label>: <reason>`. They are
 * filtered out of the regular assertions and pinned by the `test.fails` repros at the bottom of
 * this file, which flip once the bug is fixed (remove the entry here at the same time).
 */
const KNOWN_ISSUES: [RegExp, string][] = [];

// --------------------------------------------------------------------------------------------
// PRNG
// --------------------------------------------------------------------------------------------

/** mulberry32: small, fast, deterministic. */
class Random {
  private _state: number;

  constructor(seed: number) {
    this._state = seed >>> 0;
  }

  /** Uniform float in `[0, 1)`. */
  next(): number {
    this._state = (this._state + 0x6d2b79f5) >>> 0;
    let t = this._state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in `[0, max)`. */
  int(max: number): number {
    return Math.floor(this.next() * max);
  }

  /** Integer in `[min, max]`. */
  range(min: number, max: number): number {
    return min + this.int(max - min + 1);
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)];
  }

  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }
}

/** FNV-1a so each `<format>/<strategy>#<index>` gets its own reproducible seed. */
function seedOf(label: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < label.length; i++) {
    hash ^= label.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// --------------------------------------------------------------------------------------------
// Corpus
// --------------------------------------------------------------------------------------------

const FIXTURE_DIRS: Record<CaptionsFileFormat, string> = {
  vtt: 'vtt',
  srt: 'srt',
  ass: 'ass',
  ssa: 'ssa',
  ttml: 'ttml',
  dfxp: 'ttml',
  xml: 'ttml',
  scc: 'scc',
  lrc: 'lrc',
  sbv: 'sbv',
  smi: 'smi',
  sami: 'smi',
  sub: 'sub',
  microdvd: 'sub',
};

const fixtureCache = new Map<string, string[]>();

function fixturesFor(type: CaptionsFileFormat): string[] {
  const dir = FIXTURE_DIRS[type];
  let files = fixtureCache.get(dir);
  if (!files) {
    const full = path.join(CORPUS, dir);
    files = fs.existsSync(full)
      ? fs
          .readdirSync(full)
          .sort()
          .map((name) => fs.readFileSync(path.join(full, name), 'utf8'))
      : [];
    fixtureCache.set(dir, files);
  }
  return files;
}

// --------------------------------------------------------------------------------------------
// Generators
// --------------------------------------------------------------------------------------------

const HEADERS: Record<string, string> = {
  vtt: 'WEBVTT\n\n',
  srt: '1\n',
  ass: '[Script Info]\nScriptType: v4.00+\nPlayResX: 1280\nPlayResY: 720\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n',
  ssa: '[Script Info]\nScriptType: v4.00\n\n[Events]\nFormat: Marked, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n',
  ttml: '<?xml version="1.0"?>\n<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling"><body><div>\n',
  scc: 'Scenarist_SCC V1.0\n\n',
  lrc: '[ti:fuzz]\n',
  sbv: '',
};

/** Format-ish fragments so random soups reach deeper parser paths. */
const TOKENS = [
  '0',
  '1',
  '9',
  ':',
  '.',
  ',',
  ';',
  ' ',
  '\t',
  '\n',
  '\r\n',
  '-->',
  '->',
  '<',
  '>',
  '</',
  '/>',
  '&',
  '&amp;',
  '&#',
  '&#x',
  '{\\',
  '}',
  '\\',
  '\\N',
  '\\h',
  '[',
  ']',
  '(',
  ')',
  '=',
  '%',
  '"',
  "'",
  '\0',
  '﻿',
  'WEBVTT',
  'NOTE',
  'STYLE',
  'REGION',
  'align:',
  'line:',
  'position:',
  'size:',
  'vertical:',
  'region:',
  '<v ',
  '<c.',
  '<b>',
  '<i>',
  '<ruby>',
  '<rt>',
  '<lang ',
  '<00:00:01.000>',
  '00:00:01.000',
  '00:00:01,000',
  '0:00:01.00',
  '00:00:01:00',
  'Dialogue:',
  'Style:',
  'Format:',
  '[Events]',
  '[V4+ Styles]',
  '\\pos(',
  '\\move(',
  '\\t(',
  '\\fad(',
  '\\k',
  '\\kf',
  '\\p1',
  '\\clip(',
  'm 0 0 l ',
  '<p ',
  '<span ',
  '<br/>',
  'begin="',
  'end="',
  'dur="',
  'tts:',
  'xml:id="',
  '9420',
  '94ae',
  '942f',
  '942c',
  '9425',
  '94ad',
  '80',
  '[00:01.00]',
  '[offset:',
  '<00:01.00>',
  '0:00:01.000,0:00:02.000',
  '[br]',
  '\uD800',
  '\uDFFF',
  'é',
  '漢',
  '🎵',
];

function noiseChunk(rng: Random, length: number): string {
  let text = '';
  const mode = rng.int(3);
  for (let i = 0; i < length; i++) {
    if (mode === 0) {
      text += String.fromCharCode(rng.int(256));
    } else if (mode === 1) {
      text += String.fromCharCode(rng.int(0x10000));
    } else {
      text += rng.pick(TOKENS);
    }
  }
  return text;
}

function noise(rng: Random, type: CaptionsFileFormat): string {
  const body = noiseChunk(rng, rng.int(600));
  return rng.chance(0.5) ? HEADERS[type] + body : body;
}

const INJECT = [
  '-->',
  '<',
  '>',
  '&',
  '&;',
  '&#0;',
  '{\\',
  '{\\p1}',
  '\\t(',
  '}',
  '\0',
  '﻿',
  '</',
  '<c.',
  '<v ',
  '<00:',
  '[',
  ']',
  '\r',
  '\r\n',
  '%',
  '::cue',
  'REGION',
  'STYLE',
  '<p',
  '</p>',
  '<span',
  'begin="',
  '9420',
  '\uD800',
  '\uDFFF',
  '"',
  '=',
];

/** Random mutation of a corpus fixture. Heavy mutations are throttled to keep the run short. */
function mutate(rng: Random, source: string): string {
  let text = source;
  const ops = 1 + rng.int(4);

  for (let op = 0; op < ops; op++) {
    const at = rng.int(text.length + 1);
    switch (rng.int(10)) {
      case 0: {
        // Delete a range.
        const length = rng.int(Math.min(200, text.length - at + 1));
        text = text.slice(0, at) + text.slice(at + length);
        break;
      }
      case 1: {
        // Duplicate a range.
        const length = rng.int(Math.min(200, text.length - at + 1));
        text = text.slice(0, at) + text.slice(at, at + length) + text.slice(at);
        break;
      }
      case 2:
        // Insert random characters.
        text = text.slice(0, at) + noiseChunk(rng, rng.int(32)) + text.slice(at);
        break;
      case 3:
        // Shuffle lines.
        text = rng.shuffle(text.split('\n')).join('\n');
        break;
      case 4:
      case 5:
        // Inject a hostile token.
        text = text.slice(0, at) + rng.pick(INJECT) + text.slice(at);
        break;
      case 6:
        // Replace a character with a NUL or random byte.
        text =
          text.slice(0, at) +
          (rng.chance(0.5) ? '\0' : String.fromCharCode(rng.int(256))) +
          text.slice(at + 1);
        break;
      case 7:
        // Truncate.
        text = text.slice(0, at);
        break;
      case 8: {
        // A very long line.
        const line = rng
          .pick(['x', '<', ' ', '\\', '&', '0', '-', '>', '{\\'])
          .repeat(rng.range(20_000, 100_000));
        const eol = text.indexOf('\n', at);
        text = eol < 0 ? text + '\n' + line : text.slice(0, eol + 1) + line + text.slice(eol);
        break;
      }
      case 9: {
        // Deeply nested tags.
        const tag = rng.pick(['b', 'i', 'c', 'v x', 'ruby', 'span', 'font']),
          open = `<${tag}>`.repeat(10_000),
          close = rng.chance(0.5) ? `</${tag.split(' ')[0]}>`.repeat(10_000) : '';
        text = text.slice(0, at) + open + 'x' + close + text.slice(at);
        break;
      }
    }
  }

  return text;
}

// --------------------------------------------------------------------------------------------
// Structural stress
// --------------------------------------------------------------------------------------------

function pad(n: number, width = 2) {
  return String(n).padStart(width, '0');
}

function clock(seconds: number, sep = '.', fraction = 3) {
  const h = Math.floor(seconds / 3600),
    m = Math.floor((seconds % 3600) / 60),
    s = Math.floor(seconds % 60),
    ms = Math.round((seconds - Math.floor(seconds)) * 1000);
  const frac = fraction === 3 ? pad(ms, 3) : pad(Math.floor(ms / 10), 2);
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${frac}`;
}

function words(count: number) {
  const parts: string[] = [];
  for (let i = 0; i < count; i++) parts.push(['lorem', 'ipsum', 'dolor', 'sit', 'amet'][i % 5]);
  return parts.join(' ');
}

/** A cue at `[start, start + 1)` in the given format (no header). */
function cueBlock(type: CaptionsFileFormat, index: number, start: number, text: string) {
  const end = start + 1;
  switch (type) {
    case 'vtt':
      return `${index}\n${clock(start)} --> ${clock(end)}\n${text}\n\n`;
    case 'srt':
      return `${index}\n${clock(start, ',')} --> ${clock(end, ',')}\n${text}\n\n`;
    case 'sbv':
      return `${clock(start).replace(/^0/, '')},${clock(end).replace(/^0/, '')}\n${text}\n\n`;
    case 'lrc':
      return `[${pad(Math.floor(start / 60))}:${pad(start % 60)}.00]${text}\n`;
    case 'ass':
    case 'ssa':
      return `Dialogue: 0,${clock(start, '.', 2).replace(/^0/, '')},${clock(end, '.', 2).replace(/^0/, '')},Default,,0,0,0,,${text}\n`;
    case 'ttml':
      return `<p begin="${start}s" end="${end}s">${text}</p>\n`;
    case 'scc': {
      // Pop-on caption: RCL ENM PAC(row 15) text EOC, one line per second.
      const hex: string[] = [];
      for (let i = 0; i < text.length; i += 2) {
        const a = text.charCodeAt(i) & 0x7f,
          b = i + 1 < text.length ? text.charCodeAt(i + 1) & 0x7f : 0;
        hex.push(a.toString(16).padStart(2, '0') + b.toString(16).padStart(2, '0'));
      }
      const tc = `${pad(Math.floor(start / 3600))}:${pad(Math.floor((start % 3600) / 60))}:${pad(start % 60)}:00`;
      return `${tc}\t9420 9420 94ae 94ae 94f0 94f0 ${hex.join(' ')} 942f 942f\n\n`;
    }
    default:
      return '';
  }
}

function footer(type: CaptionsFileFormat) {
  return type === 'ttml' ? '</div></body></tt>\n' : '';
}

function stressInputs(type: CaptionsFileFormat): [string, string][] {
  const inputs: [string, string][] = [];

  let many = HEADERS[type];
  for (let i = 0; i < 20_000; i++) many += cueBlock(type, i + 1, i, `Cue ${i}`);
  inputs.push(['20k cues', many + footer(type)]);

  const giant = HEADERS[type] + cueBlock(type, 1, 1, words(10_000).slice(0, 50_000)) + footer(type);
  inputs.push(['50k-character cue', giant]);

  if (type === 'vtt') {
    let regions = 'WEBVTT\n\n';
    for (let i = 0; i < 5000; i++) {
      regions += `REGION\nid:r${i}\nwidth:${(i % 100) + 1}%\nlines:${(i % 10) + 1}\nregionanchor:0%,100%\nviewportanchor:${i % 100}%,90%\nscroll:up\n\n`;
    }
    for (let i = 0; i < 5000; i++) {
      regions += `${clock(i)} --> ${clock(i + 1)} region:r${i}\nCue ${i}\n\n`;
    }
    inputs.push(['5k regions', regions]);
  } else if (type === 'ass' || type === 'ssa') {
    let styles = `[Script Info]\nScriptType: ${type === 'ass' ? 'v4.00+' : 'v4.00'}\n\n[${type === 'ass' ? 'V4+ Styles' : 'V4 Styles'}]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n`;
    for (let i = 0; i < 5000; i++) {
      styles += `Style: S${i},Arial,${20 + (i % 40)},&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,${(i % 9) + 1},10,10,10,1\n`;
    }
    styles += `\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
    for (let i = 0; i < 5000; i++) {
      styles += `Dialogue: 0,0:00:${pad(i % 60)}.00,0:00:${pad((i % 60) + 1 > 59 ? 59 : (i % 60) + 1)}.99,S${i},,0,0,0,,Line ${i}\n`;
    }
    inputs.push(['5k styles', styles]);
  } else if (type === 'ttml') {
    let regions = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling"><head><layout>\n`;
    for (let i = 0; i < 5000; i++) {
      regions += `<region xml:id="r${i}" tts:origin="${i % 90}% ${i % 80}%" tts:extent="10% 10%"/>\n`;
    }
    regions += `</layout></head><body><div>\n`;
    for (let i = 0; i < 5000; i++) {
      regions += `<p begin="${i}s" end="${i + 1}s" region="r${i}">Cue ${i}</p>\n`;
    }
    regions += `</div></body></tt>\n`;
    inputs.push(['5k regions', regions]);
  }

  return inputs;
}

// --------------------------------------------------------------------------------------------
// Checks
// --------------------------------------------------------------------------------------------

interface Failure {
  label: string;
  reason: string;
  snippet: string;
}

function snippet(input: string) {
  return JSON.stringify(input.length > 160 ? input.slice(0, 160) + '…' : input);
}

function timesOk(cue: VTTCue) {
  return (
    Number.isFinite(cue.startTime) &&
    (Number.isFinite(cue.endTime) || cue.endTime === Infinity) &&
    cue.startTime <= cue.endTime
  );
}

async function check(
  type: CaptionsFileFormat,
  label: string,
  input: string,
  failures: Failure[],
  strict = true,
) {
  const fail = (reason: string) => failures.push({ label, reason, snippet: snippet(input) });

  const started = performance.now();
  let result;
  try {
    result = await parseText(input, { type, errors: true });
  } catch (error) {
    fail(`non-strict parse threw ${String(error)}`);
    return;
  }
  const elapsed = performance.now() - started;
  if (elapsed > PARSE_BUDGET_MS) fail(`parse took ${elapsed.toFixed(0)}ms`);

  let rendered = 0;
  for (const cue of result.cues) {
    if (!timesOk(cue) && result.errors.length === 0) {
      fail(`cue ${cue.startTime}-${cue.endTime} has bad times and no error was reported`);
      break;
    }
    try {
      rendered += renderVTTCueString(
        cue,
        Number.isFinite(cue.startTime) ? cue.startTime : 0,
      ).length;
    } catch (error) {
      fail(`render threw ${String(error)}`);
      break;
    }
  }

  const bound = RENDER_RATIO * Math.max(input.length, RENDER_FLOOR);
  if (rendered >= bound) fail(`rendered ${rendered} chars from ${input.length} (bound ${bound})`);

  if (!strict) return;
  try {
    await parseText(input, { type, strict: true, errors: true });
  } catch (error) {
    if (!(error instanceof ParseError))
      fail(`strict parse threw a non-ParseError: ${String(error)}`);
  }
}

function report(failures: Failure[]) {
  const unknown = failures.filter(
    (failure) => !KNOWN_ISSUES.some(([re]) => re.test(`${failure.label}: ${failure.reason}`)),
  );
  expect(
    unknown.map((failure) => `${failure.label}: ${failure.reason}\n    ${failure.snippet}`),
  ).toEqual([]);
}

// --------------------------------------------------------------------------------------------
// Text parsers
// --------------------------------------------------------------------------------------------

describe('text parsers', () => {
  test.each(FORMATS)(
    '%s: random noise',
    async (type) => {
      const failures: Failure[] = [];
      for (let i = 0; i < N; i++) {
        const label = `${type}/noise#${i}`;
        await check(type, label, noise(new Random(seedOf(label)), type), failures);
      }
      report(failures);
    },
    TEST_TIMEOUT,
  );

  test.each(FORMATS)(
    '%s: corpus mutations',
    async (type) => {
      const fixtures = fixturesFor(type);
      expect(fixtures.length).toBeGreaterThan(0);
      const failures: Failure[] = [];
      for (let i = 0; i < N; i++) {
        const label = `${type}/mutation#${i}`,
          rng = new Random(seedOf(label));
        await check(type, label, mutate(rng, rng.pick(fixtures)), failures);
      }
      report(failures);
    },
    TEST_TIMEOUT,
  );

  test.each(FORMATS)(
    '%s: structural stress',
    async (type) => {
      const failures: Failure[] = [];
      for (const [name, input] of stressInputs(type)) {
        // Strict mode is skipped: the point is throughput, not grammar.
        await check(type, `${type}/stress:${name}`, input, failures, false);
      }
      report(failures);
    },
    TEST_TIMEOUT,
  );
});

// --------------------------------------------------------------------------------------------
// Regressions found by fuzzing, kept as minimal repros
// --------------------------------------------------------------------------------------------

describe('known issues', () => {
  test('SSA: a Dialogue line with fewer fields than Format reports an error instead of throwing', async () => {
    await parseText('[Events]\nFormat: Layer, Start, End, Style, Text\nDialogue: 0\n', {
      type: 'ass',
    });
  });

  test('render: 5k nested <b> tags are capped instead of overflowing the call stack', () => {
    renderVTTCueString(new VTTCue(0, 1, '<b>'.repeat(5000) + 'x'));
  });

  test('TTML: 10k nested <span> elements are capped instead of overflowing the call stack', async () => {
    const xml =
      '<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="0s" end="1s">' +
      '<span>'.repeat(10_000) +
      'x' +
      '</span>'.repeat(10_000) +
      '</p></div></body></tt>';
    await parseText(xml, { type: 'ttml' });
  });
});

// --------------------------------------------------------------------------------------------
// CEA decoders
// --------------------------------------------------------------------------------------------

const FPS = 29.97;

/** Random 608 byte, biased towards control codes and with a random parity bit. */
function byte608(rng: Random): number {
  let value: number;
  if (rng.chance(0.3)) value = 0x10 + rng.int(0x10);
  else if (rng.chance(0.5)) value = 0x20 + rng.int(0x60);
  else value = rng.int(0x80);
  return rng.chance(0.5) ? value | 0x80 : value;
}

function triplet608(rng: Random): CCDataTriplet {
  return { type: rng.int(4) as CCDataTriplet['type'], data1: byte608(rng), data2: byte608(rng) };
}

function checkCues(cues: VTTCue[], failures: string[], label: string) {
  for (const cue of cues) {
    if (!timesOk(cue)) {
      failures.push(`${label}: cue with bad times ${cue.startTime}-${cue.endTime}`);
      break;
    }
    try {
      renderVTTCueString(cue);
    } catch (error) {
      failures.push(`${label}: render threw ${String(error)}`);
      break;
    }
  }
}

describe('CEA-608 decoder', () => {
  test.each([1, 2, 3, 4] as const)(
    'channel %i survives random cc_data and byte pairs',
    (channel) => {
      const failures: string[] = [];
      for (let run = 0; run < 25; run++) {
        const label = `cea608/ch${channel}#${run}`,
          rng = new Random(seedOf(label));
        const decoder = new CEA608Decoder({
          channel,
          live: rng.chance(0.5),
          onCue() {},
          onCueUpdate() {},
        });

        const frames = 150;
        let commits = 0;
        try {
          for (let f = 0; f < frames; f++) {
            const triplets: CCDataTriplet[] = [];
            const count = 1 + rng.int(4);
            for (let t = 0; t < count; t++) triplets.push(triplet608(rng));
            decoder.decodeCCData(triplets, f / FPS);
            commits++;
          }
          for (let i = 0; i < frames; i++) {
            decoder.decodePair(
              byte608(rng),
              byte608(rng),
              (frames + i) / FPS,
              rng.chance(0.5) ? 1 : 2,
            );
            if (rng.chance(0.3)) {
              decoder.commit();
              commits++;
            }
          }
          decoder.flush();
          commits++;
        } catch (error) {
          failures.push(`${label}: threw ${String(error)}`);
          continue;
        }

        // A cue boundary can only be created by a commit (plus the open cue closed by flush).
        if (decoder.cues.length > commits + 1) {
          failures.push(`${label}: ${decoder.cues.length} cues from ${commits} commits`);
        }
        checkCues(decoder.cues, failures, label);

        decoder.reset();
        if (decoder.cues.length !== 0) failures.push(`${label}: reset left cues behind`);
      }
      expect(failures).toEqual([]);
    },
    TEST_TIMEOUT,
  );
});

/** A well-formed DTVCC packet carrying one service block of random bytes. */
function packet708(rng: Random, service: number, sequence: number): CCDataTriplet[] {
  const blockSize = rng.int(32),
    body: number[] = [];
  // Service block header: service number (3 bits) + block size (5 bits); extended header for > 6.
  if (service > 6) {
    body.push((7 << 5) | blockSize, service & 0x3f);
  } else {
    body.push((service << 5) | blockSize);
  }
  for (let i = 0; i < blockSize; i++) {
    // Bias towards C1 commands (0x80-0x9f) and G0 text.
    body.push(
      rng.chance(0.4)
        ? 0x80 + rng.int(0x20)
        : rng.chance(0.8)
          ? 0x20 + rng.int(0x5f)
          : rng.int(0x100),
    );
  }
  while (body.length % 2 !== 1) body.push(0);
  // packet_size_code counts 2-byte words including the header byte.
  const size = (body.length + 1) / 2,
    header = ((sequence & 0x03) << 6) | (size & 0x3f);
  const triplets: CCDataTriplet[] = [{ type: 3, data1: header, data2: body[0] }];
  for (let i = 1; i < body.length; i += 2) {
    triplets.push({ type: 2, data1: body[i], data2: body[i + 1] ?? 0 });
  }
  return triplets;
}

describe('CEA-708 decoder', () => {
  test(
    'survives random and semi-structured cc_data on random services',
    () => {
      const failures: string[] = [];
      for (let run = 0; run < 60; run++) {
        const label = `cea708#${run}`,
          rng = new Random(seedOf(label)),
          service = 1 + rng.int(63);
        const decoder = new CEA708Decoder({
          service,
          live: rng.chance(0.5),
          onCue() {},
          onCueUpdate() {},
        });

        const groups = 150;
        try {
          for (let g = 0; g < groups; g++) {
            let triplets: CCDataTriplet[];
            if (rng.chance(0.5)) {
              triplets = packet708(rng, rng.chance(0.8) ? service : 1 + rng.int(63), g);
            } else {
              triplets = [];
              const count = 1 + rng.int(6);
              for (let t = 0; t < count; t++) {
                triplets.push({
                  type: rng.int(4) as CCDataTriplet['type'],
                  data1: rng.int(256),
                  data2: rng.int(256),
                });
              }
            }
            decoder.decodeCCData(triplets, g / FPS);
          }
          decoder.flush();
        } catch (error) {
          failures.push(`${label}: threw ${String(error)}`);
          continue;
        }

        // Each of the 8 windows can close at most one cue per commit.
        if (decoder.cues.length > (groups + 1) * 8) {
          failures.push(`${label}: ${decoder.cues.length} cues from ${groups} groups`);
        }
        checkCues(decoder.cues, failures, label);

        decoder.reset();
        if (decoder.cues.length !== 0) failures.push(`${label}: reset left cues behind`);
      }
      expect(failures).toEqual([]);
    },
    TEST_TIMEOUT,
  );
});
