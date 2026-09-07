/**
 * Encoders for synthesising CEA-608 byte pairs and CEA-708 DTVCC packets. Adapted from the
 * helpers in `tests/cea`, so the playground streams are built from the same primitives the
 * decoders are tested with.
 */

import type { CCDataTriplet } from '../../src/cea';
import type { CCPacket } from './types';

export const FPS = 29.97;

// --- CEA-608 -------------------------------------------------------------------------------

export type Pair = [number, number];

/** A caption script: each entry is a start time plus the pairs sent from that frame on. */
export type Script608 = [time: number, pairs: Pair[]][];

/** Adds odd parity (bit 7) to a 7-bit CEA-608 byte. */
export function parity(byte: number) {
  let bits = 0;
  for (let b = byte; b; b >>= 1) bits += b & 1;
  return bits % 2 === 0 ? byte | 0x80 : byte;
}

/** A control code transmitted twice. Bit 3 of the first byte selects channel 2 within a field. */
export function ctrl(a: number, b: number, channel2 = false): Pair[] {
  const pair: Pair = [parity(channel2 ? a | 0x08 : a), parity(b)];
  return [pair, pair];
}

/** Encodes a string of basic characters as byte pairs (odd length padded with a null). */
export function text608(str: string): Pair[] {
  const pairs: Pair[] = [];
  for (let i = 0; i < str.length; i += 2) {
    pairs.push([
      parity(str.charCodeAt(i)),
      i + 1 < str.length ? parity(str.charCodeAt(i + 1)) : 0x80,
    ]);
  }
  return pairs;
}

/** Miscellaneous control codes (channel 1). */
export const C608 = {
  RCL: ctrl(0x14, 0x20), // resume caption loading (pop-on)
  BS: ctrl(0x14, 0x21),
  RU2: ctrl(0x14, 0x25),
  RU3: ctrl(0x14, 0x26),
  RU4: ctrl(0x14, 0x27),
  RDC: ctrl(0x14, 0x29), // resume direct captioning (paint-on)
  EDM: ctrl(0x14, 0x2c), // erase displayed memory
  CR: ctrl(0x14, 0x2d), // carriage return (roll-up)
  ENM: ctrl(0x14, 0x2e), // erase non-displayed memory
  EOC: ctrl(0x14, 0x2f), // end of caption (flip pop-on memory)
};

export const COLOR608 = {
  white: 0,
  green: 1,
  blue: 2,
  cyan: 3,
  red: 4,
  yellow: 5,
  magenta: 6,
  italics: 7,
} as const;

/** Mid-row code: colour (or italics) plus optional underline. */
export function midRow(color: keyof typeof COLOR608, underline = false) {
  return ctrl(0x11, 0x20 | (COLOR608[color] << 1) | (underline ? 1 : 0));
}

const PAC_ROW_BYTES: [number, number][] = [
  [0, 0], // unused (rows are 1-based)
  [0x11, 0x40],
  [0x11, 0x60],
  [0x12, 0x40],
  [0x12, 0x60],
  [0x15, 0x40],
  [0x15, 0x60],
  [0x16, 0x40],
  [0x16, 0x60],
  [0x17, 0x40],
  [0x17, 0x60],
  [0x10, 0x40],
  [0x13, 0x40],
  [0x13, 0x60],
  [0x14, 0x40],
  [0x14, 0x60],
];

/**
 * Preamble address code: places the cursor at `row` (1-15). Either an indent (multiple of 4
 * columns) or a colour can be carried; indents take precedence when given.
 */
export function pac(
  row: number,
  {
    indent,
    color = 'white',
    underline = false,
  }: {
    indent?: number;
    color?: keyof typeof COLOR608;
    underline?: boolean;
  } = {},
) {
  const [a, base] = PAC_ROW_BYTES[row],
    attr = indent === undefined ? COLOR608[color] << 1 : 0x10 | ((indent / 4) << 1);
  return ctrl(a, base | attr | (underline ? 1 : 0));
}

