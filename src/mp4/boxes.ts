/**
 * Minimal ISOBMFF (MP4/fMP4) box reader. Only what is needed to locate subtitle sample entries
 * in an init segment and the samples in media segments is parsed; everything else is skipped by
 * size. Nothing is copied: boxes are `[start, end)` ranges over the input buffer.
 *
 * @see ISO/IEC 14496-12 (ISOBMFF), ISO/IEC 14496-30 (WebVTT/TTML in ISOBMFF)
 */

import { ParseError, ParseErrorCode } from '../parse/parse-error';

export interface Box {
  /** Four-character box type (for `uuid` boxes the type stays `uuid`). */
  type: string;
  /** Offset of the box header. */
  start: number;
  /** Offset of the first payload byte (after the header and any `uuid` extended type). */
  dataStart: number;
  /** Offset one past the last payload byte. */
  end: number;
}

export interface SampleEntry {
  /** Sample entry type (`wvtt`, `stpp`, `tx3g`, ...). */
  type: string;
  /** WebVTT `vttC` configuration: the WebVTT file header (everything before the first cue). */
  header?: string;
  /** WebVTT `vlab` source label. */
  label?: string;
  /** TTML `stpp` namespace list. */
  namespace?: string;
  /** TTML `stpp` schema location list. */
  schemaLocation?: string;
  /** TTML `stpp` auxiliary MIME types (e.g., embedded image types). */
  mime?: string;
}

export interface TrackInfo {
  id: number;
  handler: string;
  timescale: number;
  language?: string;
  entry: SampleEntry | null;
  /**
   * Seconds to add to media (composition) times to get presentation times, derived from the
   * first `elst` edit: `empty edit durations - media_time / timescale`.
   */
  editOffset: number;
  /** `trex` default sample duration used when neither `tfhd` nor `trun` carry one. */
  defaultDuration: number;
}

export interface Sample {
  /** Byte range of the sample data in the segment. */
  start: number;
  end: number;
  /** Composition time in track timescale units (decode time plus composition offset). */
  time: number;
  /** Duration in track timescale units (`0` when unknown). */
  duration: number;
  /** Sub-sample sizes from `subs` (TTML documents with embedded images), when present. */
  subSamples?: number[];
}

export interface TrackFragment {
  trackId: number;
  samples: Sample[];
}

const SUBTITLE_HANDLERS = /*#__PURE__*/ new Set(['text', 'sbtl', 'subt', 'clcp']);

let decoder: TextDecoder | undefined;

export function decodeUTF8(bytes: Uint8Array, start: number, end: number): string {
  return (decoder ??= new TextDecoder()).decode(bytes.subarray(start, end));
}

export function boxError(reason: string): ParseError {
  return new ParseError({ code: ParseErrorCode.BadFormat, reason, line: 0 });
}

export function u16(b: Uint8Array, o: number) {
  return (b[o] << 8) | b[o + 1];
}

