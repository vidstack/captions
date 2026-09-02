import { parseText, type VTTCue } from 'media-captions';

import { parseCCData, type CCDataTriplet } from '../../src/cea/cc-data';
import { CEA608Decoder, sccChannelOf } from '../../src/cea/cea608-decoder';

const FPS = 29.97,
  FRAME = 1 / FPS;

type Pair = [number, number];

/** Add odd parity (bit 7) to a 7-bit CEA-608 byte. */
function parity(byte: number) {
  let bits = 0;
  for (let b = byte; b; b >>= 1) bits += b & 1;
  return bits % 2 === 0 ? byte | 0x80 : byte;
}

/** A control code transmitted twice. Bit 3 of the first byte selects the channel within a field. */
function ctrl(a: number, b: number, second = false): Pair[] {
  const pair: Pair = [parity(second ? a | 0x08 : a), parity(b)];
  return [pair, pair];
}

/** Encode a string of basic characters as byte pairs (odd length padded with null). */
function text(str: string): Pair[] {
  const pairs: Pair[] = [];
  for (let i = 0; i < str.length; i += 2) {
    pairs.push([
      parity(str.charCodeAt(i)),
      i + 1 < str.length ? parity(str.charCodeAt(i + 1)) : 0x80,
    ]);
  }
  return pairs;
}

