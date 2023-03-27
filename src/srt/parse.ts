import type { CaptionsParser } from '../parse/types';
import { VTTBlock, VTTParser } from '../vtt/parse';
import { VTTCue } from '../vtt/vtt-cue';

const MILLISECOND_SEP_RE = /,/g,
  TIMESTAMP_SEP = '-->';

export class SRTParser extends VTTParser implements CaptionsParser {
  override parse(line: string, lineCount: number): void {
    if (line === '') {
      if (this._cue) {
        this._cues.push(this._cue);
        this._init.onCue?.(this._cue);
        this._cue = null;
      }

      this._block = VTTBlock.None;
    } else if (this._block === VTTBlock.Cue) {
      this._cue!.text += (this._cue!.text ? '\n' : '') + line;
    } else if (line.includes(TIMESTAMP_SEP)) {
      const result = this._parseTimestamp(line, lineCount);
      if (result) {
        this._cue = new VTTCue(result[0], result[1], result[2].join(' '));
        this._cue.id = this._prevLine;
        this._block = VTTBlock.Cue;
      }
    }

    this._prevLine = line;
  }

  protected override _parseTimestamp(line: string, lineCount: number) {
    return super._parseTimestamp(line.replace(MILLISECOND_SEP_RE, '.'), lineCount);
  }
}

export default function createSRTParser() {
  return new SRTParser();
}
