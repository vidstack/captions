import type { CCDataTriplet } from '../../src/cea/cc-data';
import { CEA708Decoder } from '../../src/cea/cea708-decoder';

/**
 * Build the `cc_data` triplets of one DTVCC packet from its payload (service blocks). The packet
 * header carries the sequence number (top 2 bits) and the size in 16-bit words including the
 * header byte; the payload is zero padded up to a whole word.
 */
function packet(payload: number[], sequence = 0): CCDataTriplet[] {
  const words = Math.ceil((payload.length + 1) / 2),
    data = payload.slice();
  while (data.length < words * 2 - 1) data.push(0);

  const triplets: CCDataTriplet[] = [
    { type: 3, data1: (sequence << 6) | (words === 64 ? 0 : words), data2: data[0] },
  ];
  for (let i = 1; i < data.length; i += 2) {
    triplets.push({ type: 2, data1: data[i], data2: data[i + 1] });
  }
  return triplets;
}

/**
 * Service block(s) for `service`: a header (+ extended header for services above 6) followed by
 * the data. Block sizes are limited to 31 bytes, so longer data spans several blocks.
 */
function block(service: number, data: number[]) {
  const out: number[] = [];
  for (let i = 0; i < data.length; i += 31) {
    const chunk = data.slice(i, i + 31);
    if (service <= 6) out.push((service << 5) | chunk.length);
    else out.push(0xe0 | chunk.length, service & 0x3f);
    out.push(...chunk);
  }
  return out;
}

/** One packet holding the service block(s) for `service`. */
function svc(data: number[], service = 1, sequence = 0) {
  return packet(block(service, data), sequence);
}

interface WindowInit {
  id?: number;
  visible?: boolean;
  relative?: boolean;
  av?: number;
  ah?: number;
  anchor?: number;
  rows?: number;
  cols?: number;
  style?: number;
}

/** DFx (define window) command, 6 parameter bytes. */
function DF({
  id = 0,
  visible = false,
  relative = false,
  av = 0,
  ah = 0,
  anchor = 0,
  rows = 1,
  cols = 32,
  style = 1,
}: WindowInit = {}) {
  return [
    0x98 + id,
    (visible ? 0x20 : 0) | 0x18, // row lock + column lock, priority 0
    (relative ? 0x80 : 0) | av,
    ah,
    (anchor << 4) | (rows - 1),
    cols - 1,
    (style << 3) | 1,
  ];
}

const text = (str: string) => Array.from(str, (c) => c.charCodeAt(0)),
  CW = (id: number) => [0x80 + id],
  CLW = (bitmap: number) => [0x88, bitmap],
  DSW = (bitmap: number) => [0x89, bitmap],
  HDW = (bitmap: number) => [0x8a, bitmap],
  TGW = (bitmap: number) => [0x8b, bitmap],
  DLW = (bitmap: number) => [0x8c, bitmap],
  DLY = (ticks: number) => [0x8d, ticks],
  RST = [0x8f],
  SPA = (italics: boolean, underline: boolean) => [
    0x90,
    0x00,
    (italics ? 0x80 : 0) | (underline ? 0x40 : 0),
  ],
  /** Foreground/background as opacity (2 bits) + RGB (2 bits each). */
  SPC = (fg: number, bg = 0) => [0x91, fg, bg, 0x00],
  SPL = (row: number, col: number) => [0x92, row, col],
  /** SWA with the given justification (0 left, 1 right, 2 center) and word wrap flag. */
  SWA = (justify: number, wordWrap = false) => [
    0x97,
    0x00,
    0x00,
    (wordWrap ? 0x40 : 0) | justify,
    0x00,
  ],
  ETX = [0x03],
  CR = [0x0d],
  FF = [0x0c],
  BS = [0x08],
  EXT1 = 0x10;

/** Absolute anchor: row 15 of 75 (20%), column 42 of 210 (20%). */
const HELLO = [...DF({ av: 15, ah: 42 }), ...SPL(0, 0), ...text('Hello'), ...DSW(1)];

test('define window, write text, and display it', () => {
  const decoder = new CEA708Decoder();
  decoder.decodeCCData(svc(HELLO), 1);
  expect(decoder.cues).toHaveLength(0);
  decoder.flush(5);

  expect(decoder.cues).toHaveLength(1);
  const cue = decoder.cues[0];
  expect(cue.startTime).toBe(1);
  expect(cue.endTime).toBe(5);
  expect(cue.text).toBe('Hello');
  expect(cue.snapToLines).toBe(false);
  expect(cue.line).toBeCloseTo(20);
  expect(cue.lineAlign).toBe('start');
  expect(cue.position).toBeCloseTo(20);
  expect(cue.positionAlign).toBe('line-left');
  expect(cue.size).toBe(100);
  expect(cue.align).toBe('left');
});

