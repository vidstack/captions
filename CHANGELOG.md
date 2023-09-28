# Changelog

# [1.0.0](https://github.com/vidstack/media-captions/compare/v0.0.18...v1.0.0) (2023-09-28)

### Bug Fixes

- rename `part` attribute to `data-part` ([e608998](https://github.com/vidstack/media-captions/commit/e608998b1e9eb22d26876ddcc0d547c9c9302caf))

### [0.0.18](https://github.com/vidstack/media-captions/compare/v0.0.17...v0.0.18) (2023-06-15)

### Bug Fixes

- avoid mangle collisions ([e5fff42](https://github.com/vidstack/media-captions/commit/e5fff4267ae509005ef9571008d77ce5f37e4ce3))

### [0.0.17](https://github.com/vidstack/media-captions/compare/v0.0.16...v0.0.17) (2023-06-14)

### Bug Fixes

- use mangle cache ([fe00c85](https://github.com/vidstack/media-captions/commit/fe00c8546d079def129662098b708d6bdd4f88d5))

### [0.0.16](https://github.com/vidstack/media-captions/compare/v0.0.15...v0.0.16) (2023-06-12)

### Bug Fixes

- use rollup for cleaner build output ([72b02be](https://github.com/vidstack/media-captions/commit/72b02be6ed89d4a6e59c9ed4fcc2e3baae9899ef))

### [0.0.15](https://github.com/vidstack/media-captions/compare/v0.0.14...v0.0.15) (2023-06-09)

### Bug Fixes

- clear starting boxes on resize update ([9a3cb80](https://github.com/vidstack/media-captions/commit/9a3cb805b59cb87791546c74b10356a0d75fadf6))

### [0.0.14](https://github.com/vidstack/media-captions/compare/v0.0.13...v0.0.14) (2023-06-09)

### Bug Fixes

- debounce resize updates ([5428cec](https://github.com/vidstack/media-captions/commit/5428cec9f051f97e0a5acc0ceb37cedb58aee83f))
- reduce resize debounce delay ([3a91714](https://github.com/vidstack/media-captions/commit/3a917144afb3cb32e8d7822e68bcd9ba62b4b4b5))
- sync updates ([f57aa66](https://github.com/vidstack/media-captions/commit/f57aa6673212a93434428534bbd073c69483f9e2))

### [0.0.13](https://github.com/vidstack/media-captions/compare/v0.0.12...v0.0.13) (2023-05-13)

### Bug Fixes

- only parse known properties on settings line ([58025f0](https://github.com/vidstack/media-captions/commit/58025f08df008cb23789f34a1d56b4abba754b71))

### [0.0.12](https://github.com/vidstack/media-captions/compare/v0.0.11...v0.0.12) (2023-05-08)

### Bug Fixes

- add required aria attrs on overlay element ([568677e](https://github.com/vidstack/media-captions/commit/568677e4e271ac599debb9a2dda2a9411a0ddea4))

### [0.0.11](https://github.com/vidstack/media-captions/compare/v0.0.10...v0.0.11) (2023-04-23)

### Bug Fixes

- parse ms with less than 3 digits correctly ([484123e](https://github.com/vidstack/media-captions/commit/484123e347f0aee263e0251e37af6871c54c13b4)), closes [#1](https://github.com/vidstack/media-captions/issues/1)

### [0.0.10](https://github.com/vidstack/media-captions/compare/v0.0.9...v0.0.10) (2023-04-16)

### Bug Fixes

- safely detect vtt settings line ([c6f088d](https://github.com/vidstack/media-captions/commit/c6f088d82df4c68e1c309155400ab07bd7662a55))

### [0.0.9](https://github.com/vidstack/media-captions/compare/v0.0.8...v0.0.9) (2023-04-14)

### Bug Fixes

- ssa/ass margin setting should be px not % ([9329761](https://github.com/vidstack/media-captions/commit/93297617a23533336bf5acd0df3cd01b0e836dc6))

### [0.0.8](https://github.com/vidstack/media-captions/compare/v0.0.7...v0.0.8) (2023-04-12)

### Bug Fixes

- position everything relative to container to avoid scroll issues ([91ded03](https://github.com/vidstack/media-captions/commit/91ded032fd00722d8f33e9e64d262796cfc80f5f))

### [0.0.7](https://github.com/vidstack/media-captions/compare/v0.0.6...v0.0.7) (2023-04-05)

### Bug Fixes

- correctly apply ass position and outline styling ([71c58ee](https://github.com/vidstack/media-captions/commit/71c58ee994e798e4f1e273b70ab8a8feaf339e03))
- extend native `VTTCue` otherwise browser will reject ([dc256a8](https://github.com/vidstack/media-captions/commit/dc256a8b5cf90919091a794288c18ed9c5b22c72))
- replace `\N` with line break in ass captions text ([a6f0517](https://github.com/vidstack/media-captions/commit/a6f051743426f7466b0e8abe14d10d896dfc2a71))

### [0.0.6](https://github.com/vidstack/media-captions/compare/v0.0.5...v0.0.6) (2023-03-30)

### Bug Fixes

- do not hold more than 100 cue dom nodes in memory ([1d57f58](https://github.com/vidstack/media-captions/commit/1d57f58d55495a0a18224440967cea5c5a103f68))
- position boxes using percentages to be responsive ([9e099fa](https://github.com/vidstack/media-captions/commit/9e099fa52b724d833e2126722bac7bb0bd908f50))

### [0.0.5](https://github.com/vidstack/media-captions/compare/v0.0.4...v0.0.5) (2023-03-29)

### Bug Fixes

- incorrect node export index paths -\_- ([fa00f56](https://github.com/vidstack/media-captions/commit/fa00f560fa14b3941f3c37925bdfe0431901c1c2))

### [0.0.4](https://github.com/vidstack/media-captions/compare/v0.0.3...v0.0.4) (2023-03-29)

### Bug Fixes

- add styles dir to package exports ([8aa056f](https://github.com/vidstack/media-captions/commit/8aa056ffe83ee085be3c013100da252dfbdae805))

### [0.0.3](https://github.com/vidstack/media-captions/compare/v0.0.2...v0.0.3) (2023-03-29)

### Bug Fixes

- include styles in package files ([ea8d600](https://github.com/vidstack/media-captions/commit/ea8d600742bf4bd5e13e960d0a597ee03d8b054b))

### 0.0.2 (2023-03-29)

### Features

- add `strict` and `errors` parsing options ([0df50ed](https://github.com/vidstack/media-captions/commit/0df50ed2fb2fe8ea160856fc6e537b6df6add854))
- add srt parser ([8df0cae](https://github.com/vidstack/media-captions/commit/8df0cae3301227b005cdea49ea10fb7e7ff5cf24))
- add ssa parser ([cd8c6c8](https://github.com/vidstack/media-captions/commit/cd8c6c8f685d37a69489e1362b687c91f934539b))
- add vtt cue renderer ([52d9c3e](https://github.com/vidstack/media-captions/commit/52d9c3ee3cfb27637b6d1d79908b2156e07a906f))
- add vtt cue tokenizer ([392e7d7](https://github.com/vidstack/media-captions/commit/392e7d7110b78dd4747029b7c4e7be0be7c3d35a))
- export `parseVTTTimestamp` function ([fcd0abf](https://github.com/vidstack/media-captions/commit/fcd0abfb99113af673143fb40cc4a504b63c7191))
- new `updateTimedVTTCueNodes` export ([9485c8d](https://github.com/vidstack/media-captions/commit/9485c8df13f6a36e0a8fd6ca501f1244909a62e6))
- overlay renderer ([cb17f7f](https://github.com/vidstack/media-captions/commit/cb17f7f9a4f31bccf4c923ab7070b6b99ff02906))
- vtt parser ([939bf2a](https://github.com/vidstack/media-captions/commit/939bf2a8085f003b6ccf4e81f2dd9dd254d45393))

### Bug Fixes

- `CaptionsOverlayRenderer` -> `CaptionsRenderer` ([e013da7](https://github.com/vidstack/media-captions/commit/e013da780498d81c1318f774bf0dabb67d914261))
- ignore cues that exceed region lines limit ([0e815ef](https://github.com/vidstack/media-captions/commit/0e815ef3e088e0ee583580b29f8064a63d86361a))
- rename captions renderer `setup` to `changeTrack` ([9a43831](https://github.com/vidstack/media-captions/commit/9a438318db1f7dd685475c1d066646ebbf72f21f))
