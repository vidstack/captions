import type { CaptionsFileFormat } from '../../src';
import type { CCDataTriplet } from '../../src/cea';

/** A built-in text sample parsed through `parseText`. */
export interface TextSample {
  kind: 'text';
  /** URL-safe id (also the `?format=` value). */
  id: string;
  name: string;
  type: CaptionsFileFormat;
  /** Short description shown in the sources panel. */
  description: string;
  text: string;
  /** Loop length in seconds. */
  duration: number;
  /** File extension used when downloading the sample. */
  extension: string;
}

/** A timed `cc_data` packet. */
export interface CCPacket {
  time: number;
  triplets: CCDataTriplet[];
}

/** A built-in live stream sample that synthesises `cc_data` packets on the fly. */
export interface LiveSample {
  kind: 'live';
  id: string;
  name: string;
  description: string;
  duration: number;
  /** Packets sorted by time covering `[0, duration)`. */
  createSchedule(): CCPacket[];
}

export type Sample = TextSample | LiveSample;
