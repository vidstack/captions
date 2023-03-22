import type { VTTCue } from '../vtt/vtt-cue';
import type { VTTHeaderMetadata } from '../vtt/vtt-header';
import type { VTTRegion } from '../vtt/vtt-region';
import type { ParseError } from './parse-error';

export type CaptionsFileFormat = 'vtt' | 'srt' | 'ssa' | 'ass';

export interface CaptionsParserConstructor {
  new (init: CaptionsParserInit): CaptionsParser;
}

export interface CaptionsParser {
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
  errors: ParseError[] | null;
}

export interface CaptionsParserInit extends ParseCaptionsOptions {
  cancel: () => void;
}

export interface ParseCaptionsOptions {
  /**
   * The captions file format to be parsed or a custom parser constructor. Supported types
   * include: 'vtt', 'srt', 'ssa', and 'ass'.
   */
  type?: CaptionsFileFormat | CaptionsParserConstructor;
  /**
   * Invoked with metadata that was parsed from the VTT header.
   */
  onHeaderMetadata?(data: VTTHeaderMetadata): void;
  /**
   * Invoked when a new VTT Cue has been parsed and constructed.
   */
  onCue?(cue: VTTCue): void;
  /**
   * Invoked when a new VTT Region has been parsed and constructed.
   */
  onRegion?(region: VTTRegion): void;
  /**
   * Invoked when a loading or parser error is encountered. This is only invoked in development
   * mode and server-side.
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
