# Known issues against the IMSC test suite slice

Snapshot: `w3c/imsc-tests` `main` @ `08f10c5d5c36ab1105202ed964aee8c4ae939ed5` (see
`vendor/README.md`).

Counts (`imsc.test.ts`):

| Suite          | Documents | Parse cleanly | With allowed errors | No cues (documented) |
| -------------- | --------- | ------------- | ------------------- | -------------------- |
| `imsc1/ttml`   | 55        | 53            | 2                   | 0                    |
| `imsc1_1/ttml` | 7         | 6             | 1                   | 1                    |
| **Total**      | **62**    | **59**        | **3**               | **1**                |

Every document parses without throwing. The three documents that report an error and the one that
yields no cue are listed below with the reason; `imsc.test.ts` pins them so any change flips a test.

## Allowed errors (`K*`)

- **K1 — untimed documents** (`ParseErrorCode.BadTimestamp`, one per paragraph). Nothing in the
  document carries `begin`/`end`/`dur`, so the paragraph is indefinite (shown for the whole
  presentation). We have no media duration to end it with, so the cue gets the default 10 s
  duration and the missing end is reported:
  - `imsc1/ttml/misc/unicode-non-bmp-character.ttml`
  - `imsc1/ttml/region/nested-region-001.ttml`
  - `imsc1_1/ttml/textShadow/textShadow001.ttml`
- **K2 — external image source** (`imsc1_1/ttml/image/image001.ttml`): the `<image>` element
  references `image001-img.png` by relative URL. Only embedded images (`#id`, inline base64 or
  `data:` URLs) are resolved; external files are never fetched, so the document yields no cue and
  no error. `imsc.test.ts` also parses the same document with the vendored PNG inlined as a data
  URL and checks the resulting image cue.

## Limitations (no error reported)

Features the vendored documents exercise that the WebVTT cue model does not carry. They parse
cleanly but the property is dropped:

- **L1** `tts:lineHeight` on a `span` (`imsc1/ttml/lineHeight/lineheight-001.ttml`): only paragraph
  line height maps to `textStyle.lineHeight`; `CueSpanStyle` has no line height.
- **L2** `tts:rubyPosition` (`imsc1_1/ttml/ruby/ruby002.ttml`): both ruby texts become `<rt>`; the
  `before`/`after` placement is left to the renderer's default.
- **L3** non-palette `tts:backgroundColor` / `tts:color` on paragraphs and containers
  (`imsc1/ttml/backgroundColor/BackgroundColor001.ttml`, `imsc1/ttml/styling/Styling001.ttml`):
  paragraph-level colours only map to WebVTT `<c.COLOR>` classes for the eight palette colours.
  Span-level colours that differ from the paragraph's are carried in `cue.spans`.
- **L4** `tts:direction`, `tts:unicodeBidi`, `tts:wrapOption`, `tts:showBackground`,
  `tts:overflow` and region `tts:backgroundColor` (`imsc1/ttml/writingMode/WritingMode003.ttml`,
  `imsc1/ttml/animation/Animation016.ttml`, ...): not modelled; text direction follows the
  Unicode bidi algorithm in the renderer.
- **L5** `tts:textOutline` blur radius: CSS text stroke has no blur, only the thickness and colour
  are kept.

## Parser bugs found and fixed by this suite

All of the following were bugs when the suite was first vendored and are now fixed and covered by
`tests/ttml/containers.test.ts` / `tests/ttml/styling.test.ts`:

- B1 `timeContainer="seq"` was ignored: children were timed in parallel instead of in sequence
  (`MediaSeqTiming001`, `MediaSeqTiming002`, `TimeExpressions001`, every `Animation*` document).
- B2 `end`/`dur` on spans were ignored: the span stayed visible for the whole paragraph
  (`BasicTimeContainment001`, `BasicTimeContainment002`).
- B3 a paragraph without `end`/`dur` did not take the implicit end of its timed spans and reported
  a missing end instead (`four-active-regions-001`, `mutiple-regions-sequence-001`,
  `timing-on-span-001`).
- B4 `begin`/`end` on regions were ignored (`region-timing`).
- B5 `region` on spans was ignored: the whole paragraph rendered as one cue in the paragraph's
  region (`nested-region-001`).
- B6 `tts:display="none"` was ignored (`Animation003`).
- B7 `tts:position` (TTML2/IMSC 1.1) was ignored, leaving every region at the origin
  (`position001`, `ruby001`, `ruby002`).
- B8 `rw`/`rh` lengths were rejected (`lengthRootContainerRelative001`).
- B9 whitespace between ruby container children was emitted as text (`ruby001`, `ruby002`).