test('hiding a window ends its cue', () => {
  const cues: string[] = [],
    decoder = new CEA708Decoder({ onCue: (cue) => cues.push(cue.text) });
  decoder.decodeCCData(svc(HELLO), 1);
  decoder.decodeCCData(svc(HDW(1)), 3);

  expect(cues).toEqual(['Hello']);
  expect(decoder.cues[0].endTime).toBe(3);
  decoder.flush(10);
  expect(decoder.cues).toHaveLength(1);
});

test('text written to a hidden window is not emitted until it is displayed', () => {
  const decoder = new CEA708Decoder();
  decoder.decodeCCData(svc([...DF(), ...text('Later')]), 1);
  decoder.decodeCCData(svc(DSW(1)), 2);
  decoder.flush(3);

  expect(decoder.cues).toHaveLength(1);
  expect(decoder.cues[0].startTime).toBe(2);
  expect(decoder.cues[0].text).toBe('Later');
});

test('carriage return starts a new row', () => {
  const decoder = new CEA708Decoder();
  decoder.decodeCCData(
    svc([...DF({ rows: 2 }), ...text('first'), ...CR, ...text('second'), ...DSW(1)]),
    1,
  );
  decoder.flush(2);
  expect(decoder.cues[0].text).toBe('first\nsecond');
});

test('carriage return on the last row scrolls the window up', () => {
  const decoder = new CEA708Decoder();
  decoder.decodeCCData(
    svc([...DF({ rows: 2 }), ...text('one'), ...CR, ...text('two'), ...DSW(1)]),
    1,
  );
  decoder.decodeCCData(svc([...CR, ...text('three')]), 2);
  decoder.flush(3);

  expect(decoder.cues.map((cue) => cue.text)).toEqual(['one\ntwo', 'two\nthree']);
  expect(decoder.cues[0].endTime).toBe(2);
  expect(decoder.cues[1].startTime).toBe(2);
});

test('pen attributes toggle italics and underline', () => {
  const decoder = new CEA708Decoder();
  decoder.decodeCCData(
    svc([
      ...DF(),
      ...SPA(true, false),
      ...text('Hi'),
      ...SPA(false, false),
      ...text(' there'),
      ...SPA(true, true),
      ...text('!'),
      ...DSW(1),
    ]),
    1,
  );
  decoder.flush(2);
  expect(decoder.cues[0].text).toBe('<i>Hi</i> there<i><u>!</u></i>');
});

test('pen colour becomes a hex colour class, white is unstyled', () => {
  const decoder = new CEA708Decoder();
  decoder.decodeCCData(
    svc([
      ...DF(),
      ...SPC(0x30), // red
      ...text('Red'),
      ...SPC(0x3f), // white
      ...text(' and '),
      ...SPC(0x2a), // #aaaaaa
      ...text('grey'),
      ...DSW(1),
    ]),
    1,
  );
  decoder.flush(2);
  expect(decoder.cues[0].text).toBe('<c.#ff0000>Red</c> and <c.#aaaaaa>grey</c>');
});

test('G0 music note, G2 characters via EXT1, and Latin-1 G1', () => {
  const decoder = new CEA708Decoder();
  decoder.decodeCCData(
    svc([
      ...DF(),
      0x7f, // music note
      EXT1,
      0x25, // ellipsis
      EXT1,
      0x39, // trademark
      0xe9, // é
      ...text(' <&>'),
      ...DSW(1),
    ]),
    1,
  );
  decoder.flush(2);
  expect(decoder.cues[0].text).toBe('♪…™é &lt;&amp;>');
});

test('P16 writes a UTF-16 code unit', () => {
  const decoder = new CEA708Decoder();
  decoder.decodeCCData(svc([...DF(), 0x18, 0x30, 0x42, ...DSW(1)]), 1);
  decoder.flush(2);
  expect(decoder.cues[0].text).toBe('あ');
});

test('a packet split across two cc_data groups is reassembled', () => {
  const decoder = new CEA708Decoder(),
    triplets = svc(HELLO),
    half = Math.floor(triplets.length / 2);

  decoder.decodeCCData(triplets.slice(0, half), 1);
  expect(decoder.cues).toHaveLength(0);
  decoder.decodeCCData(triplets.slice(half), 1.5);
  decoder.flush(2);

  expect(decoder.cues).toHaveLength(1);
  expect(decoder.cues[0].startTime).toBe(1.5);
  expect(decoder.cues[0].text).toBe('Hello');
});

