import { bench, describe } from 'vitest';

import type { Box } from '../../src/vtt/overlay/box';
import {
  layoutItems,
  type CueLayoutInput,
  type LayoutInput,
  type RegionLayoutInput,
} from '../../src/vtt/overlay/layout';
import { createRandom, keep } from './inputs';

const OPTIONS = { time: 500, iterations: 20 };

const CONTAINER: Box = { top: 0, left: 0, width: 1280, height: 720, right: 1280, bottom: 720 };

function box(top: number, left: number, width: number, height: number): Box {
  return { top, left, width, height, right: left + width, bottom: top + height };
}

/**
 * A realistic mix: ~60% snap-to-lines cues (mostly negative lines near the bottom, some positive),
 * ~40% percentage lines with varied alignment, and a `fixed` share that others must avoid.
 */
function cues(count: number, { fixedShare = 0, seed = 9 } = {}): CueLayoutInput[] {
  const random = createRandom(seed),
    items: CueLayoutInput[] = [];
  for (let i = 0; i < count; i++) {
    const width = 200 + Math.floor(random() * 600),
      height = 40 + Math.floor(random() * 3) * 40,
      left = Math.floor(random() * (CONTAINER.width - width)),
      snap = random() < 0.6,
      vertical = random() < 0.1 ? (random() < 0.5 ? 'rl' : 'lr') : '';
    items.push({
      kind: 'cue',
      box: vertical ? box(0, left, height, width) : box(0, left, width, height),
      lineHeight: 40,
      snapToLines: snap,
      line: snap
        ? random() < 0.75
          ? -1 - Math.floor(random() * 8)
          : Math.floor(random() * 6)
        : Math.floor(random() * 100),
      lineAlign: (['start', 'center', 'end'] as const)[Math.floor(random() * 3)],
      vertical,
      fixed: random() < fixedShare,
      positionOverride: false,
    });
  }
  return items;
}

function regions(count: number, seed = 10): RegionLayoutInput[] {
  const random = createRandom(seed);
  return Array.from({ length: count }, () => {
    const width = 300 + Math.floor(random() * 500),
      height = 80 + Math.floor(random() * 160);
    return {
      kind: 'region',
      box: box(
        Math.floor(random() * (CONTAINER.height - height)),
        Math.floor(random() * (CONTAINER.width - width)),
        width,
        height,
      ),
    };
  });
}

describe('layoutItems', () => {
  for (const count of [10, 50, 200]) {
    const items: LayoutInput[] = cues(count);
    bench(
      `${count} cues (snap + percentage mix)`,
      () => {
        keep(layoutItems(CONTAINER, items));
      },
      OPTIONS,
    );
  }

  const withFixed: LayoutInput[] = cues(200, { fixedShare: 0.15 });
  bench(
    '200 cues, 15% fixed',
    () => {
      keep(layoutItems(CONTAINER, withFixed));
    },
    OPTIONS,
  );

  const withRegions: LayoutInput[] = [...regions(10), ...cues(50)];
  bench(
    '10 regions + 50 cues',
    () => {
      keep(layoutItems(CONTAINER, withRegions));
    },
    OPTIONS,
  );

  const stacked: LayoutInput[] = cues(50).map((item) => ({
    ...item,
    box: box(0, 340, 600, 40),
    snapToLines: true,
    line: -1,
    vertical: '',
    fixed: false,
  }));
  bench(
    '50 identical line:-1 cues (worst-case stacking)',
    () => {
      keep(layoutItems(CONTAINER, stacked));
    },
    OPTIONS,
  );
});
