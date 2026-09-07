import type { CCDataTriplet } from '../../src/cea/cc-data';
import { CEA708Decoder } from '../../src/cea/cea708-decoder';
import type { VTTCue } from '../../src/vtt/vtt-cue';

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
  /**
   * SPA: byte 1 is text tag (4 bits), offset (2 bits: 1 normal), pen size (2 bits: 0 small,
   * 1 standard, 2 large); byte 2 is italics, underline, edge type (3 bits), font style (3 bits).
   */
  SPA = (italics: boolean, underline: boolean, { size = 1, edge = 0, font = 0 } = {}) => [
    0x90,
    0x04 | size,
    (italics ? 0x80 : 0) | (underline ? 0x40 : 0) | (edge << 3) | font,
  ],
  /** Foreground/background as opacity (2 bits) + RGB (2 bits each), then the edge RGB. */
  SPC = (fg: number, bg = 0, edge = 0) => [0x91, fg, bg, edge],
  SPL = (row: number, col: number) => [0x92, row, col],
  /**
   * SWA with the given justification (0 left, 1 right, 2 center), word wrap flag, and optional
   * fill / border / direction / display effect fields.
   */
  SWA = (
    justify: number,
    wordWrap = false,
    {
      fillOpacity = 0,
      fillColor = 0,
      borderType = 0,
      borderColor = 0,
      printDirection = 0,
      scrollDirection = 3,
      effect = 0,
      effectDirection = 0,
      effectSpeed = 0,
    } = {},
  ) => [
    0x97,
    (fillOpacity << 6) | fillColor,
    ((borderType & 0x03) << 6) | borderColor,
    ((borderType & 0x04) << 5) |
      (wordWrap ? 0x40 : 0) |
      (printDirection << 4) |
      (scrollDirection << 2) |
      justify,
    (effect << 6) | (effectDirection << 4) | effectSpeed,
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

// --- Window attributes, pen attributes, and directions ---

/** Decode one group and flush, returning the single resulting cue. */
function decodeOne(data: number[]) {
  const decoder = new CEA708Decoder();
  decoder.decodeCCData(svc(data), 1);
  decoder.flush(2);
  expect(decoder.cues).toHaveLength(1);
  return decoder.cues[0];
}

test('pen sizes wrap runs in pen-small / pen-large classes, nested inside colour and style', () => {
  const cue = decodeOne([
    ...DF(),
    ...SPA(false, false, { size: 0 }),
    ...text('tiny'),
    ...SPA(false, false),
    ...text(' normal '),
    ...SPA(true, true, { size: 2 }),
    ...SPC(0x30), // red
    ...text('BIG'),
    ...DSW(1),
  ]);
  expect(cue.text).toBe(
    '<c.pen-small>tiny</c> normal <c.#ff0000><c.pen-large><i><u>BIG</u></i></c></c>',
  );
  expect(cue.textStyle).toBeUndefined();
});

test('standard pen size and reserved size value leave the text unwrapped', () => {
  const cue = decodeOne([
    ...DF(),
    ...SPA(false, false, { size: 1 }),
    ...text('one '),
    ...SPA(false, false, { size: 3 }),
    ...text('two'),
    ...DSW(1),
  ]);
  expect(cue.text).toBe('one two');
});

test.each([
  [1, 'raised', { textShadow: '-0.04em -0.04em 0 #000000' }],
  [2, 'depressed', { textShadow: '0.04em 0.04em 0 #000000' }],
  [3, 'uniform', { textStroke: '0.08em #000000' }],
  [4, 'left drop shadow', { textShadow: '-0.06em 0.06em 0.06em #000000' }],
  [5, 'right drop shadow', { textShadow: '0.06em 0.06em 0.06em #000000' }],
])(
  'pen edge type %i (%s) maps onto the cue text style with a black default colour',
  (edge, _, style) => {
    const cue = decodeOne([...DF(), ...SPA(false, false, { edge }), ...text('Edge'), ...DSW(1)]);
    expect(cue.text).toBe('Edge');
    expect(cue.textStyle).toEqual(style);
  },
);

test('edge colour comes from SPC and the first non-none edge in the window wins', () => {
  const cue = decodeOne([
    ...DF({ rows: 2 }),
    ...text('plain '),
    ...SPA(false, false, { edge: 3 }),
    ...SPC(0x3f, 0, 0x03), // blue edge
    ...text('stroked'),
    ...CR,
    ...SPA(false, false, { edge: 1 }),
    ...SPC(0x3f, 0, 0x30), // red edge, ignored
    ...text('raised'),
    ...DSW(1),
  ]);
  expect(cue.text).toBe('plain stroked\nraised');
  expect(cue.textStyle).toEqual({ textStroke: '0.08em #0000ff' });
});

test('no edge type yields no text stroke or shadow', () => {
  const cue = decodeOne([
    ...DF(),
    ...SPA(false, false, { edge: 0 }),
    ...SPC(0x3f, 0, 0x30),
    ...text('Flat'),
    ...DSW(1),
  ]);
  expect(cue.textStyle).toBeUndefined();
});

test('window fill: translucent, transparent, and coloured fills become rgba backgrounds', () => {
  const translucent = decodeOne([
      ...DF(),
      ...SWA(0, false, { fillOpacity: 2 }),
      ...text('a'),
      ...DSW(1),
    ]),
    transparent = decodeOne([
      ...DF(),
      ...SWA(0, false, { fillOpacity: 3 }),
      ...text('a'),
      ...DSW(1),
    ]),
    // Flash is rendered as solid; 2-bit colour 0b10_01_11 -> rgb(170,85,255).
    flash = decodeOne([
      ...DF(),
      ...SWA(0, false, { fillOpacity: 1, fillColor: 0x27 }),
      ...text('a'),
      ...DSW(1),
    ]),
    solidBlack = decodeOne([...DF(), ...SWA(0), ...text('a'), ...DSW(1)]);

  expect(translucent.textStyle).toEqual({ backgroundColor: 'rgba(0,0,0,0.5)' });
  expect(transparent.textStyle).toEqual({ backgroundColor: 'rgba(0,0,0,0)' });
  expect(flash.textStyle).toEqual({ backgroundColor: 'rgba(170,85,255,1)' });
  // The default solid black fill is left to the renderer.
  expect(solidBlack.textStyle).toBeUndefined();
});

test('window border becomes an outline in the border colour', () => {
  const cue = decodeOne([
    ...DF(),
    // Border type 5 (shadow right) exercises the high bit carried in the third byte.
    ...SWA(0, false, { fillOpacity: 3, borderType: 5, borderColor: 0x3c }), // yellow
    ...SPC(0x3f, 0x30), // red pen background on a transparent fill: rendered as a span
    ...text('Boxed'),
    ...DSW(1),
  ]);
  expect(cue.text).toMatch(/^<c\.s-[\w-]+>Boxed<\/c>$/);
  expect(spanOf(cue)).toEqual({ backgroundColor: 'rgba(255,0,0,1)' });
  expect(cue.textStyle).toEqual({
    backgroundColor: 'rgba(0,0,0,0)',
    outline: '0.08em solid #ffff00',
  });
});

// --- Pen background ---

/** The `<c.s-KEY>` keys referenced by the cue text, in order of first appearance. */
function spanKeys(cue: VTTCue) {
  return Array.from(cue.text.matchAll(/<c\.s-([\w-]+)>/g), (m) => m[1]).filter(
    (key, i, keys) => keys.indexOf(key) === i,
  );
}

/** The single span style referenced by the cue text. */
function spanOf(cue: VTTCue) {
  const keys = spanKeys(cue);
  expect(keys).toHaveLength(1);
  expect(Object.keys(cue.spans ?? {})).toEqual(keys);
  return cue.spans![keys[0]];
}

test.each([
  [0, 'solid', 'rgba(255,0,0,1)'],
  [1, 'flash', 'rgba(255,0,0,1)'],
  [2, 'translucent', 'rgba(255,0,0,0.5)'],
  [3, 'transparent', 'rgba(255,0,0,0)'],
])('pen background opacity %i (%s) becomes an rgba span background', (opacity, _, rgba) => {
  const cue = decodeOne([...DF(), ...SPC(0x3f, (opacity << 6) | 0x30), ...text('Red'), ...DSW(1)]);
  expect(cue.text).toMatch(/^<c\.s-[\w-]+>Red<\/c>$/);
  expect(spanOf(cue)).toEqual({ backgroundColor: rgba });
  expect(cue.textStyle).toBeUndefined();
});

test('pen background equal to the window fill needs no span', () => {
  // Default pen (solid black) on the default fill; flash black is rendered the same as solid.
  const plain = decodeOne([...DF(), ...text('a'), ...SPC(0x3f, 0x40), ...text('b'), ...DSW(1)]),
    // Transparent pen on a transparent window fill.
    clear = decodeOne([
      ...DF(),
      ...SWA(0, false, { fillOpacity: 3 }),
      ...SPC(0x3f, 0xc0),
      ...text('c'),
      ...DSW(1),
    ]);
  expect(plain.text).toBe('ab');
  expect(plain.spans).toBeUndefined();
  expect(clear.text).toBe('c');
  expect(clear.spans).toBeUndefined();
});

test('pen background runs split and rejoin; unwritten cells carry no background', () => {
  const cue = decodeOne([
    ...DF({ rows: 2 }),
    ...SWA(0, false, { fillOpacity: 3 }),
    ...SPL(0, 2),
    ...SPC(0x3f, 0xc0), // transparent, like the fill
    ...text('hi'),
    ...SPC(0x3f, 0x03), // blue background
    ...text(' there'),
    ...SPC(0x3f, 0xc0), // back to transparent, like the fill
    ...text('!'),
    ...CR,
    ...SPC(0x3f, 0x03),
    ...text('again'),
    ...DSW(1),
  ]);
  const keys = spanKeys(cue);
  expect(keys).toHaveLength(1);
  const key = keys[0];
  expect(cue.text).toBe(`  hi<c.s-${key}> there</c>!\n<c.s-${key}>again</c>`);
  expect(cue.spans).toEqual({ [key]: { backgroundColor: 'rgba(0,0,255,1)' } });
});

test('a run with a pen background and a pen size has a single span wrapper', () => {
  const cue = decodeOne([
    ...DF(),
    ...SPA(true, false, { size: 0 }),
    ...SPC(0x30, 0x3c), // red on yellow
    ...text('small'),
    ...DSW(1),
  ]);
  expect(cue.text).toMatch(/^<c\.#ff0000><c\.s-[\w-]+><i>small<\/i><\/c><\/c>$/);
  expect(spanOf(cue)).toEqual({
    backgroundColor: 'rgba(255,255,0,1)',
    className: 'pen-small',
  });
});

test('changing a pen background while displayed starts a new cue', () => {
  const decoder = new CEA708Decoder();
  decoder.decodeCCData(svc([...DF(), ...SPC(0x3f, 0x30), ...text('a'), ...DSW(1)]), 1);
  decoder.decodeCCData(svc([...SPL(0, 0), ...SPC(0x3f, 0x03), ...text('a')]), 2);
  decoder.flush(3);
  expect(decoder.cues.map((cue) => spanOf(cue).backgroundColor)).toEqual([
    'rgba(255,0,0,1)',
    'rgba(0,0,255,1)',
  ]);
});

// --- Font tags ---

const FONTS: [number, string, string][] = [
  [1, 'monospaced serif', '"Courier New", Courier, monospace'],
  [2, 'proportional serif', '"Times New Roman", serif'],
  [3, 'monospaced sans-serif', '"Lucida Console", Monaco, monospace'],
  [4, 'proportional sans-serif', 'Arial, Helvetica, sans-serif'],
  [5, 'casual', '"Comic Sans MS", "Chalkboard SE", casual, sans-serif'],
  [6, 'cursive', '"Brush Script MT", cursive'],
  [7, 'small caps', 'sans-serif'],
];

test.each(FONTS)(
  'font tag %i (%s) used by the whole window goes on the text style',
  (font, _, family) => {
    const cue = decodeOne([...DF(), ...SPA(false, false, { font }), ...text('Font'), ...DSW(1)]);
    expect(cue.text).toBe('Font');
    expect(cue.spans).toBeUndefined();
    expect(cue.textStyle).toEqual(
      font === 7 ? { fontFamily: family, className: 'small-caps' } : { fontFamily: family },
    );
  },
);

test.each(FONTS)('font tag %i (%s) on part of the window becomes a span', (font, _, family) => {
  const cue = decodeOne([
    ...DF(),
    ...text('plain '),
    ...SPA(false, false, { font }),
    ...text('styled'),
    ...DSW(1),
  ]);
  expect(cue.text).toMatch(/^plain <c\.s-[\w-]+>styled<\/c>$/);
  expect(spanOf(cue)).toEqual(
    font === 7 ? { fontFamily: family, className: 'small-caps' } : { fontFamily: family },
  );
  expect(cue.textStyle).toBeUndefined();
});

test('default font tag adds nothing; font, background, and size share one span', () => {
  const plain = decodeOne([...DF(), ...SPA(false, false, { font: 0 }), ...text('x'), ...DSW(1)]);
  expect(plain.text).toBe('x');
  expect(plain.textStyle).toBeUndefined();

  const combined = decodeOne([
    ...DF(),
    ...text('a'),
    ...SPA(false, true, { size: 2, font: 7 }),
    ...SPC(0x3f, 0x0c), // green background
    ...text('B'),
    ...DSW(1),
  ]);
  expect(combined.text).toMatch(/^a<c\.s-[\w-]+><u>B<\/u><\/c>$/);
  expect(spanOf(combined)).toEqual({
    backgroundColor: 'rgba(0,255,0,1)',
    fontFamily: 'sans-serif',
    className: 'pen-large small-caps',
  });
});

test('predefined window styles 2 and 5 have a transparent fill', () => {
  const popOn = decodeOne([...DF({ style: 2 }), ...text('a'), ...DSW(1)]),
    rollUp = decodeOne([...DF({ style: 5 }), ...text('a'), ...DSW(1)]),
    opaque = decodeOne([...DF({ style: 4 }), ...text('a'), ...DSW(1)]);
  expect(popOn.textStyle).toEqual({ backgroundColor: 'rgba(0,0,0,0)' });
  expect(rollUp.textStyle).toEqual({ backgroundColor: 'rgba(0,0,0,0)' });
  expect(opaque.textStyle).toBeUndefined();
});

test('changing the window fill while displayed starts a new cue', () => {
  const decoder = new CEA708Decoder();
  decoder.decodeCCData(svc(HELLO), 1);
  decoder.decodeCCData(svc(SWA(0, false, { fillOpacity: 3 })), 2);
  decoder.flush(3);

  // The characters keep the solid black pen background they were written with, which now differs
  // from the (transparent) window fill and so is rendered as a span.
  expect(decoder.cues.map((cue) => [cue.text, cue.startTime, cue.endTime])).toEqual([
    ['Hello', 1, 2],
    ['<c.s-bg000000-100>Hello</c>', 2, 3],
  ]);
  expect(decoder.cues[0].textStyle).toBeUndefined();
  expect(decoder.cues[0].spans).toBeUndefined();
  expect(decoder.cues[1].textStyle).toEqual({ backgroundColor: 'rgba(0,0,0,0)' });
  expect(decoder.cues[1].spans).toEqual({ 'bg000000-100': { backgroundColor: 'rgba(0,0,0,1)' } });
});

test('top-to-bottom print direction is vertical lr with swapped line/position axes', () => {
  const cue = decodeOne([
    ...DF({ relative: true, av: 10, ah: 80, anchor: 2, cols: 16 }), // top-right anchor
    ...SWA(0, false, { printDirection: 2 }),
    ...text('down'),
    ...DSW(1),
  ]);
  expect(cue.text).toBe('down');
  expect(cue.vertical).toBe('lr');
  // `line` now runs along the horizontal axis, `position` along the vertical axis.
  expect(cue.line).toBe(80);
  expect(cue.lineAlign).toBe('end');
  expect(cue.position).toBe(10);
  expect(cue.positionAlign).toBe('line-left');
  expect(cue.size).toBe(50);
});

test('bottom-to-top print direction is vertical rl', () => {
  const cue = decodeOne([
    ...DF({ relative: true, av: 50, ah: 50, anchor: 4 }),
    ...SWA(2, false, { printDirection: 3 }),
    ...text('up'),
    ...DSW(1),
  ]);
  expect(cue.vertical).toBe('rl');
  expect(cue.line).toBe(50);
  expect(cue.lineAlign).toBe('center');
  expect(cue.position).toBe(50);
  expect(cue.positionAlign).toBe('center');
  expect(cue.align).toBe('center');
});

test('right-to-left print direction keeps logical order and mirrors left/right justification', () => {
  const left = decodeOne([
      ...DF(),
      ...SWA(0, false, { printDirection: 1 }),
      ...text('abc'),
      ...DSW(1),
    ]),
    right = decodeOne([
      ...DF(),
      ...SWA(1, false, { printDirection: 1 }),
      ...text('abc'),
      ...DSW(1),
    ]);
  expect(left.text).toBe('abc');
  expect(left.vertical).toBe('');
  expect(left.align).toBe('right');
  expect(right.align).toBe('left');
});

test('horizontal print directions leave cue.vertical empty', () => {
  const cue = decodeOne([...DF(), ...SWA(0), ...text('flat'), ...DSW(1)]);
  expect(cue.vertical).toBe('');
});

test('top-to-bottom scroll direction adds rows at the top and drops the bottom row', () => {
  const decoder = new CEA708Decoder();
  decoder.decodeCCData(
    svc([
      ...DF({ rows: 2 }),
      ...SWA(0, false, { scrollDirection: 2 }),
      ...text('one'),
      ...CR,
      ...text('two'),
      ...DSW(1),
    ]),
    1,
  );
  decoder.decodeCCData(svc([...CR, ...text('three')]), 2);
  decoder.flush(3);

  expect(decoder.cues.map((cue) => cue.text)).toEqual(['two\none', 'three\ntwo']);
});

test('top-to-bottom scroll moves the pen up before scrolling', () => {
  const cue = decodeOne([
    ...DF({ rows: 3 }),
    ...SWA(0, false, { scrollDirection: 2 }),
    ...SPL(2, 0),
    ...text('bottom'),
    ...CR,
    ...text('middle'),
    ...CR,
    ...text('top'),
    ...DSW(1),
  ]);
  expect(cue.text).toBe('top\nmiddle\nbottom');
});

test('right-to-left scroll: text past the right edge shifts the row left (ticker)', () => {
  // Overflow scrolls even without word wrap.
  const cue = decodeOne([
    ...DF({ rows: 1, cols: 4 }),
    ...SWA(0, false, { scrollDirection: 1 }),
    ...text('abcdef'),
    ...DSW(1),
  ]);
  expect(cue.text).toBe('cdef');
});

test('left-to-right scroll: text past the right edge shifts the row right and enters at the left', () => {
  const cue = decodeOne([
    ...DF({ rows: 1, cols: 4 }),
    ...SWA(0, false, { scrollDirection: 0 }),
    ...text('abcde'),
    ...DSW(1),
  ]);
  expect(cue.text).toBe('eabc');
});

test('CR in a horizontal scroll direction shifts one column and moves the pen to the entry column', () => {
  const rtl = decodeOne([
      ...DF({ rows: 1, cols: 4 }),
      ...SWA(0, false, { scrollDirection: 1 }),
      ...text('ab'),
      ...CR,
      ...text('c'),
      ...DSW(1),
    ]),
    ltr = decodeOne([
      ...DF({ rows: 1, cols: 4 }),
      ...SWA(0, false, { scrollDirection: 0 }),
      ...text('ab'),
      ...CR,
      ...text('c'),
      ...DSW(1),
    ]);
  expect(rtl.text).toBe('b  c');
  expect(ltr.text).toBe('cab');
});

test('horizontal scroll shifts every row and keeps the cell styling', () => {
  const cue = decodeOne([
    ...DF({ rows: 2, cols: 3 }),
    ...SWA(0, false, { scrollDirection: 1 }),
    ...SPL(1, 0),
    ...text('xyz'),
    ...SPL(0, 0),
    ...SPA(true, false),
    ...text('abcd'),
    ...DSW(1),
  ]);
  expect(cue.text).toBe('<i>bcd</i>\nyz');
});

test('fade display effect is a media-synchronised opacity animation over effect_speed * 0.5 s', () => {
  const cue = decodeOne([
    ...DF(),
    ...SWA(0, false, { effect: 1, effectSpeed: 3 }),
    ...text('fade'),
    ...DSW(1),
  ]);
  expect(cue.textStyle).toBeUndefined();
  expect(cue.animations).toEqual([
    { target: 'display', duration: 1.5, keyframes: [{ opacity: 0 }, { opacity: 1 }] },
  ]);
});

test('wipe display effect animates clip-path with a minimum duration of 0.1 s', () => {
  const wipe = decodeOne([
      ...DF(),
      ...SWA(0, false, { effect: 2, effectDirection: 1, effectSpeed: 2 }),
      ...text('wipe'),
      ...DSW(1),
    ]),
    instant = decodeOne([
      ...DF(),
      ...SWA(0, false, { effect: 2, effectSpeed: 0 }),
      ...text('wipe'),
      ...DSW(1),
    ]);
  expect(wipe.textStyle).toBeUndefined();
  expect(wipe.animations).toEqual([
    {
      target: 'display',
      duration: 1,
      keyframes: [{ clipPath: 'inset(0 0 0 100%)' }, { clipPath: 'inset(0)' }],
    },
  ]);
  expect(instant.animations).toEqual([
    {
      target: 'display',
      duration: 0.1,
      keyframes: [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0)' }],
    },
  ]);
});

test.each([
  [0, 'left-to-right', 'inset(0 100% 0 0)'],
  [1, 'right-to-left', 'inset(0 0 0 100%)'],
  [2, 'top-to-bottom', 'inset(0 0 100% 0)'],
  [3, 'bottom-to-top', 'inset(100% 0 0 0)'],
])('wipe direction %i (%s) hides the side revealed last', (effectDirection, _, hidden) => {
  const cue = decodeOne([
    ...DF(),
    ...SWA(0, false, { effect: 2, effectDirection, effectSpeed: 1 }),
    ...text('wipe'),
    ...DSW(1),
  ]);
  expect(cue.animations).toEqual([
    {
      target: 'display',
      duration: 0.5,
      keyframes: [{ clipPath: hidden }, { clipPath: 'inset(0)' }],
    },
  ]);
});

test('display effects combine with fill styling and apply only to the cue shown on display', () => {
  const decoder = new CEA708Decoder();
  decoder.decodeCCData(
    svc([
      ...DF({ rows: 2 }),
      ...SWA(0, false, { fillOpacity: 3, effect: 1, effectSpeed: 1 }),
      ...text('one'),
      ...DSW(1),
    ]),
    1,
  );
  // Content change while displayed: a new cue, but no re-animation.
  decoder.decodeCCData(svc([...CR, ...text('two')]), 2);
  // Hide and redisplay: the effect plays again.
  decoder.decodeCCData(svc(HDW(1)), 3);
  decoder.decodeCCData(svc(DSW(1)), 4);
  decoder.flush(5);

  const fade = { target: 'display', duration: 0.5, keyframes: [{ opacity: 0 }, { opacity: 1 }] };
  expect(decoder.cues.map((cue) => cue.textStyle)).toEqual([
    { backgroundColor: 'rgba(0,0,0,0)' },
    { backgroundColor: 'rgba(0,0,0,0)' },
    { backgroundColor: 'rgba(0,0,0,0)' },
  ]);
  expect(decoder.cues.map((cue) => cue.animations)).toEqual([[fade], undefined, [fade]]);
});

test('snap display effect and hidden-then-filled windows: the effect waits for the first text', () => {
  const snap = decodeOne([...DF(), ...SWA(0, false, { effect: 0 }), ...text('snap'), ...DSW(1)]);
  expect(snap.textStyle).toBeUndefined();
  expect(snap.animations).toBeUndefined();

  // Window displayed while empty (paint-on): the animation applies once text arrives.
  const decoder = new CEA708Decoder();
  decoder.decodeCCData(
    svc([...DF({ visible: true }), ...SWA(0, false, { effect: 1, effectSpeed: 2 })]),
    1,
  );
  decoder.decodeCCData(svc(text('painted')), 2);
  decoder.flush(3);
  expect(decoder.cues).toHaveLength(1);
  expect(decoder.cues[0].textStyle).toBeUndefined();
  expect(decoder.cues[0].animations).toEqual([
    { target: 'display', duration: 1, keyframes: [{ opacity: 0 }, { opacity: 1 }] },
  ]);
});

// --- Ticker (predefined window style 7) ---

const MARQUEE = (duration: number) => ({
  target: 'display',
  duration,
  keyframes: [{ left: '100%' }, { left: '-100%' }],
});

test('ticker windows get a full-width bottom layout and a marquee over the cue duration', () => {
  const decoder = new CEA708Decoder();
  decoder.decodeCCData(
    svc([
      ...DF({ style: 7, relative: true, av: 50, ah: 50, anchor: 4 }),
      ...text('news'),
      ...DSW(1),
    ]),
    1,
  );
  decoder.flush(4);

  const cue = decoder.cues[0];
  expect(cue.text).toBe('news');
  expect(cue.layout).toEqual({ left: 0, bottom: 0, width: 100 });
  expect(cue.animations).toEqual([MARQUEE(3)]);
  expect(cue.textStyle).toBeUndefined();
});

test('ticker text streams in from the right and the marquee joins a display effect', () => {
  const decoder = new CEA708Decoder();
  decoder.decodeCCData(
    svc([
      ...DF({ style: 7, rows: 1, cols: 4 }),
      // Keep the ticker scroll direction, add a fade.
      ...SWA(0, false, { scrollDirection: 1, effect: 1, effectSpeed: 1 }),
      ...text('abcdef'),
      ...DSW(1),
    ]),
    1,
  );
  decoder.flush(2.5);

  const cue = decoder.cues[0];
  expect(cue.text).toBe('cdef');
  expect(cue.layout).toEqual({ left: 0, bottom: 0, width: 100 });
  expect(cue.animations).toEqual([
    { target: 'display', duration: 0.5, keyframes: [{ opacity: 0 }, { opacity: 1 }] },
    MARQUEE(1.5),
  ]);
});

test('a ticker whose scroll direction is overridden keeps the layout but not the marquee', () => {
  const decoder = new CEA708Decoder();
  decoder.decodeCCData(
    svc([
      ...DF({ style: 7 }),
      ...SWA(0, false, { scrollDirection: 3 }),
      ...text('static'),
      ...DSW(1),
    ]),
    1,
  );
  decoder.flush(2);
  expect(decoder.cues[0].layout).toEqual({ left: 0, bottom: 0, width: 100 });
  expect(decoder.cues[0].animations).toBeUndefined();

  const plain = decodeOne([...DF({ style: 1 }), ...text('a'), ...DSW(1)]);
  expect(plain.layout).toBeUndefined();
});

test('live mode: the ticker marquee is attached when the cue closes', () => {
  const onCueUpdate = vi.fn(),
    decoder = new CEA708Decoder({ live: true, onCueUpdate });
  decoder.decodeCCData(svc([...DF({ style: 7 }), ...text('live'), ...DSW(1)]), 1);
  const cue = decoder.cues[0];
  expect(cue.animations).toBeUndefined();

  decoder.decodeCCData(svc(HDW(1)), 3);
  expect(onCueUpdate).toHaveBeenCalledWith(cue);
  expect(cue.animations).toEqual([MARQUEE(2)]);
});

test('word wrap carries the unfinished word onto the next row', () => {
  const cue = decodeOne([
    ...DF({ rows: 2, cols: 8 }),
    ...SWA(0, true),
    ...text('hello world'),
    ...DSW(1),
  ]);
  expect(cue.text).toBe('hello\nworld');
});

test('word wrap keeps the moved word styling and consumes a space at the boundary', () => {
  const styled = decodeOne([
      ...DF({ rows: 2, cols: 8 }),
      ...SWA(0, true),
      ...text('hello '),
      ...SPA(true, false),
      ...text('world'),
      ...DSW(1),
    ]),
    boundary = decodeOne([
      ...DF({ rows: 2, cols: 4 }),
      ...SWA(0, true),
      ...text('abcd efgh'),
      ...DSW(1),
    ]);
  expect(styled.text).toBe('hello\n<i>world</i>');
  expect(boundary.text).toBe('abcd\nefgh');
});

test('word wrap falls back to breaking a word longer than the row', () => {
  const cue = decodeOne([
    ...DF({ rows: 3, cols: 4 }),
    ...SWA(0, true),
    ...text('ab cdefgh'),
    ...DSW(1),
  ]);
  // "c" moves down with the word, which then overflows the row and breaks mid-word.
  expect(cue.text).toBe('ab\ncdef\ngh');
});

test('word wrap on the last row scrolls the carried word into view', () => {
  const cue = decodeOne([
    ...DF({ rows: 1, cols: 8 }),
    ...SWA(0, true),
    ...text('hello world'),
    ...DSW(1),
  ]);
  expect(cue.text).toBe('world');
});

// --- Live mode ---

type LiveEvent = ['add' | 'update', VTTCue];

function liveDecoder(events: LiveEvent[]) {
  return new CEA708Decoder({
    live: true,
    onCue: (cue) => events.push(['add', cue]),
    onCueUpdate: (cue) => events.push(['update', cue]),
  });
}

const tuple = (cue: VTTCue) => [cue.text, cue.startTime, cue.endTime];

test('live mode: a displayed window is emitted at once and updated in place when hidden', () => {
  const onCue = vi.fn(),
    onCueUpdate = vi.fn(),
    decoder = new CEA708Decoder({ live: true, onCue, onCueUpdate });

  decoder.decodeCCData(svc(HELLO), 1);
  expect(onCue).toHaveBeenCalledTimes(1);
  expect(onCueUpdate).not.toHaveBeenCalled();

  const cue: VTTCue = onCue.mock.calls[0][0];
  expect(cue.text).toBe('Hello');
  expect(cue.startTime).toBe(1);
  expect(cue.endTime).toBe(Infinity);
  expect(cue.line).toBeCloseTo(20);
  expect(decoder.cues).toHaveLength(1);
  expect(decoder.cues[0]).toBe(cue);

  decoder.decodeCCData(svc(HDW(1)), 3);
  expect(onCueUpdate).toHaveBeenCalledTimes(1);
  expect(onCueUpdate.mock.calls[0][0]).toBe(cue);
  expect(cue.endTime).toBe(3);
  expect(onCue).toHaveBeenCalledTimes(1);
  expect(decoder.cues).toHaveLength(1);
  expect(decoder.cues[0]).toBe(cue);

  // Nothing left open.
  decoder.flush(10);
  expect(onCueUpdate).toHaveBeenCalledTimes(1);
  expect(cue.endTime).toBe(3);
});

test('live mode: scrolling and redisplay yield add/update pairs with stable identities', () => {
  const events: LiveEvent[] = [],
    decoder = liveDecoder(events),
    batch = new CEA708Decoder();

  for (const d of [decoder, batch]) {
    d.decodeCCData(svc([...DF({ rows: 2 }), ...text('one'), ...CR, ...text('two'), ...DSW(1)]), 1);
    // CR on the last row scrolls: new content, new cue.
    d.decodeCCData(svc([...CR, ...text('three')]), 2);
    // Hide and re-show within one group: identical content is coalesced, no new cue.
    d.decodeCCData(svc([...HDW(1), ...DSW(1), ...ETX]), 3);
    // Hide, then redisplay the same text later: a fresh cue with its own start.
    d.decodeCCData(svc(HDW(1)), 4);
    d.decodeCCData(svc(DSW(1)), 5);
    d.flush(6);
  }

  expect(events.map(([type, cue]) => [type, cue.text])).toEqual([
    ['add', 'one\ntwo'],
    ['update', 'one\ntwo'],
    ['add', 'two\nthree'],
    ['update', 'two\nthree'],
    ['add', 'two\nthree'],
    ['update', 'two\nthree'],
  ]);

  // Each update targets the object added just before it; redisplay is a distinct object.
  expect(events[1][1]).toBe(events[0][1]);
  expect(events[3][1]).toBe(events[2][1]);
  expect(events[5][1]).toBe(events[4][1]);
  expect(events[4][1]).not.toBe(events[2][1]);

  const adds = events.filter(([type]) => type === 'add').map(([, cue]) => cue);
  expect(new Set(adds).size).toBe(3);
  expect(decoder.cues).toHaveLength(3);
  adds.forEach((cue, i) => expect(decoder.cues[i]).toBe(cue));

  expect(decoder.cues.map(tuple)).toEqual([
    ['one\ntwo', 1, 2],
    ['two\nthree', 2, 4],
    ['two\nthree', 5, 6],
  ]);
  expect(decoder.cues.map(tuple)).toEqual(batch.cues.map(tuple));
});

test('live mode: each visible window has its own open cue', () => {
  const events: LiveEvent[] = [],
    decoder = liveDecoder(events);

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
  expect(events.map(([type, cue]) => [type, cue.text, cue.endTime])).toEqual([
    ['add', 'top', Infinity],
    ['add', 'bottom', Infinity],
  ]);

  decoder.decodeCCData(svc(TGW(0b01)), 2);
  expect(events).toHaveLength(3);
  expect(events[2][0]).toBe('update');
  expect(events[2][1]).toBe(events[0][1]);
  expect(events[0][1].endTime).toBe(2);
  expect(events[1][1].endTime).toBe(Infinity);

  decoder.flush(3);
  expect(events).toHaveLength(4);
  expect(events[3][1]).toBe(events[1][1]);
  expect(events[1][1].endTime).toBe(3);
  expect(decoder.cues).toHaveLength(2);
});

test('live mode: flush() closes the open cue in place', () => {
  const onCueUpdate = vi.fn(),
    decoder = new CEA708Decoder({ live: true, onCueUpdate });

  decoder.decodeCCData(svc(HELLO), 1);
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

  // Without a time: last decode time, or the minimum duration past the start.
  const implicit = new CEA708Decoder({ live: true });
  implicit.decodeCCData(svc(HELLO), 1);
  implicit.decodeCCData(svc(DLY(5)), 4);
  implicit.flush();
  expect(implicit.cues[0].endTime).toBe(4);

  const minimum = new CEA708Decoder({ live: true });
  minimum.decodeCCData(svc(HELLO), 1);
  minimum.flush();
  expect(minimum.cues[0].endTime).toBeGreaterThan(1);
  expect(minimum.cues[0].endTime).toBeLessThan(Infinity);
});

test('live mode: reset() closes open cues at the last decoded time before clearing', () => {
  const onCueUpdate = vi.fn(),
    decoder = new CEA708Decoder({ live: true, onCueUpdate });

  decoder.decodeCCData(svc(HELLO), 1);
  decoder.decodeCCData(svc(DLY(5)), 4);
  const cue = decoder.cues[0];

  decoder.reset();
  expect(onCueUpdate).toHaveBeenCalledTimes(1);
  expect(onCueUpdate).toHaveBeenCalledWith(cue);
  expect(cue.endTime).toBe(4);
  expect(decoder.cues).toHaveLength(0);

  // Fully usable afterwards.
  decoder.decodeCCData(svc(HELLO), 5);
  expect(decoder.cues).toHaveLength(1);
  expect(decoder.cues[0]).not.toBe(cue);
  expect(decoder.cues[0].endTime).toBe(Infinity);
});

test('live mode: a cue that ends the instant it starts is withdrawn', () => {
  const onCue = vi.fn(),
    onCueUpdate = vi.fn(),
    decoder = new CEA708Decoder({ live: true, onCue, onCueUpdate }),
    batch = new CEA708Decoder();

  // Displayed and hidden by two groups sharing one presentation time.
  for (const d of [decoder, batch]) {
    d.decodeCCData(svc(HELLO), 1);
    d.decodeCCData(svc(HDW(1)), 1);
    d.flush(2);
  }

  expect(onCue).toHaveBeenCalledTimes(1);
  expect(onCueUpdate).toHaveBeenCalledTimes(1);
  const cue: VTTCue = onCue.mock.calls[0][0];
  expect(onCueUpdate.mock.calls[0][0]).toBe(cue);
  expect(cue.endTime).toBe(cue.startTime);
  expect(decoder.cues).toHaveLength(0);
  expect(batch.cues).toHaveLength(0);
});

test('live mode is off by default and leaves non-live output untouched', () => {
  const onCue = vi.fn(),
    onCueUpdate = vi.fn(),
    decoder = new CEA708Decoder({ onCue, onCueUpdate });

  decoder.decodeCCData(svc(HELLO), 1);
  expect(onCue).not.toHaveBeenCalled();
  decoder.decodeCCData(svc(HDW(1)), 3);
  expect(onCue).toHaveBeenCalledTimes(1);
  expect(onCueUpdate).not.toHaveBeenCalled();
  expect(decoder.cues.map(tuple)).toEqual([['Hello', 1, 3]]);
});
