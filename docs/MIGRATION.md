# Migrating from media-captions 1.x

This release is a new package: the parsers were rewritten for spec conformance, the renderer was
rebuilt as a composable core with features, a canvas writer was added, and the cue style model is
typed. Most call sites keep working unchanged: `parseText`, `parseResponse`, `parseByteStream`,
`CaptionsRenderer`, `renderVTTCueString`, `tokenizeVTTCue`, `VTTCue`, `VTTRegion`, and the parse
options are all still there. What follows is everything that can break.

## Package and entry points

- **ESM only.** No CommonJS build. `main`/`exports` point at ESM files.
- **New entry points.** `media-captions/renderer` (composable core and features),
  `media-captions/canvas` (canvas writer), `media-captions/cea` (CEA-608/708 from video streams),
  `media-captions/mp4` (fMP4 `wvtt`/`stpp` demux), `media-captions/element`
  (`<media-captions>`), `media-captions/entities` (full HTML entity table), and
  `media-captions/parsers/<format>` for bundlers that can not follow dynamic imports. The main
  entry still lazy-loads parsers by `type`.
- **New formats** need a `type` or a recognisable file: `ttml`, `scc`, `lrc`, `sbv`, `smi`, `sub`
  join `vtt`, `srt`, `ssa`/`ass`. `inferCaptionsFormat(text)` sniffs a string.

## Parsing

- **WebVTT is spec-strict about structure.** The signature must be `WEBVTT` followed by a space,
  tab, or line end (a BOM is allowed). A missing signature is reported and tolerated outside
  `strict` mode. `strict` also enforces the timestamp grammar and requires `%` on percentages;
  lenient mode still accepts comma separators, bare numbers, and legacy `align:middle`.
- **Cue settings are only read from the timing line.** The 1.x tolerance for settings on the line
  after the timing line is gone; it swallowed real caption text that began with `line:`,
  `position:`, or `align:`.
- **Numeric settings must match the spec grammar** (no exponents, prefixes, or negative zero),
  compound `line`/`position` values are atomic, `REGION` lines are digits only, and a `-->` line
  discards a `REGION` block. Cues whose end is not after their start are kept and reported, as
  browsers do.
- **Cue text is escaped.** Rendered HTML never contains raw markup from the file. Class names are
  restricted to word characters and hyphens, unknown end tags do not corrupt nesting, and
  timestamps render as sibling `<span data-part="timed">` elements.
- **SSA/ASS is a full typesetting parser.** Sizes, margins, and outlines scale with `PlayResX`/
  `PlayResY` (default 384x288). Override tags, layers, `\pos`/`\move`/`\fad`/`\t`, karaoke, `\p`
  drawings, `\clip`, `Effect` fields, and embedded fonts (`loadEmbeddedFonts`) are supported.
  Output is expressed through `cue.layout`, `cue.textStyle`, `cue.spans`, and `cue.animations`
  rather than `--cue-*` custom properties.
- **Hostile input is bounded.** Regexes are linear, nesting depth is capped, and malformed lines
  never throw outside `strict`.
- **`lenient: false`** is new: the spec grammar (what `strict` enforces) without the throw, so
  invalid cues are dropped and reported the way a browser would. The default stays lenient.
- **Mismatched end tags follow the spec.** `</b>` while `<i>` is the current node is ignored
  instead of closing the `<b>` ancestor, so `<b><i>x</b> y` keeps ` y` bold italic (as browsers
  render it). Unknown end tags are still ignored.

## Cue model

`VTTCue` gained structured fields that parsers of positioned formats fill in. If you read cues
directly (custom renderers, analytics, caches), note:

- `cue.layout`, `cue.textStyle`, `cue.spans`, `cue.animations`, `cue.layer` are new.
  `cue.style` (raw CSS custom properties) remains as an escape hatch and is applied last.
- **Values, not CSS strings.** Lengths are `number` (px) or `{ unit: 'vw' | 'vh' | 'em' | '%',
value }`. Transforms are `{ scaleX, scaleY, rotate, rotateX, rotateY, origin | originAt }`.
  Strokes are `{ width, color }`, shadows `{ x, y, blur?, color }`. Font weight is a number,
  italic/underline/strike are booleans, opacity is a number. Karaoke sweeps are
  `span.sweep = { sung, unsung }` plus a `sweep` keyframe (0..1). Images are
  `textStyle.image = { url, fit? }`. Clips are `layout.clip`: `{ rect }` or `{ polygon }` in
  overlay percentages (screen-fixed) or `{ inset }` in box percentages.
- **Keyframes are typed** the same way: `opacity`, `color`, `strokeColor`, `strokeWidth`,
  `fontSize`, `letterSpacing`, `shadow`, `blur`, `transform`, `left`/`top` (overlay %),
  `translate` (box fraction), `clip`, `sweep`.
- `toJSON()` / `VTTCue.from(json, regions)` round-trip everything; regions are referenced by id.
- Open-ended live cues use `endTime: Infinity` (`null` in JSON).
- `cue.region` is our own property on the native base class in Firefox and WebKit (their native
  setter rejected our `VTTRegion`).

## Rendering

- **Stylesheet.** Defaults live in `@layer media-captions`, so any unlayered author rule wins
  regardless of specificity. Colour and overlay size variables are registered with `@property`.
  Cue boxes use `contain: layout style` (paint containment clipped transformed text). Image cues
  are `background-size: contain`. `regions.css` is still separate.
- **Renderer init options** grew: `retention`, `announce`, `stacking`, `lineStep`, `safeArea`,
  `reducedMotion`, `features`. `changeTrack` also takes `metadata` and `styles`, and `cues` may be a
  `CueTrack` for live content. `activeCues`, `track`, `attachTrack`, and cue `enter`/`exit` events
  are new. `dir` and `currentTime` are unchanged.
- **Composable renderer.** `CaptionsRenderer` is now the core with every feature installed.
  `createRenderer(overlay, { features })` from `media-captions/renderer` lets you pick `regions()`,
  `typesetting()`, `animations()`, `vttStyles()`, `announcer()`. Without a feature the matching
  cue fields are ignored (with a development warning), not errors.
- **Canvas renderer.** `CanvasCaptionsRenderer` and `paintCaptions` in `media-captions/canvas`
  paint the same cue model into a 2D context; `syncCaptionsRenderer` accepts either renderer.
- **Token renderers.** `renderVTTTokensString(tokens, currentTime, layout?)`,
  `renderVTTTokensDOM(tokens, currentTime, doc?, layout?)`, and
  `getVTTTokenAttributes(token, currentTime, layout?)` take the cue layout as a trailing optional
  argument (only needed for SSA `\org` pivots on spans). `renderVTTTokensDOM` builds DOM nodes
  without `innerHTML`, so it works under strict CSP.

## Quick fixes

| 1.x                                                   | Now                                                                                            |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `require('media-captions')`                           | `import ... from 'media-captions'`                                                             |
| Settings on the line after the timing line            | Move them onto the timing line                                                                 |
| `cue.style['--cue-left']` etc. from the SSA parser    | `cue.layout.left` (overlay %)                                                                  |
| Reading `textStyle.fontSize` as a CSS string          | `lengthToCSS(textStyle.fontSize)` from the main entry, or resolve the typed value              |
| `layout.clipPath` / `layout.clipRect`                 | `layout.clip`                                                                                  |
| `video.addEventListener('timeupdate', ...)` sync loop | `syncCaptionsRenderer(renderer, video)` (frame accurate)                                       |
| Custom overlay markup styling by element              | `data-part` / `part` attributes (`captions`, `cue-display`, `cue`, `region`, `timed`, `voice`) |
