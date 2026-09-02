# Known divergences from the WPT WebVTT parsing suite

Snapshot: WPT `master` @ `422734d7fd906113ab2e8a929e115bbcdfa5b341` (see `vendor/README.md`).

Counts (`wpt.test.ts`):

| Suite                          | WPT tests | Converted | Skipped | Fully passing | With divergences |
| ------------------------------ | --------- | --------- | ------- | ------------- | ---------------- |
| `file-parsing` (per HTML file) | 40        | 39        | 1       | 20            | 19               |
| `cue-text-parsing` (per entry) | 79        | 79        | 0       | 58            | 21               |
| **Total**                      | **119**   | **118**   | **1**   | **78**        | **40**           |

File-parsing assertions: 510 converted, 395 passing, 115 diverging. Skipped: `stylesheets.html`
(asserts `document.styleSheets.length`, a DOM-only check with no cue assertions).

Every diverging assertion is excluded from the regular test and exercised by a `test.fails`
sibling, so the suite is green while the gap stays visible: fixing a divergence flips the
`fails` test and points at the entry to delete here and in `wpt.test.ts`.

Mode rule: tests expecting zero cues run in strict mode (a thrown parse error counts as zero
cues); all other tests run in default mode. Strict mode aborts on the first error, so it can
not be used to neutralise the deliberate tolerances below on files that mix valid and invalid
cues. Where a default-mode divergence is caused by a documented tolerance it is tagged `T*`;
`B*` entries are parser bugs (no `src/` changes were made; see repros).

---

## Parser bugs

### B1. Timing line directly after the header is swallowed

- Tests: `header, space`, `header, tab`, `header, timings`, part of `nulls`
- Expected: `cues.length === 1`, cue `text`. Actual: `0` cues.
- Repro: `parseText('WEBVTT\n00:00:00.000 --> 00:00:01.000\ntext')` yields no cues
  (also `'WEBVTT\n \n00:00:00.000 --> ...'`, the header block continues through the
  whitespace-only line).
- Spec: "collect a WebVTT block" with the in-header flag stops at the first line containing
  `-->`, so the timing line starts a cue. `VTTParser.parse` keeps feeding such lines to
  `_parseHeader` until a blank line. Real-world impact: files missing the blank line after
  `WEBVTT` lose all cues up to the first blank line.
- Assessment: bug.

### B2. Whitespace around timestamps on the timing line

- Tests: `whitespace chars` (all 7 assertions), part of `nulls` (`cues[5]`)
- Expected: `cues.length === 3`. Actual: `0`.
- Repro: `parseText('WEBVTT\n\n  00:00:00.000 --> 00:00:01.000\ntext')` yields no cues.
  `TIMESTAMP_RE` is anchored and `_parseTimestamp` never trims the start timestamp.
- Also: the spec does not require whitespace after the end timestamp
  (`00:00:01.000�align:end` parses with the remainder as settings); we reject the cue.
- Also: `SPACE_RE = /[\s\t]+/` treats U+000B (vertical tab) as a separator; the spec's ASCII
  whitespace is TAB, LF, FF, CR, SPACE only, so the `vertical tab` cue in `whitespace-chars.vtt`
  must be rejected. Once the leading-whitespace bug is fixed this will surface as a 4th cue.
- Assessment: bug (indented timing lines are common in hand-written files).

### B3. Settings with an empty value are applied instead of skipped

- Tests: `header-regions` `cues[8].region`, `settings, region` `cues[5..7].region`,
  `regions, id` `cues[2].region.lines`
- Expected: `region:` / `region: foo` / `region: ` leave `cue.region === null`; `id:` leaves the
  region id untouched. Actual: `region:` binds to a region whose `id` is `''` (a REGION block
  that never set an id), `id:` sets the region id to `''`.
- Repro: `parseText('WEBVTT\n\nREGION\nwidth:10%\n\n00:00:00.000 --> 00:00:01.000 region:\ntext')`
  gives `cues[0].region.id === ''` (expected `null`).
  `parseText('WEBVTT\n\nREGION\nid:foo\nid:\n\n...')` gives `regions[0].id === ''` (expected `foo`).
- Spec: a setting whose first `:` is the first or last character is skipped
  (cue settings and region settings parsing). `_parseCueSettings`/`_parseRegionSettings` split on
  `[:=]` and accept an empty value. Regions without an id should also never be referenceable.
- Assessment: bug.

### B4. Loose numeric parsing of setting values

- Tests: `settings, line` (`cues[2,19,21-25,27,30-35]`), `settings, position` (`cues[12,13]`),
  `settings, size` (`cues[11,12]`)
