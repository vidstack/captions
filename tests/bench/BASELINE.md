# Benchmark baseline

Recorded 2026-09-06 at commit `af43fe5` on an Apple M4 Max (14 cores, 36 GB), macOS 26.6.2,
Node v26.8.1, Vitest 4.1.11 (tinybench 2.9). Dev build (`__DEV__ = true`, parse errors
collected). Whole run: ~50 s wall clock.

Reproduce:

```sh
export PATH=/opt/homebrew/bin:$PATH
./node_modules/.bin/vp test bench --run --project unit
# equivalent: ./node_modules/.bin/vitest bench --run --project unit tests/bench
```

`--project unit` is required until the config edit below lands (see "Config"). Inputs are
generated deterministically in `inputs.ts` (seeded PRNG), so numbers are comparable run to run;
expect roughly +/-3% noise on the ms-scale rows and more on the sub-microsecond rows.

## parse.bench.ts

`parseText` (whole string) and `parseByteStream` (UTF-8 bytes in 64 KB chunks through
`TextLineTransformStream` into `parseTextStream`; `parseTextStream` itself consumes lines, so
this is the streaming path `parseResponse` uses).

| Input                               | Size    | parseText mean | ops/s | parseByteStream mean | ops/s |
| ----------------------------------- | ------- | -------------- | ----- | -------------------- | ----- |
| VTT 10,000 cues (settings + tags)   | 2180 KB | 12.85 ms       | 77.8  | 14.06 ms (35 chunks) | 71.1  |
| SRT 10,000 cues                     | 1400 KB | 15.73 ms       | 63.6  | 17.15 ms (22 chunks) | 58.3  |
| ASS 5,000 dialogue lines, 20 styles | 910 KB  | 23.35 ms       | 42.8  | 24.31 ms (15 chunks) | 41.1  |
| TTML 2,000 paragraphs with spans    | 659 KB  | 22.21 ms       | 45.0  | 22.15 ms (11 chunks) | 45.1  |
| SCC 2,000 lines (1,000 pop-on cues) | 218 KB  | 5.90 ms        | 169.6 | 5.93 ms (4 chunks)   | 168.6 |
| LRC 5,000 lines (half word-timed)   | 411 KB  | 6.73 ms        | 148.7 | 6.58 ms (7 chunks)   | 151.9 |

Per cue: VTT ~1.3 us, SRT ~1.6 us, ASS ~4.7 us/line, TTML ~11 us/paragraph (each paragraph has
three spans and a `<br/>`), SCC ~5.9 us/line, LRC ~1.3 us/line. Chunked byte streaming costs
under 10% over the whole-string path.

## tokenize.bench.ts (jsdom)

`tokenizeVTTCue` caches tokens per cue while `text`/`spans` are unchanged; the "miss" rows flip
the cue text between two variants on every call so the tokenizer really runs.

| Bench                                         | heavy markup (1533 ch) | plain text (137 ch) | 500 ch / 50 timestamps |
| --------------------------------------------- | ---------------------- | ------------------- | ---------------------- |
| `tokenizeVTTCue` (cache miss)                 | 24.3 us (41.2k/s)      | 1.07 us (931k/s)    | 15.4 us (64.9k/s)      |
| `tokenizeVTTCue` (cache hit)                  | 0.04 us (23.7M/s)      | -                   | -                      |
| `renderVTTCueString` (tokenize miss + render) | 49.6 us (20.2k/s)      | 1.17 us (855k/s)    | 45.8 us (21.8k/s)      |
| `renderVTTTokensString` (pre-tokenized)       | 21.9 us (45.7k/s)      | 0.12 us (8.3M/s)    | 30.1 us (33.2k/s)      |
| `renderVTTTokensDOM` (jsdom, pre-tokenized)   | 222 us (4.5k/s)        | 0.96 us (1.04M/s)   | 155 us (6.5k/s)        |

jsdom inflates the DOM row (its CSSOM parses every `style.setProperty`); treat it as relative,
not absolute.

## track.bench.ts

`CueTrack` with 50,000 cues (irregular durations, 1% long 60 s cues so `maxEnd` does real work).

| Bench                                                    | mean     | ops/s | per element         |
| -------------------------------------------------------- | -------- | ----- | ------------------- |
| construct from 50k sorted cues                           | 3.27 ms  | 306   | 65 ns/cue           |
| `add` 50k cues in sorted order                           | 180 ms   | 5.5   | 3.6 us/cue          |
| `add` 50k cues in random order                           | 1,405 ms | 0.71  | 28 us/cue           |
| `activeAt` x1000 random times                            | 40.2 us  | 24.9k | 40 ns/call          |
| `update` x1000 cues (end time nudged)                    | 85.1 ms  | 11.7  | 85 us/cue           |
| `evict` half the track (retention 60 s, incl. construct) | 84.7 ms  | 11.8  | ~3.3 us/evicted cue |

