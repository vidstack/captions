import type { Box } from '../../src/vtt/overlay/box';
import { layoutItem, layoutItems, type CueLayoutInput } from '../../src/vtt/overlay/layout';

const container: Box = { top: 0, left: 0, width: 1000, height: 500, right: 1000, bottom: 500 };

function box(top: number, left: number, width: number, height: number): Box {
  return { top, left, width, height, right: left + width, bottom: top + height };
}

function cue(overrides: Partial<CueLayoutInput> = {}): CueLayoutInput {
  return {
    kind: 'cue',
    box: box(0, 300, 400, 40),
    lineHeight: 20,
    snapToLines: true,
    line: -1,
    lineAlign: 'start',
    vertical: '',
    fixed: false,
    positionOverride: false,
    ...overrides,
  };
}

describe('snap to lines', () => {
  test('line -1 sits flush with the bottom edge', () => {
    const out = layoutItem(container, cue({ line: -1 }), []);
    expect(out.bottom).toBe(500);
    expect(out.height).toBe(40);
  });

  test('line -2 is one line height above the bottom', () => {
    const out = layoutItem(container, cue({ line: -2 }), []);
    expect(out.bottom).toBe(480);
  });

  test('positive lines count from the top in line heights', () => {
    expect(layoutItem(container, cue({ line: 0 }), []).top).toBe(0);
    expect(layoutItem(container, cue({ line: 3 }), []).top).toBe(60);
  });

  test('vertical-lr counts from the left, vertical-rl from the right', () => {
    const vertical = { box: box(0, 0, 40, 400), snapToLines: true, line: 0 };
    expect(layoutItem(container, cue({ ...vertical, vertical: 'lr' }), []).left).toBe(0);
    expect(layoutItem(container, cue({ ...vertical, vertical: 'rl' }), []).right).toBe(1000);
    expect(layoutItem(container, cue({ ...vertical, vertical: 'rl', line: -1 }), []).left).toBe(0);
    expect(layoutItem(container, cue({ ...vertical, vertical: 'lr', line: -1 }), []).right).toBe(
      1000,
    );
  });

  test('out of range lines are clamped inside the container', () => {
    const out = layoutItem(container, cue({ line: 999 }), []);
    expect(out.bottom).toBeLessThanOrEqual(500);
    expect(out.top).toBeGreaterThanOrEqual(0);
  });
});

describe('percentage lines', () => {
  const pct = { snapToLines: false } as const;

  test('start, center, and end alignment place the box on the line', () => {
    expect(layoutItem(container, cue({ ...pct, line: 50, lineAlign: 'start' }), []).top).toBe(250);
    const centered = layoutItem(container, cue({ ...pct, line: 50, lineAlign: 'center' }), []);
    expect((centered.top + centered.bottom) / 2).toBe(250);
    expect(layoutItem(container, cue({ ...pct, line: 50, lineAlign: 'end' }), []).bottom).toBe(250);
  });

  test('line 100 with start alignment is pushed back inside', () => {
    const out = layoutItem(container, cue({ ...pct, line: 100 }), []);
    expect(out.bottom).toBe(500);
  });
});

describe('collisions and ordering', () => {
  test('later items avoid earlier ones', () => {
    const [first, second, third] = layoutItems(container, [cue(), cue(), cue()]);
    expect(first.bottom).toBe(500);
    expect(second.bottom).toBeLessThanOrEqual(first.top);
    expect(third.bottom).toBeLessThanOrEqual(second.top);
  });

  test('fixed cues never move but are avoided', () => {
    const fixed = cue({ fixed: true, box: box(460, 300, 400, 40), line: 0 }),
      [fixedOut, other] = layoutItems(container, [fixed, cue()]);
    expect(fixedOut).toEqual(fixed.box);
    expect(other.bottom).toBeLessThanOrEqual(460);
  });

  test('position overrides only nudge along the overridden axis first', () => {
    const top = cue({ positionOverride: 'top', box: box(100, 300, 400, 40) }),
      blocker = cue({ fixed: true, box: box(100, 300, 400, 40) }),
      [, out] = layoutItems(container, [blocker, top]);
    expect(out.top).toBeGreaterThanOrEqual(140);
    expect(out.left).toBe(300);
  });

  test('regions are moved up when they overlap a placed cue', () => {
    const [cueBox, region] = layoutItems(container, [
      cue(),
      { kind: 'region', box: box(400, 0, 1000, 100) },
    ]);
    expect(region.bottom).toBeLessThanOrEqual(cueBox.top);
  });

  test('inputs are not mutated', () => {
    const input = cue();
    const snapshot = { ...input.box };
    layoutItem(container, input, []);
    expect(input.box).toEqual(snapshot);
  });
});
