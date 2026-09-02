# Known divergences from the WPT WebVTT parsing suite

Snapshot: WPT `master` @ `422734d7fd906113ab2e8a929e115bbcdfa5b341` (see `vendor/README.md`).

Counts (`wpt.test.ts`):

| Suite                          | WPT tests | Converted | Skipped | Fully passing | With divergences |
| ------------------------------ | --------- | --------- | ------- | ------------- | ---------------- |
| `file-parsing` (per HTML file) | 40        | 39        | 1       | 33            | 6                |
| `cue-text-parsing` (per entry) | 79        | 79        | 0       | 75            | 4                |
| **Total**                      | **119**   | **118**   | **1**   | **108**       | **10**           |

Every remaining divergence is a documented, deliberate tolerance (`T*` below). Diverging
assertions are excluded from the regular test and exercised by a `test.fails` sibling, so the
suite is green while the gap stays visible.

Mode rule: tests expecting zero cues run in strict mode (a thrown parse error counts as zero
cues); all other tests run in default mode. Strict mode follows the spec grammar exactly; default
mode adds the tolerances below for real-world files.

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
- Strict mode required two hour digits; the spec accepts one.
- Formerly T5: cues whose end is not after their start are now kept (and reported), as in browsers.
- Formerly T6: timestamp tags are no longer range-checked against the cue.
- Formerly T8: uppercase `&AMP;`-style names, `&not;`/`&notin;`, and legacy no-semicolon
  references now decode. The core bundle still ships only a Latin-1 subset of the named character
  reference table; the full HTML table (2,231 names) is an opt-in entry, `media-captions/entities`
  (`registerFullHTMLEntities()`), and is registered in the WPT run so the two `entities` tests
  (`&ClockwiseContourIntegral;`, `&nsubE;`) pass.

## Deliberate tolerances / deviations

### T1. Lenient timestamps in default mode

- Test: `timings, too short` (`cues.length` 8 vs 2, `cues[1].text`)
- Default mode accepts 1-2 fraction digits and missing fractions (`00:00:00.00`, `00:00:00.0`,
  `00:00:00`, `00:00.00`, `00:00.0`, `00:00`). Documented in `tests/conformance/vtt-file.test.ts`
  ("requires exactly ... in strict mode") and `TIMESTAMP_RE`. Strict mode rejects them, but
  strict aborts on the first invalid cue in this file so the spec expectation can not be run.
- Note: `STRICT_TIMESTAMP_RE` requires two or more hour digits, while the spec accepts
  `0:00:00.000` (`timings-too-short` `cues[0]`, `timings-too-long` `cues[0]` with `000:`). Not
  visible in this run (default mode) but strict mode is stricter than the spec there.

### T2. `align:middle` maps to `center`

- Test: `settings, align` (`cues[10].align` expected `end`, actual `center`)
- Pre-2013 draft keyword accepted in default mode only. Documented tolerance.

### T3. Bare percentages (`position:1`)

- Test: `settings, position` (`cues[11].position` expected `'auto'`, actual `1`)
- Default mode accepts percentages without `%` for `position`/`size` (and anchors, see B7).
  Documented tolerance; strict mode rejects.

### T4. Cue text lines containing `-->` are kept as text

- Test: `arrows` (`cues[0..3].text` expected `text0`, actual `text0\nfoo-->`)
- Spec: any line containing `-->` ends the cue and starts a new (here invalid) block. Our parser
  only splits on lines that look like a timing line (`TIMING_LINE_RE`). Documented in
  `tests/conformance/vtt-file.test.ts` (`a --> b` kept as text). Deliberate tolerance.

### T7. Mismatched end tags close through open ancestors

- Tests: `tree-building - 325c1e59...`, `92847ed2...`, `c0da62d1...`, `132f07c3...`
- `<ruby>test<rt><b>test</rt></ruby>test`: spec ignores `</rt>`/`</ruby>` while the current
  node is `<b>` (only the current node, plus the `</ruby>`-closes-`<rt>` special case, is
  considered), giving `<ruby>test<rt><b>testtest</b></rt></ruby>`. `closeNode` closes the nearest
  matching ancestor instead. Deliberate tolerance for unbalanced markup (`<b><i>x</b>`).
