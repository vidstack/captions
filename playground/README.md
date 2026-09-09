# Playground

An interactive visual playground for every parser and renderer feature in `media-captions`. It
imports the library straight from `../src`, so it always reflects the working tree.

```bash
pnpm playground            # vp dev --open=/playground/index.html --port=3200
# or, without pnpm:
./node_modules/.bin/vp dev --open=/playground/index.html --port=3200
```

Vanilla TypeScript + CSS, no framework, no dependencies. Everything lives under `playground/`:

| Path                    | What it is                                                              |
| ----------------------- | ----------------------------------------------------------------------- |
| `index.html`, `main.ts` | Entry point; wires the panels together and runs the frame loop          |
| `styles.css`            | Dark UI styling (the library's own `styles/*.css` are loaded alongside) |
| `ui/media.ts`           | `FakeMediaElement`: the mock clock / media element                      |
| `ui/stage.ts`           | The mock video surface with a moving background and layout-box overlay  |
| `ui/transport.ts`       | Play/pause, scrub, rate, stepping, loop, jump to cue                    |
| `ui/timeline.ts`        | Cue bars under the scrub bar                                            |
| `ui/sources.ts`         | Format dropdown, editable source, Apply, file picker                    |
| `ui/options.ts`         | Renderer and styling controls                                           |
| `ui/inspector.ts`       | Active cues, cue table, metadata, errors, events                        |
| `ui/gallery.ts`         | All samples at once                                                     |
| `ui/live-cea.ts`        | Feeds synthesised `cc_data` into the live CEA-608/708 decoders          |
| `ui/state.ts`           | URL state (`?format=ass&t=12.5&rate=1&...`)                             |
| `samples/*.ts`          | One built-in sample per format (`{ name, type, text }`) or a generator  |
| `samples/cea-encode.ts` | CEA-608 pair and CEA-708 packet encoders (adapted from `tests/cea`)     |
| `screenshot.mjs`        | Headless walk through every scenario; asserts zero console errors       |
| `screenshots/*.png`     | Output of `screenshot.mjs`                                              |

## Mock media

There is no real video. The "video" is a 16:9 stage (switchable to 4:3 / 9:16, 320-1280px wide)
with a moving pattern so playback, scrubbing, and pausing are visible. `FakeMediaElement`
(`ui/media.ts`) is an `EventTarget` with `currentTime`, `paused`, `duration`, `playbackRate`,
`play()`/`pause()`, the `timeupdate` / `playing` / `pause` / `seeking` / `seeked` / `ended` events,
and `requestVideoFrameCallback`. The clock is advanced from a `requestAnimationFrame` loop that
accumulates `performance.now()` deltas × rate.

Two driving modes (Renderer options → Driving):

- **`renderer.currentTime` each frame**: the loop assigns the time directly.
- **`syncCaptionsRenderer(fakeMedia)`**: the library helper drives the renderer from the fake
  element's events and frame callbacks, exactly as it would with a real `<video>`.

The `<media-captions>` view always uses `el.media = fakeMedia`.

## Panels

**Left nav**: one scenario per built-in sample plus the CEA-608/708 live stream, and the Gallery /
element views. The header has view tabs (Stage, `<media-captions>`, Gallery) and **Copy link**,
which copies a URL carrying the full state (sample, time, rate, every option).

**Stage + transport**: play/pause, scrub bar, current time readout, playback rate (0.25×-4×),
step ±0.1 s and ±1 frame at 29.97 fps, loop toggle, and jump to the previous/next cue start. The
**timeline** strip below draws every cue as a bar (lanes avoid overlap, open-ended live cues are
orange, active cues yellow); hover shows the text, click seeks.

**Source**: a dropdown with a built-in sample for every parser (VTT, SRT, SSA/ASS, TTML/IMSC, SCC,
LRC, SBV, SAMI, MicroDVD) and the live stream. The textarea is editable: **Apply** (or ⌘/Ctrl+Enter)
re-parses with `parseText(text, { type, errors: true })`; **Reset** restores the sample; **Open
file…** loads a local file with the type inferred from its name via `inferCaptionsFormat`;
**Download** saves the current text. If a parser throws (e.g., while a parser is still being
written), the error lands in the Errors tab instead of crashing. In live mode the textarea turns
into a rolling hex dump of the `cc_data` packets fed so far.

**Renderer options**:

- Stage: width, aspect, driving mode, and **Show layout boxes**, which outlines every cue display
  and region (from `getBoundingClientRect`) every frame.
- `CaptionsRenderer` init options (`stacking`, `lineStep`, `retention`, `announce`). Changing one
  recreates the renderer and re-attaches the current track. With `announce` on, the hidden
  `aria-live` region is observed and mirrored into the **Screen reader** box.
- Props: `dir`, `safeArea` (`--overlay-padding`), and **Reduced motion**, which sets
  `data-reduced-motion` on the overlay and, when the renderer exposes it, `renderer.reducedMotion`
  (feature-detected at runtime; the panel says which).
- Overlay styling: `data-edge-style` preset, `--cue-font-size` in cqh (3-8), `--cue-color`,
  `--cue-bg-color` (+ alpha), `--cue-edge-color`, and font family.
- `<media-captions>`: shadow DOM toggle (recreates the element with `shadow` and local `styles`).

**Inspector** tabs:

- **Active cues**: live JSON of `renderer.activeCues.map((c) => c.toJSON())`, one collapsible
  entry per cue (the first is open by default; your open/closed choices persist across updates).
- **All cues**: start, end, id, text preview for the whole track; click a row to seek. Active rows
  are highlighted; live tracks refresh as cues arrive.
- **Metadata**: header metadata, regions, `STYLE` blocks, and embedded fonts from the parse result.
- **Errors**: `ParseError`s with code names and lines, plus runtime errors (parser exceptions,
  `window.onerror`, unhandled rejections).
- **Events**: cue `enter`/`exit`, `cuechange` / `load` / `error` from the element, and
  `add`/`update`/`remove`/`clear` from the `CueTrack`, with a clear button.

**`<media-captions>` view**: the same source rendered through the custom element
(`defineMediaCaptionsElement()`, `el.load(result)`, `el.media = fakeMedia`) in its own stage, with
the shadow DOM toggle in the options panel.

**Gallery view**: every sample rendered at once in a grid of small stages at one global time
(each tile loops on its own sample length), so the whole matrix can be eyeballed in one screen.

## CEA-608/708 live stream

`samples/cea-live.ts` builds a 40-second `cc_data` schedule with the encoders in
`samples/cea-encode.ts`: CC1 pop-on captions (row PACs, mid-row colours, italics, underline) and a
three-row roll-up on the 608 side, and on the 708 side windows with per-run pen colours, a
translucent fill with a left-to-right wipe, a style-7 ticker, pen sizes/edges, and two windows
displayed at once. `ui/live-cea.ts` feeds packets to `CEA608Decoder` / `CEA708Decoder` in
`live: true` mode as the clock passes their timestamps, into a `CueTrack` the renderer follows, so
open-ended cues appear before their end time is known. Seeking backwards resets and replays.

## Keyboard

`space` play/pause · `←`/`→` ±0.1 s · `alt+←`/`→` ±1 frame · `shift+←`/`→` previous/next cue ·
`↑`/`↓` playback rate · `Home` start · `L` loop. Shortcuts are ignored while typing in the source.

## Screenshots

```bash
./node_modules/.bin/vp dev --port=3210 --host 127.0.0.1 &
node playground/screenshot.mjs          # writes playground/screenshots/*.png, exits 1 on console errors
```

## Checks

```bash
./node_modules/.bin/tsc --noEmit --strict --noImplicitAny false --target esnext --module esnext \
  --moduleResolution bundler --lib dom,dom.iterable,esnext --skipLibCheck playground/main.ts
./node_modules/.bin/vp fmt playground
./node_modules/.bin/vp lint playground
```
