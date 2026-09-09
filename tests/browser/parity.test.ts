/**
 * DOM / canvas parity sweep: every text sample in the playground is rendered through both writers
 * at a grid of media times, and for each active cue the text box centre and the effective opacity
 * are compared. This is the test that catches the class of bugs the geometry suites miss: a
 * repaint that stops following time, an opacity curve that stacks per draw call, a transition
 * one writer has and the other lacks.
 */
import { parseText, tokenizeVTTCue, type VTTCue, type VTTNode } from 'media-captions';
import {
  canvasTextMeasurer,
  ImageCache,
  layoutCaptions,
  paintCue,
  paintRegion,
  type PaintContext,
} from 'media-captions/canvas';

import { textSamples } from '../../playground/samples';
import { createFixture, nextFrame, rect, type Fixture } from './helpers';

const WIDTH = 640,
  HEIGHT = 360,
  STEP = 0.5,
  /**
   * Sample this long after each half second. Sample cues start on the half second, and the region
   * scroll transition (0.433s of media time in the canvas) has finished by then.
   */
  PHASE = 0.45,
  /**
   * Distance allowed between the DOM text and the painted pixels: horizontally on the alignment
   * edge (see `alignmentEdge`), vertically on the centre of the line grid.
   */
  X_TOLERANCE = 10,
  Y_TOLERANCE = 8,
  OPACITY_TOLERANCE = 0.2;

let fixture: Fixture,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  style: HTMLStyleElement;

beforeEach(() => {
  fixture = createFixture(WIDTH, HEIGHT);
  canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  ctx = canvas.getContext('2d')!;
  // The sweep advances media time far faster than wall time, so the DOM's wall-clock region
  // transition would still be running at every sample. The canvas one runs on media time.
  style = document.createElement('style');
  style.textContent = '[data-part="region"] { transition: none !important; }';
  document.head.append(style);
});

afterEach(() => {
  fixture.destroy();
  style.remove();
});

const norm = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();

function plainText(cue: VTTCue) {
  const walk = (nodes: VTTNode[]): string =>
    nodes.map((node) => (node.type === 'text' ? node.data : walk(node.children))).join('');
  return norm(walk(tokenizeVTTCue(cue)));
}

/** Bounding box and peak alpha of everything painted on the canvas. */
function paintedBox(context: PaintContext) {
  const data = context.getImageData(0, 0, WIDTH, HEIGHT).data;
  let minX = WIDTH,
    minY = HEIGHT,
    maxX = -1,
    maxY = -1,
    maxAlpha = 0;
  for (let i = 3; i < data.length; i += 4) {
    const a = data[i];
    if (a <= 8) continue;
    const p = i >> 2,
      x = p % WIDTH,
      y = (p - x) / WIDTH;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (a > maxAlpha) maxAlpha = a;
  }
  if (maxX < 0) return null;
  return {
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    left: minX,
    right: maxX,
    top: minY,
    bottom: maxY,
    maxAlpha,
  };
}

/** Cues whose painted extent is clipped (SSA \clip, scroll bands) have no comparable centre. */
function isClipped(cue: VTTCue) {
  return (
    !!cue.layout?.clip ||
    !!cue.animations?.some((anim) => anim.keyframes.some((frame) => frame.clip !== undefined))
  );
}

/**
 * Centre of the DOM cue's glyphs, clipped to the viewport (the painted pixels are too). The text
 * box element can be wider than its text (`align:start`/`end`), so measure the inline content.
 */
function domTextCentre(inner: HTMLElement, frame: DOMRect) {
  const range = document.createRange();
  range.selectNodeContents(inner);
  const r = range.getBoundingClientRect(),
    left = Math.max(r.left, frame.left),
    right = Math.min(r.right, frame.right),
    top = Math.max(r.top, frame.top),
    bottom = Math.min(r.bottom, frame.bottom);
  if (right <= left || bottom <= top) return null;
  return {
    cx: (left + right) / 2 - frame.left,
    cy: (top + bottom) / 2 - frame.top,
    left: left - frame.left,
    right: right - frame.left,
  };
}

/**
 * The horizontal reference both writers must agree on. Wrap points can differ between the canvas
 * flow and the browser, which moves the centre of left- or right-aligned multi-line text, but not
 * the edge the lines are aligned to.
 */
function alignmentEdge(inner: HTMLElement): 'left' | 'center' | 'right' {
  const { textAlign, direction } = getComputedStyle(inner),
    ltr = direction !== 'rtl';
  if (textAlign === 'center') return 'center';
  if (textAlign === 'left' || (textAlign === 'start' && ltr) || (textAlign === 'end' && !ltr)) {
    return 'left';
  }
  return 'right';
}

function effectiveOpacity(display: HTMLElement) {
  const inner = display.querySelector<HTMLElement>('[data-part="cue"]');
  return (
    parseFloat(getComputedStyle(display).opacity) *
    (inner ? parseFloat(getComputedStyle(inner).opacity) : 1)
  );
}