- `parseFloat` prefix semantics accept trailing/embedded garbage and exponents; the spec
  requires digits, optional single `.` between digits, optional `%`, and `-` only as first char
  of an integer line. Observed (expected `'auto'` / default unless noted):
  - `line:1e2` -> `100`; `line:1%-` -> `1`; `line:%1` -> `1`; `line:1%%` -> `1`; `line:0%0` -> `0`;
    `line:0%x` -> `0`; `line:1..5` -> `1`; `line:.5` -> `0.5`; `line:5.` -> `5`; `line:1-` -> `1`
  - `line:-0%` -> `-0` with `snapToLines=false` (sign not allowed in a percentage)
  - `line:-0` -> `-0` (spec: integers have no negative zero, expected `+0`; WPT `assert_equals`
    is SameValue)
  - `line:17976931348623159...` (above `Number.MAX_VALUE`) -> `Infinity` (HTML float parsing
    rules return an error -> setting ignored)
  - `position:1x` -> `1`, `position:1%x` -> `1`, `size:1%%` -> `1`, `size:1%x` -> `1`
- Repro: `parseText('WEBVTT\n\n00:00:00.000 --> 00:00:01.000 line:1e2\ntext')` gives `line === 100`.
- Assessment: bug (`toFloat`/`toPercentage` in `src/utils/unit.ts` should validate the whole
  token). Bare `position:1` (no `%`) is a separate deliberate tolerance, see T3.

### B5. Compound `line`/`position` settings are not atomic

- Tests: `settings, line` (`cues[36,37,46]`), `settings, position` (`cues[8,9,19-24]`)
- Expected: an invalid alignment component invalidates the whole setting (`line:100%,middle`,
  `line:100%,`, `line:100%,startend`, `position:1%,middle`, `position:1%,`,
  `position:1%,line-leftcenter` -> `'auto'`), and an invalid position leaves `positionAlign`
  untouched (`position:101%,center` -> `positionAlign === 'auto'`).
- Actual: `line`/`position` are assigned before the alignment is validated (`100`, `1`), and
  `positionAlign` is assigned although the position failed (`'center'`).
- Also: `position:1%,auto` is accepted (`POS_ALIGN_RE` includes `auto`); `auto` is not a valid
  file-format keyword, WPT expects `'auto'` for `position` (setting ignored).
- Repro: `parseText('WEBVTT\n\n00:00:00.000 --> 00:00:01.000 line:100%,middle\ntext')` gives
  `line === 100`, `snapToLines === false` (expected `'auto'`, `true`).
- Assessment: bug.

### B6. Region `lines` accepts non-digit values

- Tests: `regions, lines` (`cues[7..9].region.lines`)
- Expected: `lines:-0`, `lines:1.5`, `lines:-1` are ignored (default `3`). Actual: `-0`, `1`, `-1`.
- Repro: `parseText('WEBVTT\n\nREGION\nid:r\nlines:1.5\n\n...')` gives `regions[0].lines === 1`.
- Spec: the value must consist of ASCII digits only. `toNumber` uses `parseInt`.
- Assessment: bug.

### B7. Region anchors accept bare numbers and `-0%`

- Tests: `regions, regionanchor` / `regions, viewportanchor` (`cues[6,7,8,13,14,19]`)
- Expected: `regionanchor:0,0`, `0%,0`, `0,0%`, `100%,100` (no `%` on a coordinate) and
  `-0%,0%` / `0%,-0%` are ignored (defaults `0,100`). Actual: applied (`0,0`, `100,100`,
  `-0`).
- Repro: `parseText('WEBVTT\n\nREGION\nid:r\nregionanchor:0,0\n\n...')` gives
  `regionAnchorY === 0` (expected `100`), even with `{ strict: true }`.
- Assessment: in default mode this matches the bare-percentage tolerance (T3), but `toCoords`
  calls the non-strict `toPercentage` directly so strict mode does not enforce `%` either
  (unlike `width`, `position`, `size`), and `-0%` passes the `num >= 0` check. Bug in strict mode
  and for the sign; tolerance otherwise.

### B8. A `-->` line inside a REGION block does not abort the block

- Test: `multiple regions edge cases` (`cues[2].region.lines`)
- Expected: `REGION\n--->\nid:jill lines:4` is discarded (the `-->` line is treated as a failed
  timing line and the block yields nothing), so the earlier `jill` region keeps `lines:3`.
  Actual: `lines === 4`.
