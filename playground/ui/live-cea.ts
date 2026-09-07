import { CueTrack, type VTTCue } from '../../src';
import { CEA608Decoder, CEA708Decoder, type CCDataTriplet } from '../../src/cea';
import type { CCPacket, LiveSample } from '../samples';

export interface LiveFeederOptions {
  retention?: number;
  /** Receives a hex dump line for every packet fed (for the sources panel log). */
  onLog?(line: string): void;
}

/**
 * Feeds a synthesised `cc_data` schedule into live-mode CEA-608/708 decoders as the clock
 * advances, so cues land in the `CueTrack` with `endTime = Infinity` and are updated in place
 * once their end is known. Seeking backwards resets the decoders and replays from zero.
 */
export class LiveCaptionFeeder {
  readonly track: CueTrack;
  readonly schedule: CCPacket[];

  private _cursor = 0;
  private _time = -1;
  private _cc608: CEA608Decoder;
  private _cc708: CEA708Decoder;
  private _onLog?: (line: string) => void;

  constructor(sample: LiveSample, options: LiveFeederOptions = {}) {
    this.schedule = sample.createSchedule();
    this.track = new CueTrack(undefined, { retention: options.retention ?? 30 });
    this._onLog = options.onLog;
    this._cc608 = this._create608();
    this._cc708 = this._create708();
  }

  get time() {
    return this._time;
  }

  get fedCount() {
    return this._cursor;
  }

  /** Moves to `time`, replaying from the start when moving backwards. */
  seek(time: number) {
    this._reset();
    this.advance(time);
  }

  /** Feeds every packet up to and including `time`. */
  advance(time: number) {
    if (time < this._time) {
      this.seek(time);
      return;
    }
    this._time = time;
    const schedule = this.schedule;
    while (this._cursor < schedule.length && schedule[this._cursor].time <= time) {
      const packet = schedule[this._cursor++];
      this._feed(packet);
    }
    this.track.evict(time);
  }

  destroy() {
    this.track.clear();
  }

  private _feed(packet: CCPacket) {
    const field: CCDataTriplet[] = [],
      dtvcc: CCDataTriplet[] = [];
    for (const triplet of packet.triplets) {
      (triplet.type <= 1 ? field : dtvcc).push(triplet);
    }
    if (field.length) this._cc608.decodeCCData(field, packet.time);
    if (dtvcc.length) this._cc708.decodeCCData(dtvcc, packet.time);
    this._onLog?.(formatPacket(packet));
  }

  private _reset() {
    this._cc608.reset();
    this._cc708.reset();
    this.track.clear();
    this._cursor = 0;
    this._time = -1;
  }

  private _onCue = (cue: VTTCue) => {
    this.track.add(cue);
  };

  private _onCueUpdate = (cue: VTTCue) => {
    // A cue that ended the moment it started carries no information for the viewer.
    if (cue.endTime <= cue.startTime) this.track.remove(cue);
    else this.track.update(cue);
  };

  private _create608() {
    return new CEA608Decoder({
      channel: 1,
      live: true,
      onCue: this._onCue,
      onCueUpdate: this._onCueUpdate,
    });
  }

  private _create708() {
    return new CEA708Decoder({
      service: 1,
      live: true,
      onCue: this._onCue,
      onCueUpdate: this._onCueUpdate,
    });
  }
}

const TYPE_LABEL = ['608 f1', '608 f2', '708 cont', '708 start'];

export function formatPacket(packet: CCPacket) {
  const time = packet.time.toFixed(3).padStart(8, ' '),
    body = packet.triplets
      .map(
        (t) =>
          `${TYPE_LABEL[t.type]} ${t.data1.toString(16).padStart(2, '0')}${t.data2
            .toString(16)
            .padStart(2, '0')}`,
      )
      .join(' | ');
  return `${time}s  ${body}`;
}