export function u32(b: Uint8Array, o: number) {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

export function i32(b: Uint8Array, o: number) {
  return (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
}

/** 64-bit unsigned read as a JS number (exact below 2^53, which covers any real timestamp). */
export function u64(b: Uint8Array, o: number) {
  return u32(b, o) * 0x100000000 + u32(b, o + 4);
}

/** 64-bit signed read as a JS number. */
export function i64(b: Uint8Array, o: number) {
  return i32(b, o) * 0x100000000 + u32(b, o + 4);
}

function fourcc(b: Uint8Array, o: number) {
  return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
}

/**
 * Reads the boxes laid out back to back in `bytes[start, end)`. Supports 32-bit sizes, 64-bit
 * `largesize` (size = 1), "to end of enclosing box" (size = 0) and `uuid` boxes. Throws a
 * `ParseError` (`BadFormat`) when a box extends past the range or is smaller than its header.
 */
export function readBoxes(bytes: Uint8Array, start = 0, end = bytes.length): Box[] {
  const boxes: Box[] = [];
  let offset = start;

  while (offset + 8 <= end) {
    let size = u32(bytes, offset),
      headerSize = 8;

    const type = fourcc(bytes, offset + 4);

    if (size === 1) {
      if (offset + 16 > end) throw boxError(`truncated \`${type}\` box header at ${offset}`);
      size = u64(bytes, offset + 8);
      headerSize = 16;
    } else if (size === 0) {
      size = end - offset;
    }

    if (type === 'uuid') headerSize += 16;

    if (size < headerSize) throw boxError(`invalid \`${type}\` box size ${size} at ${offset}`);
    if (offset + size > end) throw boxError(`truncated \`${type}\` box at ${offset}`);

    boxes.push({ type, start: offset, dataStart: offset + headerSize, end: offset + size });
    offset += size;
  }

  if (offset !== end) throw boxError(`trailing bytes at ${offset}`);

  return boxes;
}

function children(bytes: Uint8Array, box: Box) {
  return readBoxes(bytes, box.dataStart, box.end);
}

function find(boxes: Box[], type: string) {
  for (let i = 0; i < boxes.length; i++) if (boxes[i].type === type) return boxes[i];
  return null;
}

/** Reads a NUL-terminated UTF-8 string; returns the string and the offset after the NUL. */
function cString(bytes: Uint8Array, start: number, end: number): [string, number] {
  let i = start;
  while (i < end && bytes[i] !== 0) i++;
  return [decodeUTF8(bytes, start, i), Math.min(i + 1, end)];
}

/** Reads a UTF-8 string that fills a box, tolerating a NUL terminator (or none). */
export function boxString(bytes: Uint8Array, box: Box): string {
  let end = box.end;
  while (end > box.dataStart && bytes[end - 1] === 0) end--;
  return decodeUTF8(bytes, box.dataStart, end);
}

/** Decodes the packed ISO 639-2/T language code from `mdhd`. */
function language(code: number): string | undefined {
  if (!code) return;
  const a = ((code >> 10) & 0x1f) + 0x60,
    b = ((code >> 5) & 0x1f) + 0x60,
    c = (code & 0x1f) + 0x60;
  const lang = String.fromCharCode(a, b, c);
  return lang === 'und' ? undefined : lang;
}

// -------------------------------------------------------------------------------------------
// Init Segment
// -------------------------------------------------------------------------------------------

/**
 * Parses the `moov` box of an init segment and returns every track that carries a subtitle
 * handler or a subtitle sample entry. Tracks with other sample entries are returned with
 * `entry` set to whatever type was found so callers can decide what to do with them.
 */
export function readMovie(bytes: Uint8Array, moov: Box): TrackInfo[] {
  const tracks: TrackInfo[] = [],
    boxes = children(bytes, moov),
    mvhd = find(boxes, 'mvhd'),
    movieTimescale = mvhd ? u32(bytes, mvhd.dataStart + (bytes[mvhd.dataStart] ? 20 : 12)) : 0,
    trexes = new Map<number, number>();

  const mvex = find(boxes, 'mvex');
  if (mvex) {
    for (const trex of children(bytes, mvex)) {
      if (trex.type !== 'trex') continue;
      // version/flags, track_ID, default_sample_description_index, default_sample_duration.
      trexes.set(u32(bytes, trex.dataStart + 4), u32(bytes, trex.dataStart + 12));
    }
  }

  for (const trak of boxes) {
    if (trak.type !== 'trak') continue;
    const track = readTrack(bytes, trak, movieTimescale);
    if (!track) continue;
    track.defaultDuration = trexes.get(track.id) ?? 0;
    tracks.push(track);
  }

  return tracks;
}

function readTrack(bytes: Uint8Array, trak: Box, movieTimescale: number): TrackInfo | null {
  const boxes = children(bytes, trak),
    tkhd = find(boxes, 'tkhd'),
    mdia = find(boxes, 'mdia');

  if (!tkhd || !mdia) return null;

  const id = u32(bytes, tkhd.dataStart + (bytes[tkhd.dataStart] ? 20 : 12)),
    mediaBoxes = children(bytes, mdia),
    mdhd = find(mediaBoxes, 'mdhd'),
    hdlr = find(mediaBoxes, 'hdlr'),
    minf = find(mediaBoxes, 'minf');

  if (!mdhd) return null;

  const v1 = bytes[mdhd.dataStart] === 1,
    timescale = u32(bytes, mdhd.dataStart + (v1 ? 20 : 12)),
    lang = language(u16(bytes, mdhd.dataStart + (v1 ? 32 : 20))),
    handler = hdlr ? fourcc(bytes, hdlr.dataStart + 8) : '';

  const track: TrackInfo = {
    id,
    handler,
    timescale: timescale || 1,
    language: lang,
    entry: null,
    editOffset: 0,
    defaultDuration: 0,
  };

  const stbl = minf && find(children(bytes, minf), 'stbl'),
    stsd = stbl && find(children(bytes, stbl), 'stsd');

  if (stsd) track.entry = readSampleEntry(bytes, stsd);

  // Unknown entry on a non-subtitle handler: not a subtitle track, skip cheaply.
  if (!track.entry && !SUBTITLE_HANDLERS.has(handler)) return null;

  const edts = find(boxes, 'edts'),
    elst = edts && find(children(bytes, edts), 'elst');
  if (elst) track.editOffset = readEditOffset(bytes, elst, timescale, movieTimescale);

  return track;
}

function readSampleEntry(bytes: Uint8Array, stsd: Box): SampleEntry | null {
  // version/flags (4), entry_count (4), then sample entries.
  const entries = readBoxes(bytes, stsd.dataStart + 8, stsd.end);
  if (!entries.length) return null;

  const box = entries[0],
    entry: SampleEntry = { type: box.type },
    // SampleEntry: reserved (6) + data_reference_index (2).
    body = box.dataStart + 8;

  if (body > box.end) return entry;

  switch (box.type) {
    case 'wvtt': {
      for (const child of readBoxes(bytes, body, box.end)) {
        if (child.type === 'vttC') entry.header = boxString(bytes, child);
        else if (child.type === 'vlab') entry.label = boxString(bytes, child);
      }
      break;
    }
    case 'stpp': {
      let offset = body;
      [entry.namespace, offset] = cString(bytes, offset, box.end);
      [entry.schemaLocation, offset] = cString(bytes, offset, box.end);
      [entry.mime, offset] = cString(bytes, offset, box.end);
      // Optional `btrt`/`mime` boxes follow; a `mime` box wins over the inline string.
      if (offset + 8 <= box.end) {
        try {
          for (const child of readBoxes(bytes, offset, box.end)) {
            if (child.type === 'mime') {
              // FullBox: version/flags then the content type string.
              entry.mime = boxString(bytes, { ...child, dataStart: child.dataStart + 4 });
            }
          }
        } catch {
          // Some muxers pad the entry; the strings above are all we need.
        }
      }
      break;
    }
  }

  return entry;
}

function readEditOffset(bytes: Uint8Array, elst: Box, timescale: number, movieTimescale: number) {
  const version = bytes[elst.dataStart],
    count = u32(bytes, elst.dataStart + 4);

  let offset = elst.dataStart + 8,
    delay = 0;

  for (let i = 0; i < count; i++) {
    let duration: number, mediaTime: number;
    if (version === 1) {
      if (offset + 20 > elst.end) break;
      duration = u64(bytes, offset);
      mediaTime = i64(bytes, offset + 8);
      offset += 20;
    } else {
      if (offset + 12 > elst.end) break;
      duration = u32(bytes, offset);
      mediaTime = i32(bytes, offset + 4);
      offset += 12;
    }

    // An empty edit (media_time = -1) delays the presentation by its duration (movie timescale).
    if (mediaTime < 0) {
      if (movieTimescale) delay += duration / movieTimescale;
      continue;
    }

    // Only the first real edit is applied: presentation = media - media_time + delay.
    return delay - mediaTime / timescale;
  }

  return delay;
}

// -------------------------------------------------------------------------------------------
// Media Segment
// -------------------------------------------------------------------------------------------

/**
 * Reads the track fragments of one `moof`. Sample byte ranges are resolved against the segment
 * using `tfhd` base data offsets, `default-base-is-moof`, or the `mdat` following the `moof`.
 */
export function readMovieFragment(
  bytes: Uint8Array,
  moof: Box,
  mdat: Box | null,
  defaults: Map<number, number>,
): TrackFragment[] {
  const fragments: TrackFragment[] = [];

  for (const traf of children(bytes, moof)) {
    if (traf.type !== 'traf') continue;

    const boxes = children(bytes, traf),
      tfhd = find(boxes, 'tfhd');
    if (!tfhd) continue;

    const tfFlags = u32(bytes, tfhd.dataStart) & 0xffffff,
      trackId = u32(bytes, tfhd.dataStart + 4),
      samples: Sample[] = [];

    let offset = tfhd.dataStart + 8,
      baseOffset = moof.start,
      hasBase = (tfFlags & 0x020000) !== 0,
      defaultDuration = defaults.get(trackId) ?? 0,
      defaultSize = 0;

    if (tfFlags & 0x000001) {
      baseOffset = u64(bytes, offset);
      hasBase = true;
      offset += 8;
    }
    if (tfFlags & 0x000002) offset += 4;
    if (tfFlags & 0x000008) {
      defaultDuration = u32(bytes, offset);
      offset += 4;
    }
    if (tfFlags & 0x000010) {
      defaultSize = u32(bytes, offset);
      offset += 4;
    }

    const tfdt = find(boxes, 'tfdt');
    let time = 0;
    if (tfdt) {
      time =
        bytes[tfdt.dataStart] === 1
          ? u64(bytes, tfdt.dataStart + 4)
          : u32(bytes, tfdt.dataStart + 4);
    }

    // Where the next run's data starts when it carries no explicit data offset.
    let next = hasBase ? baseOffset : (mdat?.dataStart ?? moof.end);

    for (const trun of boxes) {
      if (trun.type !== 'trun') continue;

      const version = bytes[trun.dataStart],
        flags = u32(bytes, trun.dataStart) & 0xffffff,
        count = u32(bytes, trun.dataStart + 4);

      let pos = trun.dataStart + 8,
        dataOffset = next;

      if (flags & 0x000001) {
        const rel = i32(bytes, pos);
        pos += 4;
        // Without a base the offset is relative to the moof; fall back to the mdat payload if
        // that lands outside the segment (some muxers write offsets for a file layout).
        dataOffset = (hasBase ? baseOffset : moof.start) + rel;
        if (!hasBase && (dataOffset < 0 || dataOffset > bytes.length)) {
          dataOffset = mdat?.dataStart ?? moof.end;
        }
      }
      // first_sample_flags: not needed for text samples.
      if (flags & 0x000004) pos += 4;

      const hasDuration = (flags & 0x000100) !== 0,
        hasSize = (flags & 0x000200) !== 0,
        hasFlags = (flags & 0x000400) !== 0,
        hasCTS = (flags & 0x000800) !== 0,
        stride = (hasDuration ? 4 : 0) + (hasSize ? 4 : 0) + (hasFlags ? 4 : 0) + (hasCTS ? 4 : 0);

      if (pos + count * stride > trun.end) throw boxError(`truncated \`trun\` at ${trun.start}`);

      for (let i = 0; i < count; i++) {
        let duration = defaultDuration,
          size = defaultSize,
          cts = 0;

        if (hasDuration) {
          duration = u32(bytes, pos);
          pos += 4;
        }
        if (hasSize) {
          size = u32(bytes, pos);
          pos += 4;
        }
        if (hasFlags) pos += 4;
        if (hasCTS) {
          cts = version === 0 ? u32(bytes, pos) : i32(bytes, pos);
          pos += 4;
        }

        if (dataOffset + size > bytes.length) {
          throw boxError(`sample data at ${dataOffset} extends past the segment`);
        }

        samples.push({ start: dataOffset, end: dataOffset + size, time: time + cts, duration });
        time += duration;
        dataOffset += size;
      }

      next = dataOffset;
    }

    const subs = find(boxes, 'subs');
    if (subs) readSubSamples(bytes, subs, samples);

    fragments.push({ trackId, samples });
  }

  return fragments;
}

function readSubSamples(bytes: Uint8Array, subs: Box, samples: Sample[]) {
  const version = bytes[subs.dataStart],
    count = u32(bytes, subs.dataStart + 4);

  let offset = subs.dataStart + 8,
    sampleNumber = 0;

  for (let i = 0; i < count && offset + 6 <= subs.end; i++) {
    sampleNumber += u32(bytes, offset);
    const subCount = u16(bytes, offset + 4),
      sizes: number[] = [];
    offset += 6;

    for (let j = 0; j < subCount; j++) {
      // subsample_size (u16/u32), priority (u8), discardable (u8), codec_specific_parameters (u32).
      if (version === 1) {
        if (offset + 10 > subs.end) return;
        sizes.push(u32(bytes, offset));
        offset += 10;
      } else {
        if (offset + 8 > subs.end) return;
        sizes.push(u16(bytes, offset));
        offset += 8;
      }
    }

    // Sample numbers are 1-based within the fragment.
    const sample = samples[sampleNumber - 1];
    if (sample && sizes.length) sample.subSamples = sizes;
  }
}
