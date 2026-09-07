import { parseByteStream, parseText, type CaptionsFileFormat } from 'media-captions';
import { bench, describe } from 'vitest';

import {
  chunkStream,
  generateASS,
  generateLRC,
  generateSCC,
  generateSRT,
  generateTTML,
  generateVTT,
  toByteChunks,
} from './inputs';

const CHUNK_SIZE = 64 * 1024;

const OPTIONS = { time: 1000, iterations: 5, warmupIterations: 2, warmupTime: 200 };

const INPUTS: { name: string; type: CaptionsFileFormat; text: string }[] = [
  { name: 'vtt 10k cues', type: 'vtt', text: generateVTT(10_000) },
  { name: 'srt 10k cues', type: 'srt', text: generateSRT(10_000) },
  { name: 'ass 5k dialogue lines, 20 styles', type: 'ass', text: generateASS(5_000, 20) },
  { name: 'ttml 2k paragraphs', type: 'ttml', text: generateTTML(2_000) },
  { name: 'scc 2k lines', type: 'scc', text: generateSCC(2_000) },
  { name: 'lrc 5k lines', type: 'lrc', text: generateLRC(5_000) },
];

describe('parseText', () => {
  for (const { name, type, text } of INPUTS) {
    bench(
      `${name} (${(text.length / 1024).toFixed(0)} KB)`,
      async () => {
        await parseText(text, { type });
      },
      OPTIONS,
    );
  }
});

/**
 * `parseTextStream` consumes a stream of lines, so arbitrary 64 KB chunks go through
 * `TextLineTransformStream` first. `parseByteStream` is exactly that pipeline (it is what
 * `parseResponse` uses), so this measures the streaming path end to end.
 */
describe('parseByteStream (parseTextStream fed 64 KB chunks)', () => {
  for (const { name, type, text } of INPUTS) {
    const chunks = toByteChunks(text, CHUNK_SIZE);
    bench(
      `${name} (${chunks.length} chunks)`,
      async () => {
        await parseByteStream(chunkStream(chunks), { type });
      },
      OPTIONS,
    );
  }
});
