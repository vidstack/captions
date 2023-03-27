import type { CaptionsParser } from '../parse/types';
import { VTTParser } from '../vtt/parse';

export class ASSParser extends VTTParser implements CaptionsParser {
  override parse(line: string, lineCount: number) {
    // convert and pipe to VTT parser
  }
}

export default function createASSParser() {
  return new ASSParser();
}
