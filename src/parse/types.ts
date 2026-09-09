import type { VTTCue } from '../vtt/vtt-cue';
import type { VTTHeaderMetadata } from '../vtt/vtt-header';
import type { VTTRegion } from '../vtt/vtt-region';
import type { ParseError } from './parse-error';

export type CaptionsFileFormat =
  | 'vtt'
  | 'srt'
  | 'ssa'
  | 'ass'
  | 'ttml'
  | 'dfxp'
  | 'xml'
  | 'scc'
  | 'lrc'
  | 'sbv'
  | 'smi'
  | 'sami'
  | 'sub'
  | 'microdvd';

export interface CaptionsParserFactory {
  (): CaptionsParser;
}

export interface CaptionsParser {
  /**
   * Called when initializing the parser before the parsing process begins.
   */
  init(init: CaptionsParserInit): void | Promise<void>;
  /**
   * Called when a new line of text has been found and requires parsing. This includes empty lines
   * which can be used to separate caption blocks.
   */
  parse(line: string, lineCount: number): void;
  /**
   * Called when parsing has been cancelled, or has naturally ended as there are no more lines of
   * text to be parsed.
   */
  done(cancelled: boolean): ParsedCaptionsResult;
}

export interface ParsedCaptionsResult {
  metadata: VTTHeaderMetadata;
  regions: VTTRegion[];
  cues: VTTCue[];
  errors: ParseError[];
  /**
   * Fonts embedded in the captions file (e.g., SSA/ASS `[Fonts]` section). Use
   * `loadEmbeddedFonts` to register them with the document.
   */
  fonts?: EmbeddedFont[];
  /**
   * Raw CSS collected from WebVTT `STYLE` blocks, in file order. Pass the parse result to
   * `CaptionsRenderer.changeTrack` to have them applied (scoped and sanitized) to the overlay.
   */
  styles?: string[];
}

export interface EmbeddedFont {
  /** File name as declared in the captions file (e.g., `arial.ttf`). */
  name: string;
  /** Raw font file bytes. */
  data: Uint8Array;
}

export interface CaptionsParserInit extends ParseCaptionsOptions {
  cancel: () => void;
}

export interface ParseCaptionsOptions {
  /**
   * Whether strict mode should be enabled. In strict mode:
   *
   * - If the file header is not valid the parsing process will be cancelled.
   * - If a parser error is found, the parsing process will be cancelled and an error will be
   * thrown instead of invoking the `onError` callback .
   *
   * @defaultValue false
   */
  strict?: boolean;
  /**
   * Whether the WebVTT parser accepts common real-world deviations from the spec grammar: a
   * missing `WEBVTT` signature, `,` as the millisecond separator, one or two fraction digits or
   * none, percentages without `%`, the pre-2013 `align:middle`, and `-->` inside cue text lines
   * that do not look like timings. Set to `false` for browser-exact parsing that still recovers:
   * invalid cues are dropped and reported through `errors`/`onError` instead of thrown (that is
   * what `strict` does). Ignored when `strict` is set.
   *
   * @defaultValue true
   */
  lenient?: boolean;
  /**
   * Whether errors should be collected and reported in the final parser result. By default, this
   * value will be true in dev mode or if `strict` mode is true. If set to true and `strict` mode
   * is false, the `onError` callback will be invoked.
   *
   * Do note, setting this to true will dynamically load error builders which will slightly
   * increase bundle size (~1kB).
   */
  errors?: boolean;
  /**
   * The captions file format to be parsed or a custom parser factory (functions that returns a
   * captions parser). Supported types include: 'vtt', 'srt', 'ssa', 'ass', 'ttml' (also 'dfxp'
   * and 'xml'), 'scc' (CEA-608), 'lrc', 'sbv', 'smi'/'sami', and 'sub'/'microdvd'.
   */
  type?: CaptionsFileFormat | CaptionsParserFactory;
  /**
   * CEA-608 data channel to decode when parsing SCC files (`1` for CC1, `2` for CC2). SCC files
   * only carry field 1, so `3`/`4` (CC3/CC4) yield no cues here; use `CEA608Decoder` from
   * `media-captions/cea` with stream `cc_data` for those.
   *
   * @defaultValue 1
   */
  channel?: 1 | 2 | 3 | 4;
  /**
   * Invoked with metadata that was parsed from the VTT header.
   */
  onHeaderMetadata?(data: VTTHeaderMetadata): void;
  /**
   * Invoked with the CSS text of each WebVTT `STYLE` block as it is parsed.
   */
  onStyle?(css: string): void;
  /**
   * Invoked when a new VTT Cue has been parsed and constructed.
   */
  onCue?(cue: VTTCue): void;
  /**
   * Invoked when a new VTT Region has been parsed and constructed.
   */
  onRegion?(region: VTTRegion): void;
  /**
   * Invoked when a loading or parser error is encountered. This is only invoked if the
   * `errors` option is true.
   */
  onError?(error: ParseError): void;
}

export interface ParseByteStreamOptions extends ParseCaptionsOptions {
  /**
   * The text encoding type to be used when decoding data bytes to text.
   *
   * @defaultValue utf-8
   */
  encoding?: string;
}