## layout.bench.ts

Pure `layoutItems` on a 1280x720 container; ~60% snap-to-lines / 40% percentage cues, 10%
vertical.

| Bench                                  | mean    | ops/s |
| -------------------------------------- | ------- | ----- |
| 10 cues                                | 0.62 us | 1.61M |
| 50 cues                                | 9.8 us  | 102k  |
| 200 cues                               | 48.8 us | 20.5k |
| 200 cues, 15% fixed                    | 41.4 us | 24.2k |
| 10 regions + 50 cues                   | 9.6 us  | 104k  |
| 50 identical `line:-1` cues (stacking) | 14.9 us | 67.0k |

Scaling is quadratic as expected (each item scans all previously placed boxes): 10 -> 50 -> 200
cues is 1x -> 16x -> 79x.

## cea.bench.ts

| Bench                                                                        | mean    | ops/s | throughput                       |
| ---------------------------------------------------------------------------- | ------- | ----- | -------------------------------- |
| CEA-708 `decodeCCData`: 10k pop-on packets (416,894 triplets), 1 packet/call | 23.5 ms | 42.6  | 17.8M triplets/s, 2.3 us/caption |
| CEA-708 `decodeCCData`: same stream, 1 triplet/call                          | 516 ms  | 1.94  | 0.81M triplets/s (22x slower)    |
| CEA-608 `decodePair`: 30 pairs/frame x 100,000 frames (3,000,000 pairs)      | 189 ms  | 5.3   | 15.9M pairs/s, 63 ns/pair        |

## Hot spots

1. `CueTrack.add` / `update` are O(n) per call (`src/vtt/cue-track.ts`). `add()` starts with
   `has(cue)`, an `Array.prototype.includes` scan over all cues, and `update()` uses `indexOf`; on
   top of that `_rebuildMaxEnd(lo)` recomputes the running maximum from the insertion point to the
   end of the array, and `splice` shifts the tail. Sorted appends therefore cost 55x the
   constructor path (which skips `has`), random inserts cost 430x, and bulk-adding a whole file via
   `add`/`addAll` instead of the constructor is quadratic. A `Set`/`WeakMap` membership index and a
   lazily rebuilt (or segment-tree) `maxEnd` would remove the linear terms.

2. CEA-708 `decodeCCData` commits on every call, not on every completed packet
   (`src/cea/cea708-decoder.ts`, `_commit()`). Each call ends by rendering every visible window
   (`renderWindow`) and building a `windowKey` string to detect changes, even when the call only
   appended one continuation triplet to a half-assembled packet. Delivering the same stream one
   triplet at a time, as a demuxer does, is 22x slower than one packet per call; committing only
   when `_finishPacket` ran (or a dirty flag was set) would make the two paths equivalent.

3. `tokenizeVTTCue` builds strings one character at a time (`src/vtt/tokenize-cue.ts`,
   `tokenize()`). The state machine reads `cue.text[i]` (allocating a one-character string) and
   grows `buffer += char` per character, and `closeNode` copies `[...stack, node]` for every end
   tag, so heavy markup costs ~16 ns/char (24 us for 1.5 KB) and is the larger half of
   `renderVTTCueString` on a cache miss. Tracking a slice start index and calling `slice()` at
   token boundaries would cut most of the allocations. Related: `renderVTTTokensDOM` calls
   `getVTTTokenAttributes`, which serialises a `style` string it then discards before re-applying
   the same styles property by property, so the DOM path does the style work twice per node.

## Config

Benchmarks are never picked up by `vp test` / `vp test --run`: the `unit` and `browser` projects
include `*.test.ts` only, and no `.bench.ts` file matches that glob (verified). However, in bench
mode Vitest's default `benchmark.include` (`**/*.{bench,benchmark}.?(c|m)[jt]s?(x)`) applies to
every project, so `vp test bench --run` without `--project unit` runs every bench file twice: once
in `unit` and once in `browser (chromium)`. The edit needed in `vite.config.ts` (not applied by
this change) is:

```ts
test: {
  globals: true,
  testTimeout: 5000,
  benchmark: { include: ['tests/bench/**/*.bench.ts'] },
  projects: [
    { extends: true, test: { name: 'unit', /* unchanged */ } },
    {
      extends: true,
      test: {
        name: 'browser',
        // Bench files are Node-only; `extends: true` merges arrays, so an empty `include` is
        // a no-op and the files must be excluded instead.
        benchmark: { exclude: ['tests/bench/**'] },
        /* unchanged */
      },
    },
  ],
},
```

Verified with a throwaway config that imported the root config and applied exactly this: only
`|unit|` ran. `benchmark: { include: [] }` on the browser project was tried first and did not
work because `mergeConfig` concatenates the arrays.
