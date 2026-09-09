import { bench, describe } from 'vitest';

import type { CCDataTriplet } from '../../src/cea/cc-data';
import { CEA608Decoder } from '../../src/cea/cea608-decoder';
import { CEA708Decoder } from '../../src/cea/cea708-decoder';
import { createRandom, parity, sentence } from './inputs';

const FPS = 29.97;

const OPTIONS = { time: 1000, iterations: 5, warmupIterations: 2, warmupTime: 200 };

// --- CEA-708 packet helpers (copied from tests/cea/cea708.test.ts) -----------------------------

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

/** Service block(s) for `service`, split into 31-byte blocks. */
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

function svc(data: number[], service = 1, sequence = 0) {
  return packet(block(service, data), sequence);
}

/** DFx (define window): hidden, absolute anchor, `rows` x 32 columns, predefined style 1. */
function DF(id: number, rows: number, av: number, ah: number) {
  return [0x98 + id, 0x18, av, ah, rows - 1, 31, (1 << 3) | 1];
}

const text = (str: string) => Array.from(str, (c) => c.charCodeAt(0)),
  DSW = (bitmap: number) => [0x89, bitmap],
  DLW = (bitmap: number) => [0x8c, bitmap],
  SPL = (row: number, col: number) => [0x92, row, col],
  SPA = (italics: boolean, underline: boolean) => [
    0x90,
    0x05,
    (italics ? 0x80 : 0) | (underline ? 0x40 : 0),
  ],
  SPC = (fg: number) => [0x91, fg, 0, 0],
  CR = [0x0d];

/**
 * 10,000 pop-on captions, one DTVCC packet each: delete the previous window, define a hidden
 * two-row window (alternating ids 0/1), write two rows of styled text, then display it. Each
 * packet is timed one second apart.
 */
function buildPopOnPackets(count: number) {
  const random = createRandom(11),
    packets: { time: number; triplets: CCDataTriplet[] }[] = [];
  for (let i = 0; i < count; i++) {
    const id = i & 1,
      line1 = sentence(random, 4).slice(0, 30),
      line2 = sentence(random, 4).slice(0, 30);
    packets.push({
      time: i,
      triplets: svc(
        [
          ...DLW(1 << (id ^ 1)),
          ...DF(id, 2, 60 + (i % 10), 20),
          ...SPL(0, 0),
          ...SPA(i % 3 === 0, false),
          ...SPC(0x3f),
          ...text(line1),
          ...CR,
          ...SPA(false, i % 5 === 0),
          ...SPC(0x3c),
          ...text(line2),
          ...DSW(1 << id),
        ],
        1,
        i & 3,
      ),
    });
  }
  return packets;
}

const PACKETS = buildPopOnPackets(10_000),
  TRIPLETS = PACKETS.reduce((n, p) => n + p.triplets.length, 0);

/** The same stream delivered one triplet per call, as an MPEG-TS/MP4 demuxer would. */
const PER_TRIPLET = PACKETS.flatMap(({ time, triplets }) =>
  triplets.map((t) => ({ time, triplets: [t] })),
);

// Guard against measuring a no-op: the generated stream must actually produce captions.
{
  const probe = new CEA708Decoder();
  for (let i = 0; i < 50; i++) probe.decodeCCData(PACKETS[i].triplets, PACKETS[i].time);
  probe.flush(50);
  if (probe.cues.length < 45) {
    throw new Error(`CEA-708 bench input only produced ${probe.cues.length} cues for 50 packets`);
  }
}

describe('CEA-708', () => {
  bench(
    `decodeCCData: 10k pop-on packets (${TRIPLETS} triplets), one packet per call`,
    () => {
      const decoder = new CEA708Decoder();
      for (let i = 0; i < PACKETS.length; i++) {
        decoder.decodeCCData(PACKETS[i].triplets, PACKETS[i].time);
      }
      decoder.flush(PACKETS.length);
    },
    OPTIONS,
  );

  bench(
    'decodeCCData: same stream, one triplet per call',
    () => {
      const decoder = new CEA708Decoder();
      for (let i = 0; i < PER_TRIPLET.length; i++) {
        decoder.decodeCCData(PER_TRIPLET[i].triplets, PER_TRIPLET[i].time);
      }
      decoder.flush(PACKETS.length);
    },
    OPTIONS,
  );
});

// --- CEA-608 -----------------------------------------------------------------------------------

const FRAMES = 100_000,
  PAIRS_PER_FRAME = 30;

/**
 * A continuous pop-on stream: RCL, ENM, PAC row 15, 32 characters, EOC (24 pairs) then null
 * padding to 30 pairs per frame, so every frame completes one caption and replaces the previous.
 * Stored as a flat byte array with parity applied: [b1, b2, b1, b2, ...].
 */
function build608Stream(frames: number, pairsPerFrame: number) {
  const random = createRandom(12),
    bytes = new Uint8Array(frames * pairsPerFrame * 2);
  let offset = 0;
  const pair = (a: number, b: number) => {
    bytes[offset++] = parity(a);
    bytes[offset++] = parity(b);
  };
  const ctrl = (a: number, b: number) => {
    pair(a, b);
    pair(a, b);
  };
  for (let f = 0; f < frames; f++) {
    const start = offset,
      line = sentence(random, 6).padEnd(32).slice(0, 32);
    ctrl(0x14, 0x20); // RCL
    ctrl(0x14, 0x2e); // ENM
    ctrl(0x14, f % 2 ? 0x70 : 0x50); // PAC row 15 / row 14, column 0
    for (let i = 0; i < line.length; i += 2) pair(line.charCodeAt(i), line.charCodeAt(i + 1));
    ctrl(0x14, 0x2f); // EOC
    const padding = pairsPerFrame - (offset - start) / 2;
    for (let i = 0; i < padding; i++) pair(0, 0);
  }
  return bytes;
}

const STREAM_608 = build608Stream(FRAMES, PAIRS_PER_FRAME);

{
  const probe = new CEA608Decoder();
  for (let i = 0; i < 50 * PAIRS_PER_FRAME * 2; i += 2) {
    probe.decodePair(STREAM_608[i], STREAM_608[i + 1], i / (PAIRS_PER_FRAME * 2) / FPS);
  }
  probe.flush(50 / FPS);
  if (probe.cues.length < 45) {
    throw new Error(`CEA-608 bench input only produced ${probe.cues.length} cues for 50 frames`);
  }
}

describe('CEA-608', () => {
  bench(
    `decodePair: ${PAIRS_PER_FRAME} pairs/frame x ${FRAMES} frames (${(STREAM_608.length / 2).toLocaleString()} pairs)`,
    () => {
      const decoder = new CEA608Decoder();
      let offset = 0;
      for (let f = 0; f < FRAMES; f++) {
        const time = f / FPS;
        for (let p = 0; p < PAIRS_PER_FRAME; p++) {
          decoder.decodePair(STREAM_608[offset], STREAM_608[offset + 1], time);
          offset += 2;
        }
      }
      decoder.flush(FRAMES / FPS);
    },
    { time: 0, iterations: 3, warmupIterations: 1, warmupTime: 0 },
  );
});
