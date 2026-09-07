# Real-world corpus

Fixture files that imitate what popular tools and services actually emit (YouTube auto-captions,
ffmpeg SRT exports, Aegisub karaoke, Netflix IMSC1, EBU-TT-D, iTunes iTT, broadcast SCC, ...),
plus a few deliberately broken files. All fixtures are hand-written; none are copied from
copyrighted subtitles.

`corpus.test.ts` parses every fixture in non-strict mode and checks that:

- `parseText` does not throw (files that currently do are listed in `KNOWN_THROWS` and run as
  `test.fails` so the crash stays visible until it is fixed);
- the full result (`cueCount`, error messages, `cueToJSON` of every cue) matches the snapshot in
  `__snapshots__/<format>/<file>.json`;
- cue times are finite and ordered;
- `renderVTTCueString` output contains no executable markup.

A handful of fixtures additionally carry hand-written expectations for the feature they exist to
exercise (positioning, timestamp maps, drawings, drop-frame timecodes, ...).

## Adding a file

1. Drop the file under `files/<format>/` using the matching extension (`vtt`, `srt`, `ass`, `ssa`,
   `ttml`, `scc`, `lrc`, `sbv`). The directory name selects the parser. Keep it under ~150 lines
   and give it a name that says which tool or quirk it imitates (`whisper-output.srt`,
   `bom-crlf.vtt`).
2. Files with unusual bytes (BOM, CRLF, bare CR, wrong encoding) must be written byte-exact; do not
   run the formatter over `files/` (it is only ever run on the `.ts` files here).
3. Run the suite once to write the snapshot:

   ```sh
   export PATH=/opt/homebrew/bin:$PATH
   ./node_modules/.bin/vp test --run --project unit tests/corpus
   ```

4. Open the new `__snapshots__/<format>/<file>.json` and read it as if it were a code review: are
   the cue count, times, text and layout what a player should show? If not, the fixture has found
   a parser bug; record it in the test (or fix the parser) before committing the snapshot.
5. Optionally add a hand assertion in `corpus.test.ts` for the feature the file exercises.

## Reviewing snapshot diffs

A parser change that alters any fixture's result fails the corresponding snapshot test with a
JSON diff. Review the diff like any code change; when the new output is the intended behaviour,
update the snapshots:

```sh
./node_modules/.bin/vp test --run -u tests/corpus
```

and commit the regenerated `__snapshots__/**/*.json` alongside the parser change so the diff is
visible in the pull request.
