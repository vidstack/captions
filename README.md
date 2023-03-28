# Media Captions

[![package-badge]][package]
[![discord-badge]][discord]

Some introduction...

- 0 deps
- built with typescript
- modern apis (readablestream/fetch response)
- chunked streaming support + easy callback hooks
- 5kb modular + treeshabkel (parsing/render split) parsers are lazy loaded
- spec-compliant
- in-order rendering
- auto-collision detection to avoid overlaps or out of bounds
- easy styling via css and variables
- supports vtt,srt,ssa/ass
- flexible error tolerance (strict)
- VTT regions and roll up captions
- timed karaoke-style captions
- parser and renderer server-side support
- custom rendering via tokens
- ...?

⏭️ **[Skip to Examples](#examples)**

⏭️ **[Skip to Installation](#installation)**

⏭️ **[Skip to API](#api)**

## Motivation

Intro into why I built this?

**Are native captions good enough?**

no -> accessibility + customization + consistency + features (karaoke/regions)
custom rendering

**What about [mozilla/vtt](https://github.com/mozilla/vtt.js)?**

old and missing features

## Examples

- [HTML Video](https://stackblitz.com/edit/media-captions?embed=1&file=index.ts&hideExplorer=1&hideNavigation=1&view=editor)
- [React + Next.js](https://stackblitz.com/edit/media-captions-next?embed=1&file=index.ts&hideExplorer=1&hideNavigation=1&view=editor)
- [Custom Renderer (HTML)](https://stackblitz.com/edit/media-captions-custom-html-renderer?embed=1&file=index.ts&hideExplorer=1&hideNavigation=1&view=editor)
- [Custom Renderer (React)](https://stackblitz.com/edit/media-captions-custom-react-renderer?embed=1&file=index.ts&hideExplorer=1&hideNavigation=1&view=editor)

## Installation

First, install the NPM package:

```bash
npm i media-captions
```

Next, include styles if you plan on rendering captions:

```js
import 'media-captions/styles/captions.css';
// Optional - include if rendering VTT regions.
import 'media-captions/styles/regions.css';
```

Optionally, you can load the styles directly from a CDN using [JSDelivr](https://www.jsdelivr.com)
like so:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/media-captions/styles/captions.min.css" />
<!-- Optional - include if rendering VTT regions. -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/media-captions/styles/regions.min.css" />
```

## API

- **Parsing**
  - [Parse Options](#parse-options)
  - [Parse Result](#parse-result)
  - [Parse Errors](#parse-errors)
  - [`parseText`](#parsetext)
  - [`parseTextStream`](#parsetextstream)
  - [`parseResponse`](#parseresponse)
  - [`parseByteStream`](#parsebytestream)
  - [`CaptionsParser`](#captionsparser)
- **Rendering**
  - [`tokenizeVTTCue`](#tokenizevttcue)
  - [`createVTTCueTemplate`](#createvttcuetemplate)
  - [`renderVTTCueString`](#rendervttcuestring)
  - [`renderVTTTokensString`](#rendervtttokensstring)
  - [`updateTimedVTTCueNodes`](#updatetimedvttcuenodes)
  - [`CaptionsOverlayRenderer`](#captionsoverlayrenderer)
  - [Styling](#styling)
- **Formats**
  - [VTT](#vtt)
  - [SRT](#srt)
  - [SSA/ASS](#ssaass)
- **Usage**
  - [VTT Cue](#vtt-cue)
  - [VTT Region](#vtt-region)
  - [Types](#types)

## Parse Options

All parsing functions exported from this package accept the following options:

- `strict`: Whether strict mode is enabled. In strict mode parsing errors will throw and cancel
  the parsing process.
- `errors`: Whether errors should be collected and reported in the final
  [parser result](#parse-result). By default, this value will be true in dev mode or if `strict`
  mode is true. If set to true and `strict` mode is false, the `onError` callback will be invoked.
  Do note, setting this to true will dynamically load error builders which will slightly increase
  bundle size (~1kB).
- `type`: The type of the captions file format so the correct parser is loaded. Options
  include `vtt`, `srt`, `ssa`, `ass`, or a custom [`CaptionsParser`](#captionsparser) object.
- `onHeaderMetadata`: Callback that is invoked when the metadata from the header block has been
  parsed.
- `onCue`: Invoked when parsing a VTT cue block has finished parsing and a `VTTCue` has
  been created. Do note, regardless of which captions file format is provided a `VTTCue` will
  be created.
- `onRegion`: Invoked when parsing a VTT region block has finished and a `VTTRegion` has been
  created.
- `onError`: Invoked when a loading or parser error is encountered. Do note, this is only invoked
  in development, if the `strict` parsing option is true, or if the `errors` parsing option is
  true.

Options can be provided to any parsing function like so:

```ts
import { parseText } from 'media-captions';

parseText('...', {
  strict: false,
  type: 'vtt',
  onCue(cue) {
    // ...
  },
  onError(error) {
    // ...
  },
});
```

## Parse Result

All parsing functions exported from this package return a `Promise` which will resolve a
`ParsedCaptionsResult` object with the following properties:

- `metadata`: An object containing all metadata that was parsed from the header block.
- `regions`: An array containing `VTTRegion` objects that were parsed and created during the
  parsing process.
- `cues`: An array containing `VTTCue` objects that were parsed and created during the parsing
  process.
- `errors`: An array containing `ParseError` objects. Do note, errors will only be collected if
  in development mode, if `strict` parsing option is set to true, or the `errors` parsing option is
  set to true.

```ts
import { parseText } from 'media-captions';

// `ParsedCaptionsResult`
const { metadata, regions, cues, errors } = await parseText('...');

for (const cue of cues) {
  // ...
}
```

## Parse Errors

By default, parsing is error tolerant and will always try to recover. You can set strict mode
to ensure errors are not tolerated and are instead thrown. The text stream and parsing process
will also be cancelled.

```ts
import { parseText, type ParseError } from 'media-captions';

try {
  // Any error will now throw and cancel parsing.
  await parseText('...', { strict: true });
} catch (error: ParseError) {
  console.log(error.code, error.message, error.line);
}
```

A more tolerant error collection option is to set the `errors` parsing option to true. This
will ensure the `onError` callback is invoked and also errors are reported in the final
result (this will add ~1kB to the bundle size):

```ts
import { parseText } from 'media-captions';

const { errors } = await parseText('...', {
  errors: true, // Not required if you only want errors in dev mode.
  onError(error) {
    error; // `ParseError`
  },
});

for (const error of errors) {
  // ...
}
```

The `ParseError` contains a numeric error `code` that matches the following values:

```ts
const ParseErrorCode = {
  LoadFail: 0,
  BadSignature: 1,
  BadTimestamp: 2,
  BadSettingValue: 3,
  BadFormat: 4,
  UnknownSetting: 5,
};
```

The `ParseErrorCode` object can be imported from the package.

## `parseText`

This function accepts a text string as input to be parsed:

```ts
import { parseText } from 'media-captions';

const { cues } = await parseText('...');
```

## `parseTextStream`

This function accepts a text stream [`ReadableStream<string>`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream) as input to be parsed:

```ts
import { parseTextStream } from 'media-captions';

const stream = new ReadableStream<string>({
  start(controller) {
    controller.enqueue('...');
    controller.enqueue('...');
    controller.enqueue('...');
    // ...
    controller.close();
  },
});

// You can await the response.
parseTextStream(stream, {
  onCue(cue) {
    // ...
  },
});
```

## `parseResponse`

The `parseResponse` function accepts a [`Response`](https://developer.mozilla.org/en-US/docs/Web/API/Response) or `Promise<Response>` object. It can be seamlessly used with
[`fetch`](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API) to parse a response body stream like so:

```ts
import { ParseErrorCode, parseResponse } from 'media-captions';

// You can await the response.
parseResponse(fetch('/media/subs/english.vtt'), {
  onCue(cue) {
    // ...
  },
  onError(error) {
    if (error.code === ParseErrorCode.LoadFail) {
      console.log(error.message);
    }
  },
});
```

The captions type will inferred from the response header `content-type` field. You can specify
the specific captions format like so:

```ts
parseResponse(..., { type: 'vtt' });
```

The text encoding will be inferred from the response header and forwarded to the underlying
[`TextDecoder`](https://developer.mozilla.org/en-US/docs/Web/API/TextDecoder/TextDecoder). You
can specify a specific encoding like so:

```ts
parseResponse(..., { encoding: 'utf8' });
```

## `parseByteStream`

This function is used to parse byte streams `ReadableStream<Uint8Array>`. It's used by the
`parseResponse` function to parse response body streams. It can be used like so:

```ts
import { parseByteStream } from 'media-captions';

const byteStream = new ReadableStream<Uint8Array>({
  // ...
});

// You can await the response.
parseByteStream(byteStream, {
  encoding: 'utf8',
  onCue(cue) {
    // ...
  },
});
```

## `CaptionsParser`

You can create a custom caption parser and provide it to the `type` option on any parse function.
The parser can be created and provided like so:

```ts
import {
  type CaptionsParser,
  type CaptionsParserInit,
  type ParsedCaptionsResult,
} from 'media-captions';

class CustomCaptionsParser implements CaptionsParser {
  /**
   * Called when initializing the parser before the
   * parsing process begins.
   */
  init(init: CaptionsParserInit): void | Promise<void> {
    // ...
  }
  /**
   * Called when a new line of text has been read and
   * requires parsing. This includes empty lines which
   * can be used to separate caption blocks.
   */
  parse(line: string, lineCount: number): void {
    // ...
  }
  /**
   * Called when parsing has been cancelled, or has
   * naturally ended as there are no more lines of
   * text to be parsed.
   */
  done(cancelled: boolean): ParsedCaptionsResult {
    // ...
  }
}

// Custom parser can be provided to any parse function.
parseText('...', {
  type: () => new CustomCaptionsParser(),
});
```

## `tokenizeVTTCue`

...

## `createVTTCueTemplate`

...

## `renderVTTCueString`

...

## `renderVTTTokensString`

...

## `updateTimedVTTCueNodes`

...

## `CaptionsOverlayRenderer`

...

## Styling

...

## VTT

...

## SRT

...

## SSA/ASS

...
note what is supported:

...

note what's not supported:

Picture
Sound
Movie
Command
Text codes
fonts
graphics
layers

## VTT Cue

...

## VTT Region

...

## Types

Here's the types that are available from this package for use in TypeScript:

```ts
import type {
  CaptionsFileFormat,
  CaptionsParser,
  CaptionsParserInit,
  ParseByteStreamOptions,
  ParseCaptionsOptions,
  ParsedCaptionsResult,
  ParseError,
  ParseErrorCode,
  ParseErrorInit,
  TextCue,
  VTTCue,
  VTTHeaderMetadata,
  VTTRegion,
} from 'media-captions';
```

## 📝 License

Media Captions is [MIT licensed](./LICENSE).

[package]: https://www.npmjs.com/package/media-captions
[package-badge]: https://img.shields.io/npm/v/media-captions?style=flat-square
[discord]: https://discord.com/invite/7RGU7wvsu9
[discord-badge]: https://img.shields.io/discord/742612686679965696?color=%235865F2&label=%20&logo=discord&logoColor=white&style=flat-square
