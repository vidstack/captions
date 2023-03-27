import type { CaptionsParser } from '../parse/types';
import { VTTParser } from '../vtt/parse';

export class SRTParser extends VTTParser implements CaptionsParser {
  override parse(line: string) {
    // convert and pipe to VTT parser
  }
}

export default function createSRTParser() {
  return new SRTParser();
}
