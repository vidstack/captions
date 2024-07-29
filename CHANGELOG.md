# Changelog

All notable changes to this project will be documented in this file.

## [1.0.4@next](https://github.com/vidstack/captions/releases/tag/v1.0.4@next) (2024-07-29)

### 🐛 Bug Fixes

- Add main field to package.json

## [1.0.3@next](https://github.com/vidstack/captions/releases/tag/v1.0.3@next) (2024-03-16)

### 🐛 Bug Fixes

- Webpack parse error in regions anchor calc
- Add `jsdelivr` key to package

## [1.0.1@next](https://github.com/vidstack/captions/releases/tag/v1.0.1@next) (2023-11-19)

### 🐛 Bug Fixes

- Ensure default bundles are ssr-friendly

## [1.0@next](https://github.com/vidstack/captions/releases/tag/v1.0@next) (2023-09-28)

### 🐛 Bug Fixes

- Rename `part` attribute to `data-part`

## [0.0.18](https://github.com/vidstack/captions/releases/tag/v0.0.18) (2023-06-15)

### 🐛 Bug Fixes

- Avoid mangle collisions

## [0.0.17](https://github.com/vidstack/captions/releases/tag/v0.0.17) (2023-06-14)

### 🐛 Bug Fixes

- Use mangle cache

## [0.0.16](https://github.com/vidstack/captions/releases/tag/v0.0.16) (2023-06-12)

### 🐛 Bug Fixes

- Use rollup for cleaner build output

## [0.0.15](https://github.com/vidstack/captions/releases/tag/v0.0.15) (2023-06-09)

### 🐛 Bug Fixes

- Clear starting boxes on resize update

## [0.0.14](https://github.com/vidstack/captions/releases/tag/v0.0.14) (2023-06-09)

### 🐛 Bug Fixes

- Debounce resize updates
- Sync updates
- Reduce resize debounce delay

## [0.0.13](https://github.com/vidstack/captions/releases/tag/v0.0.13) (2023-05-13)

### 🐛 Bug Fixes

- Only parse known properties on settings line

## [0.0.12](https://github.com/vidstack/captions/releases/tag/v0.0.12) (2023-05-08)

### 🐛 Bug Fixes

- Add required aria attrs on overlay element

## [0.0.11](https://github.com/vidstack/captions/releases/tag/v0.0.11) (2023-04-23)

### 🐛 Bug Fixes

- Parse ms with less than 3 digits correctly

## [0.0.10](https://github.com/vidstack/captions/releases/tag/v0.0.10) (2023-04-16)

### 🐛 Bug Fixes

- Safely detect vtt settings line

## [0.0.9](https://github.com/vidstack/captions/releases/tag/v0.0.9) (2023-04-14)

### 🐛 Bug Fixes

- Ssa/ass margin setting should be px not %

## [0.0.8](https://github.com/vidstack/captions/releases/tag/v0.0.8) (2023-04-12)

### 🐛 Bug Fixes

- Position everything relative to container to avoid scroll issues

## [0.0.7](https://github.com/vidstack/captions/releases/tag/v0.0.7) (2023-04-05)

### 🐛 Bug Fixes

- Extend native `VTTCue` otherwise browser will reject
- Replace `\N` with line break in ass captions text
- Correctly apply ass position and outline styling

## [0.0.6](https://github.com/vidstack/captions/releases/tag/v0.0.6) (2023-03-30)

### 🐛 Bug Fixes

- Do not hold more than 100 cue dom nodes in memory
- Position boxes using percentages to be responsive

## [0.0.5](https://github.com/vidstack/captions/releases/tag/v0.0.5) (2023-03-29)

### 🐛 Bug Fixes

- Incorrect node export index paths -\_-

## [0.0.4](https://github.com/vidstack/captions/releases/tag/v0.0.4) (2023-03-29)

### 🐛 Bug Fixes

- Add styles dir to package exports

## [0.0.3](https://github.com/vidstack/captions/releases/tag/v0.0.3) (2023-03-29)

### 🐛 Bug Fixes

- Include styles in package files

## [0.0.2](https://github.com/vidstack/captions/releases/tag/v0.0.2) (2023-03-29)

### ✨ Features

- Vtt parser
- Add vtt cue tokenizer
- Add vtt cue renderer
- Export `parseVTTTimestamp` function
- New `updateTimedVTTCueNodes` export
- Overlay renderer
- Add `strict` and `errors` parsing options
- Add srt parser
- Add ssa parser

### 🐛 Bug Fixes

- Ignore cues that exceed region lines limit
- Rename captions renderer `setup` to `changeTrack`
- `CaptionsOverlayRenderer` -> `CaptionsRenderer`