function timecode(seconds: number) {
  const total = Math.round(seconds * 30),
    f = total % 30,
    s = Math.floor(total / 30) % 60,
    m = Math.floor(total / 1800) % 60,
    h = Math.floor(total / 108000);
  return [h, m, s, f].map((v) => String(v).padStart(2, '0')).join(':');
}

/** Serialises a script as a Scenarist SCC file. */
export function toSCC(script: Script608) {
  const lines = script.map(
    ([time, pairs]) =>
      `${timecode(time)}\t${pairs
        .map((pair) => pair.map((b) => b.toString(16).padStart(2, '0')).join(''))
        .join(' ')}`,
  );
  return `Scenarist_SCC V1.0\n\n${lines.join('\n\n')}\n`;
}

/** Converts a script to field-1 `cc_data` packets, one pair per frame. */
export function scriptToPackets(script: Script608): CCPacket[] {
  const packets: CCPacket[] = [];
  for (const [time, pairs] of script) {
    pairs.forEach((pair, i) => {
      packets.push({
        time: time + i / FPS,
        triplets: [{ type: 0, data1: pair[0], data2: pair[1] }],
      });
    });
  }
  return packets;
}

// --- CEA-708 -------------------------------------------------------------------------------

let sequence = 0;

/** Resets the DTVCC packet sequence counter (call before building a schedule). */
export function resetSequence() {
  sequence = 0;
}

/**
 * Builds the `cc_data` triplets of one DTVCC packet from its payload (service blocks). The
 * header carries the sequence number (top 2 bits) and the size in 16-bit words including the
 * header byte; the payload is zero padded up to a whole word.
 */
export function packet(payload: number[]): CCDataTriplet[] {
  const words = Math.ceil((payload.length + 1) / 2),
    data = payload.slice();
  while (data.length < words * 2 - 1) data.push(0);

  const seq = sequence;
  sequence = (sequence + 1) & 3;

  const triplets: CCDataTriplet[] = [
    { type: 3, data1: (seq << 6) | (words === 64 ? 0 : words), data2: data[0] },
  ];
  for (let i = 1; i < data.length; i += 2) {
    triplets.push({ type: 2, data1: data[i], data2: data[i + 1] });
  }
  return triplets;
}

/** Service block(s) for `service`; blocks are limited to 31 bytes so long data spans several. */
export function block(service: number, data: number[]) {
  const out: number[] = [];
  for (let i = 0; i < data.length; i += 31) {
    const chunk = data.slice(i, i + 31);
    if (service <= 6) out.push((service << 5) | chunk.length);
    else out.push(0xe0 | chunk.length, service & 0x3f);
    out.push(...chunk);
  }
  return out;
}

/** One or more packets holding the service block(s) for `service` (max 127 payload bytes each). */
export function svc(data: number[], service = 1): CCDataTriplet[] {
  const triplets: CCDataTriplet[] = [];
  // Keep every packet under the 128 byte DTVCC limit (4 blocks of 31 + headers).
  for (let i = 0; i < data.length; i += 93) {
    triplets.push(...packet(block(service, data.slice(i, i + 93))));
  }
  return triplets;
}

export interface WindowInit {
  id?: number;
  visible?: boolean;
  relative?: boolean;
  /** Anchor vertical (0-74 absolute, 0-99 relative). */
  av?: number;
  /** Anchor horizontal (0-209 absolute, 0-99 relative). */
  ah?: number;
  /** Anchor point 0-8 (top-left .. bottom-right, row-major). */
  anchor?: number;
  rows?: number;
  cols?: number;
  /** Predefined window style 1-7 (7 is the ticker). */
  style?: number;
  /** Predefined pen style 1-7. */
  pen?: number;
}

