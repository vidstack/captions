import { ParseError, ParseErrorCode, type VTTCue } from 'media-captions';

import { MP4SubtitleDemuxer, parseMP4Subtitles, readBoxes } from '../../src/mp4';

// -------------------------------------------------------------------------------------------
// Box writer
// -------------------------------------------------------------------------------------------

const encoder = new TextEncoder();

function concat(...parts: Uint8Array[]): Uint8Array {
  let length = 0;
  for (const part of parts) length += part.length;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function u8(...values: number[]) {
  return new Uint8Array(values);
}

function u16(value: number) {
  return u8((value >> 8) & 0xff, value & 0xff);
}

function u32(value: number) {
  return u8((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
}

function i32(value: number) {
  return u32(value >>> 0);
}

function u64(value: number) {
  return concat(u32(Math.floor(value / 0x100000000)), u32(value % 0x100000000));
}

function zeros(count: number) {
  return new Uint8Array(count);
}

function str(text: string) {
  return encoder.encode(text);
}

function cstr(text: string) {
  return concat(str(text), u8(0));
}

function box(type: string, ...payload: Uint8Array[]) {
  const body = concat(...payload);
  return concat(u32(8 + body.length), str(type), body);
}

function box64(type: string, ...payload: Uint8Array[]) {
  const body = concat(...payload);
  return concat(u32(1), str(type), u64(16 + body.length), body);
}

function full(type: string, version: number, flags: number, ...payload: Uint8Array[]) {
  return box(
    type,
    u8(version, (flags >> 16) & 0xff, (flags >> 8) & 0xff, flags & 0xff),
    ...payload,
  );
}

/** ISO 639-2/T packed language code. */
function lang(code: string) {
  return (
    ((code.charCodeAt(0) - 0x60) << 10) |
    ((code.charCodeAt(1) - 0x60) << 5) |
    (code.charCodeAt(2) - 0x60)
  );
}

// -------------------------------------------------------------------------------------------
// Init segment
// -------------------------------------------------------------------------------------------

interface TrackSpec {
  id: number;
  entry: Uint8Array;
  handler?: string;
  timescale?: number;
  language?: string;
  /** `[segment_duration, media_time]` edit list entries (movie timescale 1000). */
  edits?: [number, number][];
  /** `trex` default sample duration. */
  defaultDuration?: number;
  mdhdVersion?: 0 | 1;
}

function wvttEntry(header: string, label?: string) {
  return box(
    'wvtt',
    zeros(6),
    u16(1),
    box('vttC', str(header)),
    ...(label ? [box('vlab', str(label))] : []),
  );
}

function stppEntry(mime = '') {
  return box(
    'stpp',
    zeros(6),
    u16(1),
    cstr('http://www.w3.org/ns/ttml'),
    cstr(''),
    cstr(mime),
    box('btrt', u32(0), u32(0), u32(0)),
  );
}

function trak(spec: TrackSpec) {
  const timescale = spec.timescale ?? 1000,
    language = lang(spec.language ?? 'eng'),
    tkhd = full('tkhd', 0, 7, u32(0), u32(0), u32(spec.id), u32(0), u32(0), zeros(60)),
    mdhd =
      spec.mdhdVersion === 1
        ? full('mdhd', 1, 0, u64(0), u64(0), u32(timescale), u64(0), u16(language), u16(0))
        : full('mdhd', 0, 0, u32(0), u32(0), u32(timescale), u32(0), u16(language), u16(0)),
    hdlr = full('hdlr', 0, 0, u32(0), str(spec.handler ?? 'text'), zeros(12), cstr('Subtitles')),
    stbl = box(
      'stbl',
      full('stsd', 0, 0, u32(1), spec.entry),
      full('stts', 0, 0, u32(0)),
      full('stsc', 0, 0, u32(0)),
      full('stsz', 0, 0, u32(0), u32(0)),
      full('stco', 0, 0, u32(0)),
    ),
    minf = box('minf', full('nmhd', 0, 0), stbl),
    mdia = box('mdia', mdhd, hdlr, minf),
    edts = spec.edits
      ? [
          box(
            'edts',
            full(
              'elst',
              0,
              0,
              u32(spec.edits.length),
              ...spec.edits.map(([duration, time]) =>
                concat(u32(duration), i32(time), u32(0x10000)),
              ),
            ),
          ),
        ]
      : [];

  return box('trak', tkhd, ...edts, mdia);
}

function initSegment(...tracks: TrackSpec[]) {
  const mvhd = full('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(0), zeros(80)),
    trexes = tracks
      .filter((t) => t.defaultDuration)
      .map((t) => full('trex', 0, 0, u32(t.id), u32(1), u32(t.defaultDuration!), u32(0), u32(0)));

  return concat(
    box('ftyp', str('iso6'), u32(0), str('iso6'), str('dash')),
    box('moov', mvhd, ...tracks.map(trak), ...(trexes.length ? [box('mvex', ...trexes)] : [])),
  );
}

// -------------------------------------------------------------------------------------------
// Media segment
// -------------------------------------------------------------------------------------------

interface SampleSpec {
  data: Uint8Array;
  duration?: number;
  /** Sub-sample sizes (must sum to `data.length`). */
  subs?: number[];
}

interface FragmentSpec {
  trackId: number;
  baseTime: number;
  samples: SampleSpec[];
  /** Write `tfdt` version 1 (64-bit). */
  tfdt64?: boolean;
  /** `tfhd` default sample duration (omits per-sample durations from `trun`). */
  defaultDuration?: number;
}

function traf(spec: FragmentSpec, dataOffset: number) {
  const perSample = spec.defaultDuration === undefined,
    tfhd = full(
      'tfhd',
      0,
      0x020000 | (perSample ? 0 : 0x8),
      u32(spec.trackId),
      ...(perSample ? [] : [u32(spec.defaultDuration!)]),
    ),
    tfdt = spec.tfdt64
      ? full('tfdt', 1, 0, u64(spec.baseTime))
      : full('tfdt', 0, 0, u32(spec.baseTime)),
    trun = full(
      'trun',
      0,
      0x1 | 0x200 | (perSample ? 0x100 : 0),
      u32(spec.samples.length),
      i32(dataOffset),
      ...spec.samples.map((s) =>
        concat(...(perSample ? [u32(s.duration ?? 1000)] : []), u32(s.data.length)),
      ),
    ),
    subsEntries = spec.samples.map((s, i) => [s, i] as const).filter(([s]) => s.subs),
    subs = subsEntries.length
      ? [
          full(
            'subs',
            1,
            0,
            u32(subsEntries.length),
            ...subsEntries.map(([s, i], n) =>
              concat(
                u32(i + 1 - (n > 0 ? subsEntries[n - 1][1] + 1 : 0)),
                u16(s.subs!.length),
                ...s.subs!.map((size) => concat(u32(size), u8(0, 0), u32(0))),
              ),
            ),
          ),
        ]
      : [];

  return box('traf', tfhd, tfdt, trun, ...subs);
}

/** One `moof`/`mdat` pair. Sample data of all fragments is laid out back to back in `mdat`. */
function mediaSegment(fragments: FragmentSpec[], sequence = 1) {
  // Run data offsets are relative to the moof (`default-base-is-moof`), so the moof is built
  // twice: once to learn its size, then with the real offsets (sizes do not change).
  const build = (moofSize: number) => {
    let offset = moofSize + 8;
    const trafs = fragments.map((fragment) => {
      const rel = offset;
      for (const s of fragment.samples) offset += s.data.length;
      return traf(fragment, rel);
    });
    return box('moof', full('mfhd', 0, 0, u32(sequence)), ...trafs);
  };

  const probe = build(0),
    moof = build(probe.length),
    mdat = box('mdat', ...fragments.flatMap((f) => f.samples.map((s) => s.data)));

  return concat(moof, mdat);
}

function styp() {
  return box('styp', str('msdh'), u32(0), str('msdh'), str('dash'));
}

function sidx() {
  return full('sidx', 0, 0, u32(1), u32(1000), u32(0), u32(0), u16(0), u16(0));
}

// -------------------------------------------------------------------------------------------
// WebVTT sample boxes
// -------------------------------------------------------------------------------------------

interface CueBoxSpec {
  vsid?: number;
  iden?: string;
  sttg?: string;
  payl: string;
  ctim?: string;
}

function vttc(spec: CueBoxSpec) {
  const parts: Uint8Array[] = [];
  if (spec.vsid !== undefined) parts.push(box('vsid', u32(spec.vsid)));
  if (spec.ctim) parts.push(box('ctim', str(spec.ctim)));
  if (spec.iden !== undefined) parts.push(box('iden', str(spec.iden)));
  if (spec.sttg) parts.push(box('sttg', str(spec.sttg)));
  parts.push(box('payl', str(spec.payl)));
  return box('vttc', ...parts);
}

function vtte() {
  return box('vtte');
}

function vtta(text: string) {
  return box('vtta', str(text));
}

const HEADER = 'WEBVTT\n\nREGION id:r width:50%\n\nSTYLE\n::cue { color: red }';

function times(cues: VTTCue[]) {
  return cues.map((cue) => [cue.startTime, cue.endTime]);
}

// -------------------------------------------------------------------------------------------
// Tests: box reader
// -------------------------------------------------------------------------------------------

describe('readBoxes', () => {
  test('GOOD: 32-bit, 64-bit, uuid, and to-end boxes', () => {
    const bytes = concat(
      box('ftyp', str('iso6')),
      box64('free', zeros(3)),
      concat(u32(8 + 16 + 2), str('uuid'), zeros(16), u8(1, 2)),
      concat(u32(0), str('mdat'), zeros(5)),
    );

    const boxes = readBoxes(bytes);
    expect(boxes.map((b) => b.type)).toEqual(['ftyp', 'free', 'uuid', 'mdat']);

    expect(boxes[0]).toEqual({ type: 'ftyp', start: 0, dataStart: 8, end: 12 });
    expect(boxes[1]).toEqual({ type: 'free', start: 12, dataStart: 28, end: 31 });
    expect(boxes[2].dataStart - boxes[2].start).toBe(24);
    expect(boxes[2].end - boxes[2].dataStart).toBe(2);
    expect(boxes[3].end).toBe(bytes.length);
    expect(boxes[3].end - boxes[3].dataStart).toBe(5);
  });

  test('BAD: truncated and undersized boxes throw a BadFormat parse error', () => {
    const bytes = box('moov', zeros(20));

    expect(() => readBoxes(bytes.subarray(0, 20))).toThrowError(ParseError);
    try {
      readBoxes(bytes.subarray(0, 20));
    } catch (error) {
      expect((error as ParseError).code).toBe(ParseErrorCode.BadFormat);
    }

    expect(() => readBoxes(concat(u32(4), str('free')))).toThrowError(/invalid/);
  });
});

// -------------------------------------------------------------------------------------------
// Tests: WebVTT tracks
// -------------------------------------------------------------------------------------------

describe('wvtt', () => {
  const init = initSegment({ id: 1, entry: wvttEntry(HEADER, 'main') });

  test('GOOD: init segment exposes the track, header regions, and styles', () => {
    const regions: string[] = [],
      styles: string[] = [];

    const demuxer = new MP4SubtitleDemuxer({
      onRegion: (region) => regions.push(region.id),
      onStyle: (css) => styles.push(css),
    });

    const tracks = demuxer.init(init);

    expect(tracks).toEqual([
      {
        id: 1,
        type: 'wvtt',
        timescale: 1000,
        language: 'eng',
        header: HEADER,
        label: 'main',
        editOffset: 0,
      },
    ]);

    expect(demuxer.tracks).toEqual(tracks);
    expect(regions).toEqual(['r']);
    expect(demuxer.regions).toHaveLength(1);
    expect(demuxer.regions[0].id).toBe('r');
    expect(demuxer.regions[0].width).toBe(50);
    expect(styles).toEqual(['::cue { color: red }']);
    expect(demuxer.styles).toEqual(styles);
    expect(demuxer.errors).toEqual([]);
  });

  test('GOOD: decodes cues, settings, ids, empty samples, and vsid continuations', () => {
    const segment = concat(
      styp(),
      sidx(),
      mediaSegment([
        {
          trackId: 1,
          baseTime: 5000,
          samples: [
            {
              duration: 1000,
              data: vttc({
                iden: 'c1',
                sttg: 'align:start region:r',
                payl: 'Hello',
                ctim: '00:00:05.000',
              }),
            },
            { duration: 500, data: vtte() },
            { duration: 1000, data: vttc({ vsid: 7, payl: 'Spanning' }) },
            { duration: 1000, data: vttc({ vsid: 7, payl: 'Spanning' }) },
            {
              duration: 2000,
              data: concat(
                vtta('a comment'),
                vttc({ payl: 'Two\nlines', sttg: 'line:0' }),
                vttc({ payl: 'Second cue', sttg: 'position:10%' }),
              ),
            },
          ],
        },
      ]),
    );

    const received: VTTCue[] = [],
      demuxer = new MP4SubtitleDemuxer({ onCue: (cue) => received.push(cue) });

    demuxer.init(init);
    const cues = demuxer.push(segment);

    expect(demuxer.errors).toEqual([]);
    expect(cues).toHaveLength(4);
    expect(received).toEqual(cues);
    expect(demuxer.cues).toEqual(cues);

    expect(times(cues)).toEqual([
      [5, 6],
      [6.5, 8.5],
      [8.5, 10.5],
      [8.5, 10.5],
    ]);

    expect(cues[0].id).toBe('c1');
    expect(cues[0].text).toBe('Hello');
    expect(cues[0].align).toBe('start');
    expect(cues[0].region).toBe(demuxer.regions[0]);

    expect(cues[1].text).toBe('Spanning');
    expect(cues[1].id).toBe('');

    expect(cues[2].text).toBe('Two\nlines');
    expect(cues[2].line).toBe(0);
    expect(cues[3].text).toBe('Second cue');
    expect(cues[3].position).toBe(10);
  });

  test('GOOD: continuation across segments with vsid and without (identical payload)', () => {
    const demuxer = new MP4SubtitleDemuxer();
    demuxer.init(init);

    const a = demuxer.push(
        mediaSegment([
          {
            trackId: 1,
            baseTime: 0,
            samples: [
              { duration: 2000, data: vttc({ vsid: 1, payl: 'A' }) },
              {
                duration: 1000,
                data: concat(vttc({ vsid: 1, payl: 'A' }), vttc({ iden: 'x', payl: 'B' })),
              },
            ],
          },
        ]),
      ),
      b = demuxer.push(
        mediaSegment(
          [
            {
              trackId: 1,
              baseTime: 3000,
              samples: [
                // Same vsid: continues A. Same id/payload, no vsid: continues B.
                {
                  duration: 1000,
                  data: concat(vttc({ vsid: 1, payl: 'A' }), vttc({ iden: 'x', payl: 'B' })),
                },
                // Different payload -> new cue even though contiguous.
                { duration: 1000, data: vttc({ iden: 'x', payl: 'C' }) },
                // Same payload as C but a gap -> new cue.
                { duration: 1000, data: vtte() },
                { duration: 1000, data: vttc({ iden: 'x', payl: 'C' }) },
              ],
            },
          ],
          2,
        ),
      );

    expect(a.map((c) => c.text)).toEqual(['A', 'B']);
    expect(times(a)).toEqual([
      [0, 4],
      [2, 4],
    ]);
    expect(b.map((c) => c.text)).toEqual(['C', 'C']);
    expect(times(b)).toEqual([
      [4, 5],
      [6, 7],
    ]);
    expect(demuxer.cues).toHaveLength(4);

    // After a reset nothing continues.
    demuxer.reset();
    expect(demuxer.cues).toEqual([]);
    const c = demuxer.push(
      mediaSegment([
        { trackId: 1, baseTime: 7000, samples: [{ data: vttc({ vsid: 1, payl: 'A' }) }] },
      ]),
    );
    expect(times(c)).toEqual([[7, 8]]);
  });

  test('GOOD: 64-bit tfdt, tfhd default durations, base_data_offset, multiple moof/mdat', () => {
    const big = 2 ** 32 + 1000,
      first = concat(
        styp(),
        mediaSegment([
          {
            trackId: 1,
            baseTime: big,
            tfdt64: true,
            defaultDuration: 250,
            samples: [{ data: vttc({ payl: 'one' }) }, { data: vttc({ payl: 'two' }) }],
          },
        ]),
      ),
      data = vttc({ payl: 'three' });

    // Second fragment uses an explicit `base_data_offset` (absolute within the pushed buffer).
    const secondMoof = (base: number) =>
        box(
          'moof',
          full('mfhd', 0, 0, u32(2)),
          box(
            'traf',
            full('tfhd', 0, 0x1, u32(1), u64(base)),
            full('tfdt', 1, 0, u64(big + 500)),
            full('trun', 0, 0x1 | 0x100 | 0x200, u32(1), i32(0), u32(100), u32(data.length)),
          ),
        ),
      probe = secondMoof(0),
      second = concat(secondMoof(first.length + probe.length + 8), box('mdat', data));

    const demuxer = new MP4SubtitleDemuxer();
    demuxer.init(init);
    const cues = demuxer.push(concat(first, second));

    expect(demuxer.errors).toEqual([]);
    expect(cues.map((c) => c.text)).toEqual(['one', 'two', 'three']);
    expect(cues[0].startTime).toBeCloseTo(4294968.296, 6);
    expect(cues[0].endTime).toBeCloseTo(4294968.546, 6);
    expect(cues[1].startTime).toBeCloseTo(4294968.546, 6);
    expect(cues[2].startTime).toBeCloseTo(4294968.796, 6);
    expect(cues[2].endTime).toBeCloseTo(4294968.896, 6);
  });

  test('GOOD: trex default duration applies when tfhd and trun omit durations', () => {
    const demuxer = new MP4SubtitleDemuxer();
    demuxer.init(initSegment({ id: 1, entry: wvttEntry('WEBVTT'), defaultDuration: 400 }));

    // Build a trun without durations and a tfhd without defaults.
    const data = vttc({ payl: 'x' }),
      tfhd = full('tfhd', 0, 0x020000, u32(1)),
      tfdt = full('tfdt', 0, 0, u32(1000)),
      trunOf = (offset: number) =>
        full('trun', 0, 0x1 | 0x200, u32(1), i32(offset), u32(data.length)),
      probe = box('moof', full('mfhd', 0, 0, u32(1)), box('traf', tfhd, tfdt, trunOf(0))),
      moof = box(
        'moof',
        full('mfhd', 0, 0, u32(1)),
        box('traf', tfhd, tfdt, trunOf(probe.length + 8)),
      );

    const cues = demuxer.push(concat(moof, box('mdat', data)));
    expect(times(cues)).toEqual([[1, 1.4]]);
  });

  test('GOOD: edit list media_time and empty edits offset presentation times', () => {
    const segment = mediaSegment([
      { trackId: 1, baseTime: 10000, samples: [{ duration: 1000, data: vttc({ payl: 'x' }) }] },
    ]);

    let demuxer = new MP4SubtitleDemuxer();
    let [track] = demuxer.init(
      initSegment({ id: 1, entry: wvttEntry('WEBVTT'), edits: [[0, 2000]] }),
    );
    expect(track.editOffset).toBe(-2);
    expect(times(demuxer.push(segment))).toEqual([[8, 9]]);

    // Empty edit of 500ms (movie timescale) delays, then media_time 1000 is subtracted.
    demuxer = new MP4SubtitleDemuxer();
    [track] = demuxer.init(
      initSegment({
        id: 1,
        entry: wvttEntry('WEBVTT'),
        edits: [
          [500, -1],
          [0, 1000],
        ],
      }),
    );
    expect(track.editOffset).toBe(-0.5);
    expect(times(demuxer.push(segment))).toEqual([[9.5, 10.5]]);
  });

  test('GOOD: timeOffset and trackId options, 64-bit mdhd', () => {
    const demuxer = new MP4SubtitleDemuxer(),
      tracks = demuxer.init(
        initSegment(
          { id: 1, entry: wvttEntry('WEBVTT'), language: 'fra', mdhdVersion: 1, timescale: 90000 },
          { id: 2, entry: wvttEntry('WEBVTT'), language: 'deu' },
          { id: 3, entry: box('avc1', zeros(78)), handler: 'vide' },
        ),
      );

    expect(tracks.map((t) => [t.id, t.language, t.timescale])).toEqual([
      [1, 'fra', 90000],
      [2, 'deu', 1000],
    ]);

    const segment = mediaSegment([
      { trackId: 1, baseTime: 90000, samples: [{ duration: 90000, data: vttc({ payl: 'fr' }) }] },
      { trackId: 2, baseTime: 1000, samples: [{ duration: 1000, data: vttc({ payl: 'de' }) }] },
      { trackId: 3, baseTime: 0, samples: [{ duration: 3000, data: zeros(10) }] },
    ]);

    const all = demuxer.push(segment, { timeOffset: 100 });
    expect(all.map((c) => [c.text, c.startTime, c.endTime])).toEqual([
      ['fr', 101, 102],
      ['de', 101, 102],
    ]);

    demuxer.reset();
    const only = demuxer.push(segment, { trackId: 2 });
    expect(only.map((c) => c.text)).toEqual(['de']);
    expect(demuxer.errors).toEqual([]);
  });

  test('GOOD: self-initialising segment (moov + moof in one buffer)', () => {
    const demuxer = new MP4SubtitleDemuxer(),
      cues = demuxer.push(
        concat(
          init,
          mediaSegment([{ trackId: 1, baseTime: 0, samples: [{ data: vttc({ payl: 'hi' }) }] }]),
        ),
      );
    expect(demuxer.tracks).toHaveLength(1);
    expect(cues.map((c) => c.text)).toEqual(['hi']);
  });

  test('BAD: invalid cue settings in sttg are reported and the cue still decodes', () => {
    const errors: ParseError[] = [],
      demuxer = new MP4SubtitleDemuxer({ onError: (e) => errors.push(e) });
    demuxer.init(init);
    const cues = demuxer.push(
      mediaSegment([
        {
          trackId: 1,
          baseTime: 0,
          samples: [{ data: vttc({ payl: 'x', sttg: 'align:sideways bogus:1' }) }],
        },
      ]),
    );
    expect(cues).toHaveLength(1);
    expect(cues[0].align).toBe('center');
    expect(errors.map((e) => e.code)).toEqual([
      ParseErrorCode.BadSettingValue,
      ParseErrorCode.UnknownSetting,
    ]);
  });
});

// -------------------------------------------------------------------------------------------
// Tests: TTML tracks
// -------------------------------------------------------------------------------------------

const TTML_NS = `xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" xmlns:smpte="http://www.smpte-ra.org/schemas/2052-1/2010/smpte-tt"`;

function ttml(body: string, head = '') {
  return `<?xml version="1.0" encoding="UTF-8"?>
<tt ${TTML_NS} xml:lang="en" ttp:timeBase="media">
  <head>${head}</head>
  <body><div>${body}</div></body>
</tt>`;
}

describe('stpp', () => {
  const init = initSegment({
    id: 1,
    entry: stppEntry('image/png'),
    handler: 'subt',
    language: 'spa',
  });

  test('GOOD: init segment exposes the TTML track', () => {
    const demuxer = new MP4SubtitleDemuxer();
    expect(demuxer.init(init)).toEqual([
      {
        id: 1,
        type: 'stpp',
        timescale: 1000,
        language: 'spa',
        mime: 'image/png',
        namespace: 'http://www.w3.org/ns/ttml',
        editOffset: 0,
      },
    ]);
  });

  test('GOOD: documents on the track timeline are not shifted; restarted documents are', () => {
    const demuxer = new MP4SubtitleDemuxer();
    demuxer.init(init);

    const cues = demuxer.push(
      mediaSegment([
        {
          trackId: 1,
          baseTime: 10000,
          samples: [
            {
              // Absolute: begin is at or after the sample start.
              duration: 5000,
              data: str(
                ttml(
                  `<p begin="00:00:10.000" end="00:00:12.000">A</p><p begin="13s" end="14s">B</p>`,
                ),
              ),
            },
            {
              // Relative: the earliest begin (0s) is before the sample start (15s).
              duration: 5000,
              data: str(ttml(`<p begin="0s" end="2s">C</p><p begin="3s" end="4s">D</p>`)),
            },
          ],
        },
      ]),
      { timeOffset: 100 },
    );

    expect(demuxer.errors).toEqual([]);
    expect(cues.map((c) => [c.text, c.startTime, c.endTime])).toEqual([
      ['A', 110, 112],
      ['B', 113, 114],
      ['C', 115, 117],
      ['D', 118, 119],
    ]);
    expect(demuxer.metadata.Language).toBe('en');
  });

  test('GOOD: images in sub-samples are inlined via urn:mpeg:14496-30:subs:N', () => {
    const png = u8(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5),
      jpeg = u8(0xff, 0xd8, 0xff, 0xe0, 9, 8, 7),
      doc = str(
        ttml(
          `<p begin="0s" end="1s" region="r" smpte:backgroundImage="urn:mpeg:14496-30:subs:1"/>
           <p begin="1s" end="2s" region="r" smpte:backgroundImage="urn:mpeg:14496-30:subs:2"/>
           <p begin="2s" end="3s" region="r" smpte:backgroundImage="urn:mpeg:14496-30:subs:9">T</p>`,
          `<layout><region xml:id="r" tts:origin="10% 70%" tts:extent="80% 20%"/></layout>`,
        ),
      );

    const demuxer = new MP4SubtitleDemuxer();
    demuxer.init(init);

    const cues = demuxer.push(
      mediaSegment([
        {
          trackId: 1,
          baseTime: 0,
          samples: [
            {
              duration: 3000,
              data: concat(doc, png, jpeg),
              subs: [doc.length, png.length, jpeg.length],
            },
          ],
        },
      ]),
    );

    expect(cues).toHaveLength(3);
    expect(cues[0].textStyle?.backgroundImage).toBe(
      `url(data:image/png;base64,${Buffer.from(png).toString('base64')})`,
    );
    expect(cues[1].textStyle?.backgroundImage).toBe(
      `url(data:image/jpeg;base64,${Buffer.from(jpeg).toString('base64')})`,
    );
    // An unresolvable reference is left alone: not an image, text still shows.
    expect(cues[2].text).toBe('T');
    expect(cues[2].textStyle?.backgroundImage).toBeUndefined();
  });

  test('BAD: a sample that is not TTML reports an error and yields no cues', () => {
    const errors: ParseError[] = [],
      demuxer = new MP4SubtitleDemuxer({ onError: (e) => errors.push(e) });
    demuxer.init(init);
    const cues = demuxer.push(
      mediaSegment([{ trackId: 1, baseTime: 0, samples: [{ data: str('<html/>') }] }]),
    );
    expect(cues).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe(ParseErrorCode.BadSignature);
  });
});

// -------------------------------------------------------------------------------------------
// Tests: errors and convenience
// -------------------------------------------------------------------------------------------

describe('errors', () => {
  test('BAD: truncated init segment reports BadFormat and returns no tracks', () => {
    const errors: ParseError[] = [],
      demuxer = new MP4SubtitleDemuxer({ onError: (e) => errors.push(e) }),
      init = initSegment({ id: 1, entry: wvttEntry(HEADER) });

    expect(demuxer.init(init.subarray(0, Math.floor(init.length * 0.7)))).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(ParseError);
    expect(errors[0].code).toBe(ParseErrorCode.BadFormat);
    expect(demuxer.errors).toEqual(errors);
  });

  test('BAD: unknown sample entry yields no tracks and no error', () => {
    const errors: ParseError[] = [],
      demuxer = new MP4SubtitleDemuxer({ onError: (e) => errors.push(e) });
    expect(demuxer.init(initSegment({ id: 1, entry: box('tx3g', zeros(40)) }))).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('BAD: garbage input does not throw and reports BadFormat', () => {
    const errors: ParseError[] = [],
      demuxer = new MP4SubtitleDemuxer({ onError: (e) => errors.push(e) }),
      garbage = str('this is not an mp4 file at all, just some text bytes');

    expect(demuxer.init(garbage)).toEqual([]);
    expect(demuxer.push(garbage)).toEqual([]);
    expect(demuxer.push(new Uint8Array(0))).toEqual([]);
    expect(errors).toHaveLength(2);
    for (const error of errors) expect(error.code).toBe(ParseErrorCode.BadFormat);
  });

  test('BAD: media segment before init reports an error', () => {
    const errors: ParseError[] = [],
      demuxer = new MP4SubtitleDemuxer({ onError: (e) => errors.push(e) });
    expect(
      demuxer.push(mediaSegment([{ trackId: 1, baseTime: 0, samples: [{ data: vtte() }] }])),
    ).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe(ParseErrorCode.BadFormat);
    expect(errors[0].message).toMatch(/init segment/);
  });

  test('BAD: sample data past the end of the segment', () => {
    const errors: ParseError[] = [],
      demuxer = new MP4SubtitleDemuxer({ onError: (e) => errors.push(e) });
    demuxer.init(initSegment({ id: 1, entry: wvttEntry('WEBVTT') }));
    const segment = mediaSegment([
      { trackId: 1, baseTime: 0, samples: [{ data: vttc({ payl: 'x' }) }] },
    ]);
    // Drop the mdat payload but keep a valid mdat header.
    const moofEnd = readBoxes(segment)[0].end,
      broken = concat(segment.subarray(0, moofEnd), box('mdat'));
    expect(demuxer.push(broken)).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe(ParseErrorCode.BadFormat);
  });
});

test('GOOD: parseMP4Subtitles convenience', () => {
  const init = initSegment({
      id: 1,
      entry: wvttEntry(
        HEADER.replace('WEBVTT', 'WEBVTT\nX-TIMESTAMP-MAP=MPEGTS:900000,LOCAL:00:00:00.000'),
      ),
    }),
    segments = [
      mediaSegment([
        {
          trackId: 1,
          baseTime: 0,
          samples: [{ duration: 1000, data: vttc({ payl: 'a', sttg: 'region:r' }) }],
        },
      ]),
      mediaSegment(
        [{ trackId: 1, baseTime: 1000, samples: [{ duration: 1000, data: vttc({ payl: 'b' }) }] }],
        2,
      ),
    ];

  const result = parseMP4Subtitles(init, segments, { timeOffset: 1 });

  expect(result.errors).toEqual([]);
  expect(result.cues.map((c) => [c.text, c.startTime, c.endTime])).toEqual([
    ['a', 1, 2],
    ['b', 2, 3],
  ]);
  expect(result.cues[0].region?.id).toBe('r');
  expect(result.regions.map((r) => r.id)).toEqual(['r']);
  expect(result.styles).toEqual(['::cue { color: red }']);
  expect(result.metadata['X-TIMESTAMP-MAP']).toBe('MPEGTS:900000,LOCAL:00:00:00.000');
});
