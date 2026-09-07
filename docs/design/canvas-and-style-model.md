# Canvas rendering and the cue style model

Status: September 2026. `media-captions/canvas` ships as an experimental writer, and the typed
style model proposed below has been implemented (see "Outcome"). This note records what the canvas
work showed about the renderer architecture and the parser to renderer contract.

## What we have

The pipeline is parser -> cue model -> renderer. The cue model is `VTTCue` plus four extension
fields the typesetting formats fill in:

- `layout`: box placement as overlay percentages, a translation as a fraction of the box, and a
  `clipPath` **CSS string**.
- `textStyle` / `spans`: presentation as **CSS value strings** (`fontSize:
'calc(var(--overlay-height) * 0.0667)'`, `transform: 'scaleX(1.2) rotate(-10deg)'`,
  `textStroke: 'calc(...) rgba(...)'`, `backgroundImage: 'linear-gradient(...)'`).
- `animations`: Web Animations keyframes with CSS property names and string values.
- `drawing`: SVG path data.

The DOM renderer hands these strings to the browser, which is why they are CSS. It works, but it
leaks the DOM writer's needs into the model and forces a set of workarounds:

| Workaround                                               | Why it exists                                                      |
| -------------------------------------------------------- | ------------------------------------------------------------------ |
| `calc(var(--overlay-width) * K + T%)` strings            | Parsers do not know the pixel size; CSS resolves it at paint time  |
| `display: inline-block` on transformed spans             | CSS transforms do not apply to inline boxes                        |
| `--cue-transform-origin` variable on two elements        | The `\t` target and the box must share a pivot                     |
| `data-fixed` attribute read back during measure          | Layout learns "do not move me" from the DOM instead of the model   |
| `LAYOUT_CACHE` symbol on elements                        | Measuring the DOM is expensive, so results hide on the node        |
| `requestAnimationFrame` before `data-active`             | Region scroll transitions need a resting frame first               |
| `clipRect` resolved at write time into `--cue-clip-path` | A screen-fixed clip on a layout-positioned box needs the final box |
| `contain: layout style` (not `paint`)                    | Paint containment clipped rotated/scaled text                      |
| Sweep gradients with `background-clip: text`             | Karaoke fill needs a glyph mask; CSS only offers this trick        |

None of these are bugs. They are the cost of expressing a typesetting model in CSS.

## What the canvas writer showed

`src/canvas` re-implements the write phase (and the measure phase) against a 2D context, reusing
the cue model, `CueTrack`, `orderForPositioning`, and the pure layout engine unchanged.

**The layout engine was already the right boundary.** `CueLayoutInput` is the whole contract
between measurement and layout. The headless measurer (`src/canvas/measure.ts`) produces it from
text metrics, and the browser tests show the boxes land within a couple of pixels of the DOM
renderer for the WebVTT tier. Positioning, stacking, and collision avoidance are shared code.

**Things that were hacks in the DOM are one line on a canvas.**

- Screen-fixed clips: `ctx.rect(); ctx.clip()` in overlay pixels. No write-time resolution.
- Transform pivots: `translate(origin); rotate(); scale(); translate(-origin)`. No variable
  plumbing between two elements, no inline-block.
- Drawings: `new Path2D(svgPath)`. No SVG element construction.
- Fixed cues and region activation: plain data, no attributes or animation frames.
- Animations: sampled at media time from the keyframes (`src/canvas/animate.ts`). No paused Web
  Animation objects to create, track, and seek.
- Measurement cache: a `Map<VTTCue, MeasuredCue>` keyed by frame size.

**What became harder.** Line breaking, balancing, font fallback, bidi, and accessibility all come
for free in the DOM and had to be written or given up. The canvas flow is greedy wrapping with a
balance pass and character-level overflow; there is no vertical text, no ruby positioning, no
selection, and no screen reader access (the announcer feature covers the last one).

**The bridge that should not exist.** `src/canvas/css-values.ts` parses the CSS strings back into
numbers: `calc()` lengths, transform lists, shadows, strokes, clip polygons, colours. It works
because parsers only emit a small dialect, but it is a second interpreter for our own output, and
every new string form needs updating in two places.

## Proposal: a typed style model

Make the cue model carry values, and let each writer serialise them.

```ts
type Length =
  | number                              // pixels (rare; images with known sizes)
  | { unit: 'vw' | 'vh' | 'em' | '%'; value: number };  // of the overlay, the font, or the box

type Color = string;                    // normalised `#rrggbbaa`

interface Transform { scaleX?: number; scaleY?: number; rotate?: number; rotateX?: number; rotateY?: number; origin?: [Length, Length] }
interface Stroke { width: Length; color: Color }
interface Shadow { x: Length; y: Length; blur?: Length; color: Color }
interface Fill { color: Color } | { sweep: { from: Color; to: Color; progress: number } }

