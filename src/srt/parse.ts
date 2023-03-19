import type { CaptionsParser, CaptionsParserInit } from '../parse/types';
import WebVTTParser from '../vtt/parse';

export default class SRTParser implements CaptionsParser {
  private _vttParser = new WebVTTParser(this._init);

  constructor(private _init: CaptionsParserInit) {}

  parse(line: string) {
    // convert and pipe to VTT parser
  }

  done() {
    return this._vttParser.done();
  }
}
