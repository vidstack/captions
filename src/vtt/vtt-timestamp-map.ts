import type { VTTCue } from './vtt-cue';
import type { VTTHeaderMetadata } from './vtt-header';
import { parseVTTTimestamp } from './vtt-parser';

const MPEGTS_RE = /*#__PURE__*/ /MPEGTS:\s*(\d+)/i,
  LOCAL_RE = /*#__PURE__*/ /LOCAL:\s*([\d:.]+)/i,
  MPEGTS_CLOCK = 90000;

export interface VTTTimestampMap {
  /** MPEG-TS presentation timestamp (90kHz clock) that `local` maps to. */
  mpegts: number;
  /** Local WebVTT time in seconds that `mpegts` maps to. */
  local: number;
  /**
   * Seconds to add to cue times so they line up with the MPEG-TS timeline
   * (`mpegts / 90000 - local`).
   */
  offset: number;
}

/**
 * Parses the `X-TIMESTAMP-MAP` header found in HLS WebVTT segments (RFC 8216 §3.5). Returns
 * `null` when the header is missing or malformed.
 *
 * @example
 * ```ts
 * const { metadata, cues } = await parseText(segment);
 * const map = parseVTTTimestampMap(metadata);
 * if (map) shiftVTTCues(cues, map.offset - initialPTS / 90000);
 * ```
 */
export function parseVTTTimestampMap(metadata: VTTHeaderMetadata): VTTTimestampMap | null {
  const header = metadata['X-TIMESTAMP-MAP'] ?? metadata['x-timestamp-map'];
  if (!header) return null;

  const mpegts = header.match(MPEGTS_RE),
    local = header.match(LOCAL_RE);
  if (!mpegts || !local) return null;

  const localTime = parseVTTTimestamp(local[1]);
  if (localTime === null) return null;

  const mpegtsTime = parseInt(mpegts[1], 10);
  return { mpegts: mpegtsTime, local: localTime, offset: mpegtsTime / MPEGTS_CLOCK - localTime };
}

/**
 * Shifts all cue times by the given offset in seconds. Useful for aligning HLS WebVTT segments
 * with the media timeline. Cue times are clamped so they never go negative.
 */
export function shiftVTTCues(cues: VTTCue[], offset: number): VTTCue[] {
  for (const cue of cues) {
    cue.startTime = Math.max(0, cue.startTime + offset);
    cue.endTime = Math.max(cue.startTime, cue.endTime + offset);
  }
  return cues;
}
