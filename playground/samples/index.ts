import { ceaLiveSample } from './cea-live';
import { lrcSample } from './lrc';
import { microdvdSample } from './microdvd';
import { samiSample } from './sami';
import { sbvSample } from './sbv';
import { sccSample } from './scc';
import { srtSample } from './srt';
import { ssaSample } from './ssa';
import { ttmlSample } from './ttml';
import type { Sample, TextSample } from './types';
import { vttSample } from './vtt';

export type { CCPacket, LiveSample, Sample, TextSample } from './types';

export const samples: Sample[] = [
  vttSample,
  srtSample,
  ssaSample,
  ttmlSample,
  sccSample,
  lrcSample,
  sbvSample,
  samiSample,
  microdvdSample,
  ceaLiveSample,
];

export const textSamples = samples.filter((s): s is TextSample => s.kind === 'text');

export function findSample(id: string | null | undefined): Sample {
  return samples.find((s) => s.id === id) ?? samples[0];
}