test('a multi-byte command split across two packets is reassembled', () => {
  const decoder = new CEA708Decoder(),
    data = [...DF(), ...text('Hi'), ...DSW(1)],
    // Split inside the 7-byte DF0 command.
    first = data.slice(0, 3),
    second = data.slice(3);

  decoder.decodeCCData(svc(first, 1, 0), 1);
  decoder.decodeCCData(svc(second, 1, 1), 2);
  decoder.flush(3);

  expect(decoder.cues).toHaveLength(1);
  expect(decoder.cues[0].text).toBe('Hi');
});

test('608 triplets and continuation without a packet start are ignored', () => {
  const decoder = new CEA708Decoder();
  decoder.decodeCCData(
    [
      { type: 0, data1: 0x94, data2: 0x20 },
      { type: 1, data1: 0x80, data2: 0x80 },
      { type: 2, data1: 0x89, data2: 0x01 },
    ],
    1,
  );
  decoder.flush(2);
  expect(decoder.cues).toHaveLength(0);
});

test('other services are ignored unless selected', () => {
  const service1 = new CEA708Decoder(),
    service2 = new CEA708Decoder({ service: 2 });

  const triplets = packet([
    ...block(1, [...DF(), ...text('one'), ...DSW(1)]),
    ...block(2, [...DF(), ...text('two'), ...DSW(1)]),
  ]);

  service1.decodeCCData(triplets, 1);
  service2.decodeCCData(triplets, 1);
  service1.flush(2);
  service2.flush(2);

  expect(service1.cues.map((cue) => cue.text)).toEqual(['one']);
  expect(service2.cues.map((cue) => cue.text)).toEqual(['two']);
});

test('extended service numbers use the two-byte block header', () => {
  const decoder = new CEA708Decoder({ service: 8 }),
    other = new CEA708Decoder({ service: 1 });

  const triplets = svc([...DF(), ...text('eight'), ...DSW(1)], 8);
  decoder.decodeCCData(triplets, 1);
  other.decodeCCData(triplets, 1);
  decoder.flush(2);
  other.flush(2);

  expect(decoder.cues.map((cue) => cue.text)).toEqual(['eight']);
  expect(other.cues).toHaveLength(0);
});

test('RST clears all windows and closes cues', () => {
  const decoder = new CEA708Decoder();
  decoder.decodeCCData(svc(HELLO), 1);
  decoder.decodeCCData(svc(RST), 2);
  // No window is defined anymore, so text and display commands have no effect.
  decoder.decodeCCData(svc([...text('lost'), ...DSW(1)]), 3);
  decoder.flush(4);

  expect(decoder.cues).toHaveLength(1);
  expect(decoder.cues[0].endTime).toBe(2);
});

test('flush without a time ends the cue at the last decode time', () => {
  const decoder = new CEA708Decoder();
  decoder.decodeCCData(svc(HELLO), 1);
  decoder.decodeCCData(svc(DLY(5)), 4);
  decoder.flush();

  expect(decoder.cues).toHaveLength(1);
  expect(decoder.cues[0].endTime).toBe(4);
  // Flushing again is a no-op.
  decoder.flush();
  expect(decoder.cues).toHaveLength(1);
});

test('flush without any later time still yields a non-empty cue', () => {
  const decoder = new CEA708Decoder();
  decoder.decodeCCData(svc(HELLO), 1);
  decoder.flush();
  expect(decoder.cues).toHaveLength(1);
  expect(decoder.cues[0].endTime).toBeGreaterThan(1);
});

test('reset drops state and cues', () => {
  const decoder = new CEA708Decoder();
  decoder.decodeCCData(svc(HELLO), 1);
  decoder.flush(2);
  expect(decoder.cues).toHaveLength(1);

  decoder.reset();
  expect(decoder.cues).toHaveLength(0);
  decoder.decodeCCData(svc([...text('gone'), ...DSW(1)]), 3);
  decoder.flush(4);
  expect(decoder.cues).toHaveLength(0);
});

test('identical content is coalesced into one cue', () => {
  const decoder = new CEA708Decoder();
  decoder.decodeCCData(svc(HELLO), 1);
  // Redraw the same text and re-display the window.
  decoder.decodeCCData(svc([...SPL(0, 0), ...text('Hello'), ...DSW(1), ...ETX]), 2);
  decoder.flush(3);

  expect(decoder.cues).toHaveLength(1);
  expect(decoder.cues[0].startTime).toBe(1);
  expect(decoder.cues[0].endTime).toBe(3);
});

