# Vendored web-platform-tests (WebVTT parsing)

Files under `webvtt/` are copied **unmodified** from the
[web-platform-tests](https://github.com/web-platform-tests/wpt) repository.

- Upstream: https://github.com/web-platform-tests/wpt
- Snapshot: `master` at commit `422734d7fd906113ab2e8a929e115bbcdfa5b341`
  (latest commit touching `webvtt/parsing` as of the snapshot), fetched on 2026-09-02.
- License: BSD 3-Clause, see [`LICENSE.md`](./LICENSE.md) (copied verbatim from the WPT root).

Vendored directories (relative layout preserved):

- `webvtt/parsing/file-parsing/tests/` — the HTML tests plus `support/*.vtt`.
  Do not edit `support/*.vtt`: upstream generates them (see the upstream
  `webvtt/parsing/file-parsing/README.md`), and several files rely on exact bytes
  (BOM, NUL, CR, form feed, vertical tab, missing trailing newline).
- `webvtt/parsing/cue-text-parsing/tests/` — the HTML tests. Inputs and expected
  html5lib tree dumps are URL-encoded inline; the upstream harness
  (`webvtt/parsing/cue-text-parsing/common.js`, not vendored) wraps each input as
  `WEBVTT\n\n00:00.000 --> 00:01.000\n<input>` and dumps `cue.getCueAsHTML()`.

Rendering tests are intentionally not vendored.

The HTML files are never executed here. `../convert.mjs` turns them into the JSON
fixtures in `../fixtures/`, which `../wpt.test.ts` runs against `media-captions`.