for (const sample of textSamples) {
  test(`${sample.name}: DOM and canvas agree on position and opacity over time`, async () => {
    const result = await parseText(sample.text, { type: sample.type });
    fixture.renderer.changeTrack(result);
    const measurer = canvasTextMeasurer(ctx),
      images = new ImageCache(() => {}),
      problems: string[] = [];

    for (let time = PHASE; time < sample.duration; time += STEP) {
      fixture.renderer.currentTime = time;
      await nextFrame();
      await nextFrame();
      const frame = rect(fixture.viewport),
        active = fixture.renderer.activeCues,
        { theme, targets } = layoutCaptions(active, measurer, {
          width: WIDTH,
          height: HEIGHT,
          metadata: result.metadata,
        }),
        paint = { time, theme, images, measurer },
        at = (t: number) => `${t.toFixed(2)}s`;

      // --- Cues outside regions -----------------------------------------------------------
      const used = new Set<number>();
      for (const display of fixture.overlay.querySelectorAll<HTMLElement>(
        '[data-part="cue-display"]',
      )) {
        if (display.closest('[data-part="region"]')) continue;
        const text = norm(display.textContent),
          index = targets.findIndex(
            (target, i) =>
              !used.has(i) && target.kind === 'cue' && plainText(target.item.cue) === text,
          );
        if (index === -1) {
          problems.push(`${at(time)}: "${text}" is shown by the DOM only`);
          continue;
        }
        used.add(index);
        const target = targets[index];
        if (target.kind !== 'cue') continue;
        const { cue } = target.item;
        // Image cues load asynchronously in the canvas; nothing to compare on the first paint.
        if (!text && cue.textStyle?.image) continue;

        ctx.clearRect(0, 0, WIDTH, HEIGHT);
        paintCue(ctx, target.item, target.box, paint);
        const painted = paintedBox(ctx),
          opacity = effectiveOpacity(display);
        if (!painted) {
          if (opacity > 0.1) problems.push(`${at(time)}: "${text}" painted nothing on canvas`);
          continue;
        }

        const inner = display.querySelector<HTMLElement>('[data-part="cue"]') ?? display,
          centre = domTextCentre(inner, frame),
          edge = alignmentEdge(inner),
          domX = centre ? (edge === 'center' ? centre.cx : centre[edge]) : 0,
          // The painted box includes the background, so step in by the padding to reach the glyphs.
          pad = target.item.style.paddingX,
          canvasX =
            edge === 'center'
              ? painted.cx
              : edge === 'left'
                ? painted.left + pad
                : painted.right - pad;
        if (
          centre &&
          !isClipped(cue) &&
          (Math.abs(domX - canvasX) > X_TOLERANCE || Math.abs(centre.cy - painted.cy) > Y_TOLERANCE)
        ) {
          problems.push(
            `${at(time)}: "${text}" ${edge} DOM (${domX.toFixed(0)}, ${centre.cy.toFixed(0)}) vs canvas (${canvasX.toFixed(0)}, ${painted.cy.toFixed(0)})`,
          );
        }
        if (Math.abs(opacity - painted.maxAlpha / 255) > OPACITY_TOLERANCE) {
          problems.push(
            `${at(time)}: "${text}" opacity DOM ${opacity.toFixed(2)} vs canvas ${(painted.maxAlpha / 255).toFixed(2)}`,
          );
        }
      }
      for (const [i, target] of targets.entries()) {
        if (target.kind === 'cue' && !used.has(i)) {
          problems.push(
            `${at(time)}: "${plainText(target.item.cue)}" is laid out by the canvas only`,
          );
        }
      }

      // --- Regions: vertical extent of the rows ---------------------------------------------
      const domRegions = [...fixture.overlay.querySelectorAll<HTMLElement>('[data-part="region"]')]
          .filter((el) => el.querySelector('[data-part="cue-display"]'))
          .map((el) => rect(el)),
        canvasRegions = targets.filter((target) => target.kind === 'region');
      if (domRegions.length !== canvasRegions.length) {
        problems.push(
          `${at(time)}: ${domRegions.length} DOM region(s) vs ${canvasRegions.length} canvas region(s)`,
        );
      } else {
        for (const target of canvasRegions) {
          if (target.kind !== 'region') continue;
          ctx.clearRect(0, 0, WIDTH, HEIGHT);
          paintRegion(ctx, target.item, target.box, paint);
          const painted = paintedBox(ctx);
          if (!painted) continue;
          // Pair each canvas region with the nearest DOM region.
          const r = domRegions.reduce((best, candidate) =>
            Math.abs(candidate.left - frame.left + candidate.width / 2 - painted.cx) <
            Math.abs(best.left - frame.left + best.width / 2 - painted.cx)
              ? candidate
              : best,
          );
          const top = r.top - frame.top,
            bottom = r.bottom - frame.top;
          if (
            Math.abs(top - painted.top) > Y_TOLERANCE ||
            Math.abs(bottom - painted.bottom) > Y_TOLERANCE
          ) {
            problems.push(
              `${at(time)}: region rows DOM ${top.toFixed(0)}..${bottom.toFixed(0)} vs canvas ${painted.top}..${painted.bottom}`,
            );
          }
        }
      }
    }

    expect(problems).toEqual([]);
  }, 90_000);
}
