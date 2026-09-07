# Vendored IMSC test suite documents

Files under `imsc1/` and `imsc1_1/` are copied **unmodified** from the
[W3C IMSC test suite](https://github.com/w3c/imsc-tests) repository.

- Upstream: https://github.com/w3c/imsc-tests
- Snapshot: `main` at commit `08f10c5d5c36ab1105202ed964aee8c4ae939ed5`
  (committed 2026-04-20), fetched on 2026-09-06.
- License: dual W3C Test Suite License / W3C 3-clause BSD License, see
  [`LICENSE.md`](./LICENSE.md) (copied verbatim from the repository root).

Vendored files (relative layout preserved):

- `imsc1/ttml/<feature>/*.ttml` — 55 IMSC 1 text profile documents covering timing (`par`/`seq`
  containers, time expressions, span timing), styling (colours, font size, outline, line height,
  opacity, style inheritance), regions (origin, extent, display alignment, padding, cell
  resolution, region timing, nested regions), animations (`<set>`), writing modes, forced
  display, aspect ratio, line breaks, whitespace and foreign namespaces.
- `imsc1_1/ttml/<feature>/*.ttml` — 7 IMSC 1.1 documents: `tts:position`, root-container
  relative lengths, ruby, text shadow, display aspect ratio and the image profile.
- `imsc1_1/ttml/image/image001-img.png` — the PNG referenced by `image001.ttml` (the only binary;
  the reference renderings under upstream `png/` are not vendored).

The reference renderings (`imsc1/png`, `imsc1_1/png`) are intentionally not vendored; the frame
times in their file names were used to derive the timing expectations in `../imsc.test.ts`.

`../imsc.test.ts` parses every document with `parseText(text, { type: 'ttml', errors: true })`.
Known parser gaps are recorded in `../KNOWN_ISSUES.md`.