/** DFx (define window) command, 6 parameter bytes. */
export function DF({
  id = 0,
  visible = false,
  relative = false,
  av = 0,
  ah = 0,
  anchor = 0,
  rows = 1,
  cols = 32,
  style = 1,
  pen = 1,
}: WindowInit = {}) {
  return [
    0x98 + id,
    (visible ? 0x20 : 0) | 0x18, // row lock + column lock, priority 0
    (relative ? 0x80 : 0) | av,
    ah,
    (anchor << 4) | (rows - 1),
    cols - 1,
    (style << 3) | pen,
  ];
}

export const text708 = (str: string) => Array.from(str, (c) => c.charCodeAt(0) & 0x7f),
  CW = (id: number) => [0x80 + id],
  CLW = (bitmap: number) => [0x88, bitmap],
  DSW = (bitmap: number) => [0x89, bitmap],
  HDW = (bitmap: number) => [0x8a, bitmap],
  TGW = (bitmap: number) => [0x8b, bitmap],
  DLW = (bitmap: number) => [0x8c, bitmap],
  DLY = (ticks: number) => [0x8d, ticks],
  RST = [0x8f],
  ETX = [0x03],
  CR708 = [0x0d],
  FF = [0x0c];

export const PenSize = { small: 0, standard: 1, large: 2 } as const;
export const Edge = {
  none: 0,
  raised: 1,
  depressed: 2,
  uniform: 3,
  leftDropShadow: 4,
  rightDropShadow: 5,
} as const;

/**
 * SPA: byte 1 is text tag (4 bits), offset (2 bits: 1 normal), pen size (2 bits); byte 2 is
 * italics, underline, edge type (3 bits), font style (3 bits).
 */
export function SPA(
  italics: boolean,
  underline: boolean,
  { size = 1, edge = 0, font = 0 }: { size?: number; edge?: number; font?: number } = {},
) {
  return [0x90, 0x04 | size, (italics ? 0x80 : 0) | (underline ? 0x40 : 0) | (edge << 3) | font];
}

/** 2-bit-per-channel RGB colours (6 bits). */
export const RGB = {
  black: 0x00,
  white: 0x3f,
  red: 0x30,
  green: 0x0c,
  blue: 0x03,
  yellow: 0x3c,
  cyan: 0x0f,
  magenta: 0x33,
  orange: 0x34,
  gold: 0x38,
  skyBlue: 0x1f,
} as const;

export const Opacity = { solid: 0, flash: 1, translucent: 2, transparent: 3 } as const;

/** SPC: foreground and background as opacity (2 bits) + RGB (6 bits), then the edge RGB. */
export function SPC(
  fg: number,
  bg: number = RGB.black,
  {
    fgOpacity = 0,
    bgOpacity = 0,
    edge = 0,
  }: { fgOpacity?: number; bgOpacity?: number; edge?: number } = {},
) {
  return [0x91, (fgOpacity << 6) | fg, (bgOpacity << 6) | bg, edge];
}

export const SPL = (row: number, col: number) => [0x92, row, col];

export const Justify = { left: 0, right: 1, center: 2, full: 3 } as const;
export const Effect = { snap: 0, fade: 1, wipe: 2 } as const;
/** Direction values: 0 left-to-right, 1 right-to-left, 2 top-to-bottom, 3 bottom-to-top. */
export const Direction = { ltr: 0, rtl: 1, ttb: 2, btt: 3 } as const;

/** SWA with justification, word wrap, and optional fill / border / direction / effect fields. */
export function SWA(
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
) {
  return [
    0x97,
    (fillOpacity << 6) | fillColor,
    ((borderType & 0x03) << 6) | borderColor,
    ((borderType & 0x04) << 5) |
      (wordWrap ? 0x40 : 0) |
      (printDirection << 4) |
      (scrollDirection << 2) |
      justify,
    (effect << 6) | (effectDirection << 4) | effectSpeed,
  ];
}

/** Merges packet lists into one schedule sorted by time (stable). */
export function mergeSchedules(...lists: CCPacket[][]): CCPacket[] {
  return lists
    .flat()
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.time - b.item.time || a.index - b.index)
    .map(({ item }) => item);
}
