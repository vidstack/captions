import { CueTrack, VTTCue } from 'media-captions';
import { bench, describe } from 'vitest';

import { createRandom, keep } from './inputs';

const COUNT = 50_000,
  /** Total timeline covered by the cues, in seconds. */
  DURATION = COUNT * 2;

/** Whole-track operations are O(n^2) in places; a handful of iterations is enough. */
const HEAVY = { time: 0, iterations: 3, warmupIterations: 1, warmupTime: 0 },
  LIGHT = { time: 500, iterations: 10 };

const random = createRandom(8);

/** Sorted by start time, with overlapping/irregular durations so `maxEnd` does real work. */
const SORTED: VTTCue[] = [];
for (let i = 0; i < COUNT; i++) {
  const start = i * 2 + random(),
    end = start + 1 + random() * (i % 100 === 0 ? 60 : 3);
  SORTED.push(new VTTCue(start, end, `cue ${i}`));
}

const SHUFFLED = SORTED.slice();
for (let i = SHUFFLED.length - 1; i > 0; i--) {
  const j = Math.floor(random() * (i + 1));
  [SHUFFLED[i], SHUFFLED[j]] = [SHUFFLED[j], SHUFFLED[i]];
}

const TIMES = Array.from({ length: 1000 }, () => random() * DURATION);
const UPDATE_TARGETS = Array.from({ length: 1000 }, () => SORTED[Math.floor(random() * COUNT)]);

describe('CueTrack 50k cues', () => {
  bench('construct from 50k sorted cues', () => keep(new CueTrack(SORTED)), HEAVY);

  bench(
    'add 50k cues in sorted order',
    () => {
      const track = new CueTrack();
      for (let i = 0; i < SORTED.length; i++) track.add(SORTED[i]);
    },
    HEAVY,
  );

  bench(
    'add 50k cues in random order',
    () => {
      const track = new CueTrack();
      for (let i = 0; i < SHUFFLED.length; i++) track.add(SHUFFLED[i]);
    },
    HEAVY,
  );

  const lookup = new CueTrack(SORTED);
  bench(
    'activeAt x1000 random times',
    () => {
      for (let i = 0; i < TIMES.length; i++) lookup.activeAt(TIMES[i]);
    },
    LIGHT,
  );

  const updating = new CueTrack(SORTED);
  let flip = 0;
  bench(
    'update x1000 cues (end time nudged)',
    () => {
      flip ^= 1;
      for (let i = 0; i < UPDATE_TARGETS.length; i++) {
        const cue = UPDATE_TARGETS[i];
        cue.endTime += flip ? 0.05 : -0.05;
        updating.update(cue);
      }
    },
    HEAVY,
  );

  bench(
    'evict half the track (retention 60s, includes construction)',
    () => {
      const track = new CueTrack(SORTED, { retention: 60 });
      track.evict(DURATION / 2);
    },
    HEAVY,
  );
});
