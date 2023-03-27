import type { CaptionsParser, CaptionsParserInit } from '../parse/types';
import { VTTBlock, VTTParser } from '../vtt/parse';

export class SRTParser extends VTTParser implements CaptionsParser {
  override async init(init: CaptionsParserInit) {
    await super.init(init);
    this._block = VTTBlock.None;
  }

  protected override _parseHeader() {
    // no-op
  }

  protected override _parseTimestamp(timestamp: string): number | null {
    return super._parseTimestamp(timestamp.replace(',', '.'));
  }
}

export default function createSRTParser() {
  return new SRTParser();
}