function hex(pair: Pair) {
  return pair.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function frames(timecode: string) {
  const [h, m, s, f] = timecode.split(':').map(Number);
  return ((h * 60 + m) * 60 + s) * 30 + f;
}

/**
 * A caption "script": each entry is a timecode plus the pairs transmitted from that frame on, one
 * pair per frame (exactly how an SCC line is timed).
 */
type Script = [string, Pair[]][];

function toSCC(script: Script) {
  const lines = script.map(([tc, pairs]) => `${tc}\t${pairs.map(hex).join(' ')}`);
  return `Scenarist_SCC V1.0\n\n${lines.join('\n\n')}\n`;
}

/** Feed a script to a decoder as `cc_data` triplets, one triplet per frame on the given field. */
function feed(decoder: CEA608Decoder, script: Script, type: 0 | 1 = 0) {
  for (const [tc, pairs] of script) {
    pairs.forEach((pair, i) => {
      decoder.decodeCCData([{ type, data1: pair[0], data2: pair[1] }], (frames(tc) + i) / FPS);
    });
  }
}

function summarize(cue: VTTCue) {
  return {
    text: cue.text,
    startTime: cue.startTime,
    endTime: cue.endTime,
    snapToLines: cue.snapToLines,
    line: cue.line,
    lineAlign: cue.lineAlign,
    position: cue.position,
    positionAlign: cue.positionAlign,
    size: cue.size,
    align: cue.align,
  };
}

/** Pop-on caption on the given channel-within-field (CC1/CC3 or CC2/CC4). */
function popOn(second = false): Script {
  return [
    [
      '00:00:01:00',
      [
        ...ctrl(0x14, 0x20, second), // RCL
        ...ctrl(0x14, 0x2e, second), // ENM
        ...ctrl(0x14, 0x72, second), // PAC row 15, indent 4
        ...text('Hello world.'),
      ],
    ],
    ['00:00:01:15', ctrl(0x14, 0x2f, second)], // EOC
    ['00:00:03:00', ctrl(0x14, 0x2c, second)], // EDM
  ];
}

test('sanity: helpers produce well-known SCC words', () => {
  expect(ctrl(0x14, 0x20).map(hex)).toEqual(['9420', '9420']);
  expect(ctrl(0x14, 0x20, true).map(hex)).toEqual(['1c20', '1c20']);
  expect(text('Hello').map(hex)).toEqual(['c8e5', 'ecec', 'ef80']);
});

test('pop-on caption from cc_data triplets matches the SCC path', async () => {
  const onCue = vi.fn(),
    decoder = new CEA608Decoder({ onCue });

  feed(decoder, popOn());
  const scc = await parseText(toSCC(popOn()), { type: 'scc' });

  expect(scc.cues).toHaveLength(1);
  expect(decoder.cues).toHaveLength(1);
  expect(onCue).toHaveBeenCalledTimes(1);
  expect(onCue).toHaveBeenCalledWith(decoder.cues[0]);

  const cue = decoder.cues[0];
  expect(cue.text).toBe('Hello world.');
  expect(cue.startTime).toBeCloseTo(frames('00:00:01:15') / FPS, 10);
  expect(cue.endTime).toBeCloseTo(frames('00:00:03:00') / FPS, 10);
  expect(cue.snapToLines).toBe(false);
  expect(cue.line).toBeCloseTo((14 / 15) * 100, 10);
  expect(cue.position).toBe(12.5);
  expect(cue.size).toBe(87.5);
  expect(cue.align).toBe('left');

  expect(summarize(cue)).toEqual(summarize(scc.cues[0]));
});

test('decodePair accepts bytes with the parity bit already stripped', () => {
  const stripped = new CEA608Decoder(),
    withParity = new CEA608Decoder();

  for (const [tc, pairs] of popOn()) {
    pairs.forEach(([a, b], i) => {
      const time = (frames(tc) + i) / FPS;
      withParity.decodePair(a, b, time);
      stripped.decodePair(a & 0x7f, b & 0x7f, time);
    });
    withParity.commit();
    stripped.commit();
  }

  expect(withParity.cues.map(summarize)).toEqual(stripped.cues.map(summarize));
  expect(stripped.cues).toHaveLength(1);
});

test('field 2 (type 1) decodes on channel 3 and is ignored on channel 1', () => {
  const cc3 = new CEA608Decoder({ channel: 3 }),
    cc1 = new CEA608Decoder({ channel: 1 });

  feed(cc3, popOn(), 1);
  feed(cc1, popOn(), 1);

  expect(cc3.cues).toHaveLength(1);
  expect(cc3.cues[0].text).toBe('Hello world.');
  expect(cc3.cues[0].startTime).toBeCloseTo(frames('00:00:01:15') / FPS, 10);
  expect(cc3.cues[0].endTime).toBeCloseTo(frames('00:00:03:00') / FPS, 10);
  expect(cc1.cues).toHaveLength(0);

  // And the other way round: field 1 data never reaches a field 2 channel.
  const cc3FromField1 = new CEA608Decoder({ channel: 3 });
  feed(cc3FromField1, popOn(), 0);
  expect(cc3FromField1.cues).toHaveLength(0);

  // Same for `decodePair` with an explicit field.
  const direct = new CEA608Decoder({ channel: 1 });
  for (const [tc, pairs] of popOn()) {
    pairs.forEach(([a, b], i) => direct.decodePair(a, b, (frames(tc) + i) / FPS, 2));
    direct.commit();
  }
  direct.flush();
  expect(direct.cues).toHaveLength(0);
});

test('CC4 is field 2 with the channel bit set', () => {
  const cc4 = new CEA608Decoder({ channel: 4 }),
    cc3 = new CEA608Decoder({ channel: 3 }),
    cc2 = new CEA608Decoder({ channel: 2 });

  feed(cc4, popOn(true), 1);
  feed(cc3, popOn(true), 1);
  feed(cc2, popOn(true), 1);

  expect(cc4.cues).toHaveLength(1);
  expect(cc4.cues[0].text).toBe('Hello world.');
  // CC3 shares the field but not the channel bit.
  expect(cc3.cues).toHaveLength(0);
  // CC2 shares the channel bit but not the field.
  expect(cc2.cues).toHaveLength(0);
});

test('CC1 and CC3 interleaved on both fields decode independently', () => {
  const cc1 = new CEA608Decoder({ channel: 1 }),
    cc3 = new CEA608Decoder({ channel: 3 });

  const field1 = popOn(),
    field2: Script = [
      [
        '00:00:01:00',
        [...ctrl(0x14, 0x20), ...ctrl(0x14, 0x2e), ...ctrl(0x14, 0x70), ...text('Otro')],
      ],
      ['00:00:01:15', ctrl(0x14, 0x2f)],
      ['00:00:03:00', ctrl(0x14, 0x2c)],
    ];

  // Both fields are transmitted in the same frame, as in a real `cc_data` packet.
  for (let i = 0; i < field1.length; i++) {
    const [tc, pairs1] = field1[i],
      pairs2 = field2[i][1],
      count = Math.max(pairs1.length, pairs2.length);
    for (let j = 0; j < count; j++) {
      const p1 = pairs1[j] ?? [0x80, 0x80],
        p2 = pairs2[j] ?? [0x80, 0x80],
        triplets: CCDataTriplet[] = [
          { type: 0, data1: p1[0], data2: p1[1] },
          { type: 1, data1: p2[0], data2: p2[1] },
        ],
        time = (frames(tc) + j) / FPS;
      cc1.decodeCCData(triplets, time);
      cc3.decodeCCData(triplets, time);
    }
  }

  expect(cc1.cues.map((cue) => cue.text)).toEqual(['Hello world.']);
  expect(cc3.cues.map((cue) => cue.text)).toEqual(['Otro']);
});

test('parseCCData on an A/53 payload round-trips through the decoder', () => {
  const decoder = new CEA608Decoder(),
    script = popOn();

  for (const [tc, pairs] of script) {
    pairs.forEach((pair, i) => {
      const bytes = new Uint8Array([
        0x47, 0x41, 0x39, 0x34, // GA94
        0x03, // user_data_type_code = cc_data
        0x40 | 2, // process_cc_data_flag + cc_count = 2
        0xff, // em_data
        0xfc, pair[0], pair[1], // cc_valid, type 0 (field 1)
        0xfd, 0x80, 0x80, // cc_valid, type 1 (field 2) filler
      ]); // prettier-ignore

      const triplets = parseCCData(bytes);
      expect(triplets).toEqual([
        { type: 0, data1: pair[0], data2: pair[1] },
        { type: 1, data1: 0x80, data2: 0x80 },
      ]);

      decoder.decodeCCData(triplets, (frames(tc) + i) / FPS);
    });
  }

  expect(decoder.cues).toHaveLength(1);
  expect(decoder.cues[0].text).toBe('Hello world.');
  expect(decoder.cues[0].startTime).toBeCloseTo(frames('00:00:01:15') / FPS, 10);
  expect(decoder.cues[0].endTime).toBeCloseTo(frames('00:00:03:00') / FPS, 10);
});

test('invalid triplets are skipped', () => {
  const decoder = new CEA608Decoder(),
    [x1, x2] = text('XX')[0];

  for (const [tc, pairs] of popOn()) {
    pairs.forEach((pair, i) => {
      // A raw `cc_data()` structure (no GA94 prefix) with a stray invalid triplet in the middle.
      const bytes = new Uint8Array([
        0x40 | 3, 0xff,
        0xfc, pair[0], pair[1], // valid
        0xf8, x1, x2, // cc_valid = 0, would otherwise write "XX"
        0xfd, 0x80, 0x80, // valid field 2 filler
      ]); // prettier-ignore

      const triplets = parseCCData(bytes);
      expect(triplets).toHaveLength(2);
      expect(triplets.every((t) => t.data1 !== x1)).toBe(true);
      decoder.decodeCCData(triplets, (frames(tc) + i) / FPS);
    });
  }

  expect(decoder.cues).toHaveLength(1);
  expect(decoder.cues[0].text).toBe('Hello world.');

  // DTVCC triplets (types 2 and 3) are ignored by the 608 decoder.
  const dtvcc = new CEA608Decoder();
  for (const [tc, pairs] of popOn()) {
    pairs.forEach((pair, i) => {
      dtvcc.decodeCCData(
        [
          { type: 3, data1: pair[0], data2: pair[1] },
          { type: 2, data1: pair[0], data2: pair[1] },
        ],
        (frames(tc) + i) / FPS,
      );
    });
  }
  dtvcc.flush();
  expect(dtvcc.cues).toHaveLength(0);
});

test('flush() closes the open cue', () => {
  // Pop-on without a trailing EDM: the cue is open until flushed.
  const open: Script = popOn().slice(0, 2);

  const explicit = new CEA608Decoder();
  feed(explicit, open);
  expect(explicit.cues).toHaveLength(0);
  explicit.flush(5);
  expect(explicit.cues).toHaveLength(1);
  expect(explicit.cues[0].text).toBe('Hello world.');
  expect(explicit.cues[0].startTime).toBeCloseTo(frames('00:00:01:15') / FPS, 10);
  expect(explicit.cues[0].endTime).toBe(5);

  // Flushing again is a no-op.
  explicit.flush(6);
  expect(explicit.cues).toHaveLength(1);

  // Without an end time the cue closes at the last decoded time. The doubled EOC is the last
  // pair, so the cue would be zero-length and is extended by one frame instead.
  const implicit = new CEA608Decoder();
  feed(implicit, open);
  implicit.flush();
  expect(implicit.cues).toHaveLength(1);
  const start = frames('00:00:01:15') / FPS;
  expect(implicit.cues[0].startTime).toBeCloseTo(start, 10);
  expect(implicit.cues[0].endTime).toBeCloseTo(start + FRAME, 10);

  // With later data seen, the cue closes at the last decoded time.
  const later = new CEA608Decoder();
  feed(later, [...open, ['00:00:04:00', ctrl(0x14, 0x20)]]);
  later.flush();
  expect(later.cues).toHaveLength(1);
  expect(later.cues[0].endTime).toBeCloseTo((frames('00:00:04:00') + 1) / FPS, 10);

  // An end time at or before the start drops the cue.
  const dropped = new CEA608Decoder();
  feed(dropped, open);
  dropped.flush(0);
  expect(dropped.cues).toHaveLength(0);
});

test('commit() is the frame boundary for paint-on and roll-up text', () => {
  const decoder = new CEA608Decoder(),
    t = (tc: string, offset = 0) => (frames(tc) + offset) / FPS;

  // Paint-on: chars write straight to the displayed memory but only become a cue on commit.
  const load = [...ctrl(0x14, 0x29), ...ctrl(0x14, 0x70), ...text('One')];
  load.forEach(([a, b], i) => decoder.decodePair(a, b, t('00:00:01:00', i)));
  expect(decoder.cues).toHaveLength(0);
  decoder.commit();

  text(' two').forEach(([a, b], i) => decoder.decodePair(a, b, t('00:00:02:00', i)));
  decoder.commit();

  ctrl(0x14, 0x2c).forEach(([a, b], i) => decoder.decodePair(a, b, t('00:00:03:00', i)));
  decoder.commit();

  expect(decoder.cues.map((cue) => cue.text)).toEqual(['One', 'One two']);
  expect(decoder.cues[0].startTime).toBeCloseTo(t('00:00:01:00', 4), 10);
  expect(decoder.cues[0].endTime).toBeCloseTo(t('00:00:02:00'), 10);
  expect(decoder.cues[1].endTime).toBeCloseTo(t('00:00:03:00'), 10);

  // Roll-up through `decodeCCData`, which commits after every frame.
  const rollUp = new CEA608Decoder({ channel: 1 });
  feed(rollUp, [
    ['00:00:01:00', [...ctrl(0x14, 0x25), ...ctrl(0x14, 0x70), ...text('HELLO')]],
    ['00:00:02:00', [...ctrl(0x14, 0x2d), ...text('WORLD')]],
    ['00:00:03:00', ctrl(0x14, 0x2c)],
  ]);

  // Every frame's characters are committed, so the text grows one pair at a time.
  const texts = rollUp.cues.map((cue) => cue.text);
  expect(texts[0]).toBe('HE');
  expect(texts).toContain('HELLO');
  expect(texts).toContain('HELLO\nWO');
  expect(texts[texts.length - 1]).toBe('HELLO\nWORLD');
  expect(rollUp.cues[rollUp.cues.length - 1].endTime).toBeCloseTo(t('00:00:03:00'), 10);
  expect(rollUp.cues[0].startTime).toBeCloseTo(t('00:00:01:00', 4), 10);
});

test('reset() clears state and cues', () => {
  const decoder = new CEA608Decoder();
  feed(decoder, popOn().slice(0, 2));
  decoder.reset();
  expect(decoder.cues).toHaveLength(0);

  // Nothing is left open after a reset.
  decoder.flush(10);
  expect(decoder.cues).toHaveLength(0);

  // The decoder is fully usable afterwards.
  feed(decoder, popOn());
  expect(decoder.cues).toHaveLength(1);
  expect(decoder.cues[0].text).toBe('Hello world.');
});

test('sccChannelOf reports the channel bit', () => {
  expect(sccChannelOf(0x14)).toBe(1);
  expect(sccChannelOf(0x1c)).toBe(2);
  expect(sccChannelOf(0x20)).toBeNull();
});

// --- Live mode ---

type LiveEvent = ['add' | 'update', VTTCue];

function liveDecoder(events: LiveEvent[], channel: 1 | 2 | 3 | 4 = 1) {
  return new CEA608Decoder({
    channel,
    live: true,
    onCue: (cue) => events.push(['add', cue]),
    onCueUpdate: (cue) => events.push(['update', cue]),
  });
}

const tuple = (cue: VTTCue) => [cue.text, cue.startTime, cue.endTime];

test('live mode: pop-on cue is emitted when it starts and updated in place at EDM', () => {
  const onCue = vi.fn(),
    onCueUpdate = vi.fn(),
    decoder = new CEA608Decoder({ live: true, onCue, onCueUpdate }),
    script = popOn();

  // Load and flip (EOC) but do not erase yet.
  feed(decoder, script.slice(0, 2));
  expect(onCue).toHaveBeenCalledTimes(1);
  expect(onCueUpdate).not.toHaveBeenCalled();

  const cue: VTTCue = onCue.mock.calls[0][0];
  expect(cue.text).toBe('Hello world.');
  expect(cue.startTime).toBeCloseTo(frames('00:00:01:15') / FPS, 10);
  expect(cue.endTime).toBe(Infinity);
  expect(decoder.cues).toHaveLength(1);
  expect(decoder.cues[0]).toBe(cue);

  // EDM closes it: same object, end time filled in, no second cue.
  feed(decoder, script.slice(2));
  expect(onCueUpdate).toHaveBeenCalledTimes(1);
  expect(onCueUpdate.mock.calls[0][0]).toBe(cue);
  expect(cue.endTime).toBeCloseTo(frames('00:00:03:00') / FPS, 10);
  expect(onCue).toHaveBeenCalledTimes(1);
  expect(decoder.cues).toHaveLength(1);
  expect(decoder.cues[0]).toBe(cue);

  // Positioning is identical to the non-live path.
  const batch = new CEA608Decoder();
  feed(batch, script);
  expect(decoder.cues.map(summarize)).toEqual(batch.cues.map(summarize));
});

test('live mode: roll-up emits an add/update pair per change with stable identities', () => {
  const events: LiveEvent[] = [],
    decoder = liveDecoder(events),
    script: Script = [
      ['00:00:01:00', [...ctrl(0x14, 0x25), ...ctrl(0x14, 0x70), ...text('HELLO')]],
      ['00:00:02:00', [...ctrl(0x14, 0x2d), ...text('WORLD')]],
      ['00:00:03:00', ctrl(0x14, 0x2c)],
    ];

  feed(decoder, script);

  // Events strictly alternate: each add is closed by an update of the very same object before
  // the next cue is added.
  expect(events.length % 2).toBe(0);
  for (let i = 0; i < events.length; i += 2) {
    expect(events[i][0]).toBe('add');
    expect(events[i + 1][0]).toBe('update');
    expect(events[i + 1][1]).toBe(events[i][1]);
  }

  const adds = events.filter(([type]) => type === 'add').map(([, cue]) => cue);
  expect(adds.length).toBeGreaterThan(3);
  expect(new Set(adds).size).toBe(adds.length);
  expect(adds[0].text).toBe('HE');
  expect(adds.map((cue) => cue.text)).toContain('HELLO\nWO');
  expect(adds[adds.length - 1].text).toBe('HELLO\nWORLD');
  expect(adds[adds.length - 1].endTime).toBeCloseTo(frames('00:00:03:00') / FPS, 10);

  // Cues abut, and `cues` holds each object exactly once, in order.
  for (let i = 1; i < adds.length; i++) expect(adds[i - 1].endTime).toBe(adds[i].startTime);
  expect(decoder.cues).toHaveLength(adds.length);
  adds.forEach((cue, i) => expect(decoder.cues[i]).toBe(cue));

  // The final live state matches a non-live run on the same bytes.
  const batch = new CEA608Decoder();
  feed(batch, script);
  expect(decoder.cues.map(tuple)).toEqual(batch.cues.map(tuple));
});

test('live mode: paint-on growth through commit() matches the non-live run', () => {
  const events: LiveEvent[] = [],
    decoder = liveDecoder(events),
    batch = new CEA608Decoder(),
    t = (tc: string, offset = 0) => (frames(tc) + offset) / FPS;

  for (const d of [decoder, batch]) {
    [...ctrl(0x14, 0x29), ...ctrl(0x14, 0x70), ...text('One')].forEach(([a, b], i) =>
      d.decodePair(a, b, t('00:00:01:00', i)),
    );
    d.commit();
    text(' two').forEach(([a, b], i) => d.decodePair(a, b, t('00:00:02:00', i)));
    d.commit();
    ctrl(0x14, 0x2c).forEach(([a, b], i) => d.decodePair(a, b, t('00:00:03:00', i)));
    d.commit();
  }

  expect(events.map(([type, cue]) => [type, cue.text])).toEqual([
    ['add', 'One'],
    ['update', 'One'],
    ['add', 'One two'],
    ['update', 'One two'],
  ]);
  expect(events[1][1]).toBe(events[0][1]);
  expect(events[3][1]).toBe(events[2][1]);
  expect(events[2][1]).not.toBe(events[0][1]);
  expect(decoder.cues.map(tuple)).toEqual(batch.cues.map(tuple));
});

test('live mode: flush() closes the open cue in place', () => {
  const onCueUpdate = vi.fn(),
    decoder = new CEA608Decoder({ live: true, onCueUpdate });

  feed(decoder, popOn().slice(0, 2));
  expect(decoder.cues).toHaveLength(1);
  const cue = decoder.cues[0];
  expect(cue.endTime).toBe(Infinity);

  decoder.flush(5);
  expect(cue.endTime).toBe(5);
  expect(onCueUpdate).toHaveBeenCalledTimes(1);
  expect(onCueUpdate).toHaveBeenCalledWith(cue);
  expect(decoder.cues).toHaveLength(1);
  expect(decoder.cues[0]).toBe(cue);

  // Flushing again is a no-op.
  decoder.flush(6);
  expect(cue.endTime).toBe(5);
  expect(onCueUpdate).toHaveBeenCalledTimes(1);

  // Without an end time the same one-frame minimum applies as in non-live mode.
  const implicit = new CEA608Decoder({ live: true });
  feed(implicit, popOn().slice(0, 2));
  implicit.flush();
  const start = frames('00:00:01:15') / FPS;
  expect(implicit.cues[0].endTime).toBeCloseTo(start + FRAME, 10);
});

test('live mode: reset() closes the open cue at the last decoded time before clearing', () => {
  const onCueUpdate = vi.fn(),
    decoder = new CEA608Decoder({ live: true, onCueUpdate });

  feed(decoder, [...popOn().slice(0, 2), ['00:00:04:00', ctrl(0x14, 0x20)]]);
  const cue = decoder.cues[0];
  expect(cue.endTime).toBe(Infinity);

  decoder.reset();
  expect(onCueUpdate).toHaveBeenCalledTimes(1);
  expect(onCueUpdate).toHaveBeenCalledWith(cue);
  expect(cue.endTime).toBeCloseTo((frames('00:00:04:00') + 1) / FPS, 10);
  expect(decoder.cues).toHaveLength(0);

  // Fully usable afterwards.
  feed(decoder, popOn());
  expect(decoder.cues).toHaveLength(1);
  expect(decoder.cues[0].endTime).toBeCloseTo(frames('00:00:03:00') / FPS, 10);
});

test('live mode: a cue that ends the instant it starts is withdrawn', () => {
  const onCue = vi.fn(),
    onCueUpdate = vi.fn(),
    decoder = new CEA608Decoder({ live: true, onCue, onCueUpdate }),
    batch = new CEA608Decoder(),
    // EOC immediately followed by EDM at the same time: the caption is never really visible.
    pairs = [
      ...ctrl(0x14, 0x20),
      ...ctrl(0x14, 0x70),
      ...text('Gone'),
      ...ctrl(0x14, 0x2f),
      ...ctrl(0x14, 0x2c),
    ];

  for (const d of [decoder, batch]) {
    pairs.forEach(([a, b]) => d.decodePair(a, b, 1));
    d.commit();
  }

  // Announced when displayed, then reported as zero-length so a renderer can drop it.
  expect(onCue).toHaveBeenCalledTimes(1);
  expect(onCueUpdate).toHaveBeenCalledTimes(1);
  const cue: VTTCue = onCue.mock.calls[0][0];
  expect(onCueUpdate.mock.calls[0][0]).toBe(cue);
  expect(cue.endTime).toBe(cue.startTime);
  expect(decoder.cues).toHaveLength(0);
  expect(batch.cues).toHaveLength(0);
});

test('live mode is off by default and leaves non-live output untouched', () => {
  const onCueUpdate = vi.fn(),
    decoder = new CEA608Decoder({ onCueUpdate });
  feed(decoder, popOn());
  decoder.flush();
  expect(onCueUpdate).not.toHaveBeenCalled();
  expect(decoder.cues).toHaveLength(1);
  expect(decoder.cues[0].endTime).toBeCloseTo(frames('00:00:03:00') / FPS, 10);
});
