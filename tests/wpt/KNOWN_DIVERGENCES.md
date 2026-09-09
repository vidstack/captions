# WPT WebVTT parsing suite: status and history

Snapshot: WPT `master` @ `422734d7fd906113ab2e8a929e115bbcdfa5b341` (see `vendor/README.md`).

Counts (`wpt.test.ts`):

| Suite                          | WPT tests | Converted | Skipped | Fully passing | With divergences |
| ------------------------------ | --------- | --------- | ------- | ------------- | ---------------- |
| `file-parsing` (per HTML file) | 40        | 39        | 1       | 39            | 0                |
| `cue-text-parsing` (per entry) | 79        | 79        | 0       | 79            | 0                |
| **Total**                      | **119**   | **118**   | **1**   | **118**       | **0**            |

The one skipped file (`stylesheets.html`) needs a CSSOM to compare `STYLE` blocks against.

Mode: every test parses with `lenient: false`, the spec grammar with the recovery browsers have
(invalid cues are dropped and reported, never thrown). The default lenient mode keeps the
real-world tolerances listed below; they are covered by `tests/conformance/vtt-file.test.ts`
(marked TOLERANT) instead of the WPT run. Should a divergence reappear, `wpt.test.ts` has tables
that exclude the affected assertions from the regular test and pin them with a `test.fails`
sibling, so the suite stays green while the gap stays visible.

## Lenient-mode tolerances (off with `lenient: false` or `strict`)

- **T1. Short timestamps**: 1-2 fraction digits or none (`00:00:00.00`, `00:00`), and `,` as the
  millisecond separator. Strict mode and `lenient: false` require the spec grammar; the spec also
  accepts a single hour digit (`0:00:00.000`), and so do we.
- **T2. `align:middle`** (pre-2013 drafts) maps to `center`.
- **T3. Bare percentages** (`position:1`, `regionanchor:0,0`) are accepted without `%`.
- **T4. `-->` in cue text**: a text line containing `-->` that does not look like a timing line
  (`a --> b`) is kept as text; the spec ends the cue at any `-->` line.
- **Missing signature**: reported, then parsing continues; the spec gives up on the file.

## Fixed parser bugs (found by this suite)

All of the following were bugs when the suite was first vendored and are now fixed and covered by
`tests/conformance/vtt-file.test.ts` / `vtt-cue-text.test.ts`:

- B1 timing line directly after the header was swallowed by the header block.
- B2 leading whitespace before timestamps rejected the cue; U+000B counted as whitespace; text
  glued to a complete end timestamp rejected the cue instead of being settings.
- B3 settings with an empty value (`region:`, `id:`) were applied instead of skipped.
- B4 loose numeric parsing (`1e2`, `1%-`, `.5`, `-0%`, `1%%`) via `parseFloat` prefix semantics.
- B5 compound `line`/`position` settings were not atomic; `auto` accepted as a position alignment.
- B6 region `lines` accepted `-0`, `1.5`, `-1`.
- B7 region anchors ignored strict mode and accepted `-0%`.
- B8 a `-->` line inside a REGION block did not discard the region.
- B9 NUL was not replaced with U+FFFD.
- B10 a pending start tag or timestamp tag at end of cue text was dropped.
- B11 `<rt>` outside `<ruby>` created a node.
- B12 end tag names were trimmed.
- B13 (formerly T7) a mismatched end tag closed through open ancestors
  (`<ruby>test<rt><b>test</rt></ruby>test`); the spec only closes the current node, plus `<rt>`
  on `</ruby>`, and ignores everything else. `<b><i>x</b> y` therefore keeps ` y` bold italic,
  as browsers render it.
- Strict mode required two hour digits; the spec accepts one.
- Formerly T5: cues whose end is not after their start are now kept (and reported), as in browsers.
- Formerly T6: timestamp tags are no longer range-checked against the cue.
- Formerly T8: uppercase `&AMP;`-style names, `&not;`/`&notin;`, and legacy no-semicolon
  references now decode. The core bundle still ships only a Latin-1 subset of the named character
  reference table; the full HTML table (2,231 names) is an opt-in entry, `media-captions/entities`
  (`registerFullHTMLEntities()`), and is registered in the WPT run so the two `entities` tests
  (`&ClockwiseContourIntegral;`, `&nsubE;`) pass.
- The WPT run itself used to fall back to `strict` for zero-cue tests and default mode otherwise,
  which left the T1-T4 tolerances as documented divergences; `lenient: false` removed the need.