test('each visible window becomes its own cue', () => {
  const decoder = new CEA708Decoder();
  decoder.decodeCCData(
    svc([
      ...DF({ id: 0, relative: true, av: 10, ah: 50, anchor: 1 }),
      ...text('top'),
      ...DF({ id: 1, relative: true, av: 90, ah: 50, anchor: 7 }),
      ...text('bottom'),
      ...DSW(0b11),
    ]),
    1,
  );
  decoder.decodeCCData(svc(TGW(0b01)), 2);
  decoder.flush(3);

  expect(decoder.cues).toHaveLength(2);
  const [top, bottom] = decoder.cues;
  expect(top.text).toBe('top');
  expect(top.endTime).toBe(2);
  expect(top.line).toBe(10);
  expect(top.lineAlign).toBe('start');
  expect(bottom.text).toBe('bottom');
  expect(bottom.endTime).toBe(3);
  expect(bottom.line).toBe(90);
  expect(bottom.lineAlign).toBe('end');
});

test('CLW clears text, FF resets the pen, BS erases, and CW selects the window', () => {
  const decoder = new CEA708Decoder();
  decoder.decodeCCData(
    svc([
      ...DF({ id: 0 }),
      ...text('zero'),
      ...DF({ id: 1, av: 10 }),
      ...text('one'),
      ...DSW(0b11),
    ]),
    1,
  );
  decoder.decodeCCData(svc([...CLW(0b10), ...CW(0), ...BS, ...text('O!')]), 2);
  decoder.decodeCCData(svc([...FF, ...text('new')]), 3);
  decoder.flush(4);

  expect(decoder.cues.map((cue) => [cue.text, cue.startTime, cue.endTime])).toEqual([
    ['zero', 1, 2],
    ['one', 1, 2],
    ['zerO!', 2, 3],
    ['new', 3, 4],
  ]);
});

test('text past the right edge is truncated unless the window word wraps', () => {
  const fixed = new CEA708Decoder(),
    wrapped = new CEA708Decoder();

  fixed.decodeCCData(svc([...DF({ rows: 2, cols: 4 }), ...text('abcdef'), ...DSW(1)]), 1);
  wrapped.decodeCCData(
    svc([...DF({ rows: 2, cols: 4 }), ...SWA(0, true), ...text('abcdef'), ...DSW(1)]),
    1,
  );
  fixed.flush(2);
  wrapped.flush(2);

  expect(fixed.cues[0].text).toBe('abcd');
  expect(wrapped.cues[0].text).toBe('abcd\nef');
});

test('window anchor points map onto line and position alignment', () => {
  const decoder = new CEA708Decoder();
  decoder.decodeCCData(
    svc([
      ...DF({ relative: true, av: 50, ah: 50, anchor: 4, cols: 16 }),
      ...SWA(1),
      ...text('mid'),
      ...DSW(1),
    ]),
    1,
  );
  decoder.decodeCCData(
    svc([...DLW(1), ...DF({ av: 75, ah: 210, anchor: 8 }), ...text('br'), ...DSW(1)]),
    2,
  );
  decoder.flush(3);

  const [mid, br] = decoder.cues;
  expect(mid.line).toBe(50);
  expect(mid.lineAlign).toBe('center');
  expect(mid.position).toBe(50);
  expect(mid.positionAlign).toBe('center');
  expect(mid.size).toBe(50);
  expect(mid.align).toBe('right');

  expect(br.line).toBe(100);
  expect(br.lineAlign).toBe('end');
  expect(br.position).toBe(100);
  expect(br.positionAlign).toBe('line-right');
});

test('real-world pop-on sequence: delete all, define, write two rows, display', () => {
  const decoder = new CEA708Decoder();
  decoder.decodeCCData(
    svc([
      ...DLW(0xff),
      ...DF({ id: 0, relative: true, av: 90, ah: 50, anchor: 7, rows: 2, cols: 32 }),
      ...SWA(2),
      ...SPL(0, 0),
      ...text('line one'),
      ...CR,
      ...text('line two'),
      ...DSW(1),
    ]),
    10,
  );
  decoder.decodeCCData(svc([...DLW(1)]), 12.5);

  expect(decoder.cues).toHaveLength(1);
  const cue = decoder.cues[0];
  expect(cue.startTime).toBe(10);
  expect(cue.endTime).toBe(12.5);
  expect(cue.text).toBe('line one\nline two');
  expect(cue.snapToLines).toBe(false);
  expect(cue.line).toBe(90);
  expect(cue.lineAlign).toBe('end');
  expect(cue.position).toBe(50);
  expect(cue.positionAlign).toBe('center');
  expect(cue.size).toBe(100);
  expect(cue.align).toBe('center');
});