- Repro: `parseText('WEBVTT\n\nREGION\nid:jill\nlines:3\n\nREGION\n--->\nid:jill lines:4\n\n00:00:00.000 --> 00:00:01.000 region:jill\ntext')`
  gives `cues[0].region.lines === 4`.
- Assessment: bug (edge case, low impact).

### B9. NUL is not replaced with U+FFFD

- Tests: `nulls` (ids/text), cue text `text - 6805ac5d...` (`foo\0bar`)
- Expected: every U+0000 in the input becomes U+FFFD before parsing (`"� (null in id)"`,
  `"�text�2"`, `foo�bar`). Actual: NUL kept verbatim.
- Repro: `parseText('WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nfoo\0bar')` gives
  `cues[0].text === 'foo\0bar'`.
- Assessment: bug (spec step 2 of the WebVTT parser; also hygiene for downstream consumers).

### B10. Pending start tag / timestamp tag at end of cue text is dropped

- Tests: `entities - b1fff1ac...` (`&<c`), `timestamps - 47fa4306...` (`<00:00.500`),
  `timestamps - c1036a43...` (`<00:00:00.500`)
- Expected: `&<c` -> `"&"` + `<span>`; `<00:00.500` -> `<?timestamp 00:00:00.500>`.
  Actual: the trailing tag is discarded (`<c.` at EOF *does* produce a span, so the behaviour is
  inconsistent).
- Repro: `tokenizeVTTCue(new VTTCue(0, 1, '<c'))` returns `[]`.
- Spec: the cue text tokenizer emits the pending start tag / timestamp tag on EOF.
- Assessment: bug (minor).

### B11. `<rt>` outside `<ruby>` creates a node

- Test: `tags - 68e1d037...` (`<rt>test`)
- Expected: `"test"` (the start tag is ignored unless the current node is a ruby). Actual: `<rt>test</rt>`.
- Repro: `tokenizeVTTCue(new VTTCue(0, 1, '<rt>test'))` returns an `rt` node.
- Assessment: bug (minor).

### B12. End tag names are trimmed

- Test: `tags - fe3b6277...` (`<c></\nc>x`)
- Expected: `<span>x</span>` (end tag name is `\nc`, no match, ignored). Actual: `<span></span>x`
  because `closeNode(buffer.trim())` matches `c`.
- Assessment: bug (nit); could be argued as a tolerance for `</c >`.

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

### T5. Cues with `endTime <= startTime` are dropped

- Test: `timings, negative` (all 13 assertions; expected 4 cues, actual 0)
- Spec: cue timings are not compared; browsers keep such cues (they are simply never active).
  `_parseTimestamp` rejects them with `_badRangeTimestamp`. Deliberate parser policy; harmless
  for display, but `cues.length` and cue metadata diverge from browsers. Consider keeping them
  (reporting the error) in default mode.

### T6. Timestamp tags outside the cue's time range are dropped

- Tests: `timestamps - 66ba641f...`, `398e8da1...`, `391fce67...` (`test<01:00:00.000>test` in a
  0-1s cue expects `<?timestamp 01:00:00.000>`)
- Spec: the cue text parser does not range-check timestamps. Documented in
  `tests/conformance/vtt-cue-text.test.ts` ("timestamps outside the cue range are ignored").
  Deliberate deviation.

### T7. Mismatched end tags close through open ancestors

- Tests: `tree-building - 325c1e59...`, `92847ed2...`, `c0da62d1...`, `132f07c3...`
- `<ruby>test<rt><b>test</rt></ruby>test`: spec ignores `</rt>`/`</ruby>` while the current
  node is `<b>` (only the current node, plus the `</ruby>`-closes-`<rt>` special case, is
  considered), giving `<ruby>test<rt><b>testtest</b></rt></ruby>`. `closeNode` closes the nearest
  matching ancestor instead. Deliberate tolerance for unbalanced markup (`<b><i>x</b>`).

### T8. Limited named character reference table

- Tests: `entities - f1869f6e...` (`&amp` without `;`), `261cd4e9...` (`&AMP;`),
  `e3ac2060...` (`&ClockwiseContourIntegral;`), `31c8a5ec...` (`&nsubE;`), `9ed59950...`
  (`&notin;`), `71a6efcf...` (`&not;`), `86d7c20c...` (`&not`), `314cd942...` (`&notit;` ->
  `¬it;`)
- Spec: the full HTML named character reference table, including legacy references that do not
  require a trailing `;`. `HTML_ENTITIES` in `src/vtt/tokenize-cue.ts` covers ~40 names and
  requires `;`. Deliberate size trade-off for a zero-dependency library; `&not;`/`&notin;` and
  the legacy no-semicolon set for the names already supported would be cheap additions.