interface CueTextStyle {
  color?: Color; background?: Color; fontFamily?: string; fontSize?: Length; fontWeight?: number;
  italic?: boolean; decoration?: ('underline' | 'line-through')[]; letterSpacing?: Length;
  lineHeight?: Length | 'normal'; opacity?: number; textAlign?: ...; wrap?: 'normal' | 'none';
  stroke?: Stroke; shadow?: Shadow; outline?: Stroke; padding?: { x?: Length; y?: Length };
  transform?: Transform; image?: { url: string; fit: 'contain' | 'cover' | 'fill' };
}

interface CueLayout {
  left?: Length; top?: Length; right?: Length; bottom?: Length;
  width?: Length | 'auto' | 'max-content'; maxWidth?: Length; height?: Length;
  anchor?: { x: number; y: number };    // was `translate`: fraction of the box
  fixed?: boolean;
  clip?: { rect: [Length, Length, Length, Length] } | { polygon: [Length, Length][] } // overlay-relative
}

interface CueAnimation {
  target?: 'display' | 'cue' | { span: string };
  delay?: number; duration: number; easing?: ...;
  keyframes: { offset?: number; opacity?: number; color?: Color; left?: Length; top?: Length; transform?: Transform; stroke?: Partial<Stroke>; fill?: Fill }[];
}
```

**Writers become serialisers.** The DOM writer turns `{ unit: 'vh', value: 6.67 }` into
`calc(var(--overlay-height) * 0.0667)` and `Transform` into a `transform` string with its origin;
the canvas writer turns the same values into pixels and context calls; the string renderer
(`renderVTTCueString`) keeps emitting inline CSS. `toJSON` output becomes stable and readable.

**Parsers get simpler.** `ssa-parser.ts` currently formats CSS in a dozen places (`_lenY`,
`toRGBA`, transform joins, gradient strings, `calc()` clip polygons). With typed values it emits
`{ unit: 'vh', value: bord * 2 / playResY * 100 }` and is done. Karaoke sweeps become a `Fill`
with progress driven by the animation, and each writer decides how to paint a partial fill (a
gradient mask in CSS, a clipped double fill on canvas).

**Migration.** Additive, in three steps, no flag day:

1. Add the typed fields alongside the strings (`fontSize` stays; `fontSizeValue` or a `v2`
   namespace), with a `toCSS()` helper both writers can use. Parsers emit both for one release.
2. Switch the DOM writer to serialise from typed values; the CSS strings become derived and
   deprecated in `toJSON`.
3. Drop the strings and `css-values.ts`. `renderVTTCueString` serialises typed spans.

Since this ships as a new package with breaking changes allowed, steps 1 and 2 can collapse into
one release and step 3 can follow once TTML and CEA-708 are converted (SSA is the bulk).

## Outcome

The typed model landed in one step, since the package ships with breaking changes allowed:

- `CueLength`, `CueTransform` (with `origin` in box percentages or `originAt` on the overlay),
  `CueStroke`, `CueShadow`, `CueSweep`, `CueClip` (`rect`/`polygon` overlay-relative, `inset`
  box-relative), and typed `CueKeyframe`s replaced every CSS string in `CueTextStyle`,
  `CueSpanStyle`, `CueLayout`, and `CueAnimation`.
- `src/vtt/style-css.ts` is the DOM/string writers' serialiser; `src/canvas/values.ts` is the
  canvas writer's resolver. `src/canvas/css-values.ts` (the bridge that should not exist) is gone.
- SSA, TTML, CEA-708, and MicroDVD parsers emit values. `_lenY` returns a `vh` length; clips are
  overlay percentages for positioned and layout-positioned cues alike; karaoke is a `sweep` fill
  with a 0..1 keyframe; `\org` is an overlay point.
- Clips are resolved once per layout in the DOM write phase with pixel arithmetic; only animated
  clips (scroll bands) still go through the `calc(var(--overlay-*))` form, generated by the writer
  per keyframe.
- Bundle effect: the canvas renderer lost ~1.1 KB (no CSS parsing), the DOM renderer gained
  ~1.2 KB (it now serialises), and the SSA/TTML parser chunks shrank.

## What canvas unlocks next

- **Burn-in and export.** `paintCaptions(ctx, cues, time)` onto `VideoFrame`s in a WebCodecs
  pipeline, or in a Worker with `OffscreenCanvas`. The API is already stateless.
- **iOS fullscreen and picture-in-picture.** Paint into a canvas, `captureStream()` it, and
  composite with the video; the only route to custom captions in those surfaces.
- **Thumbnails and previews.** One call per time; no DOM, no layout thrash.
- **Deterministic visual tests.** Rasterised goldens do not drift with browser text stacks.
- **DOM-less runtimes.** Smart TVs with a canvas but a weak DOM, Node with a canvas binding.

## Known gaps in the canvas writer

Vertical writing modes (rendered horizontally), ruby positioning (inline, smaller), `rotateX`/
`rotateY`, karaoke sweep gradients (final colour), blur filters, `\move` easing beyond linear,
STYLE blocks (no CSS engine), and the `text-wrap: balance` heuristic is an approximation of the
browser's. Fonts are limited to what the canvas can resolve by name; `loadEmbeddedFonts` still
works since it registers `FontFace`s document-wide.
