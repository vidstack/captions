# Media Captions

[![package-badge]][package]
[![discord-badge]][discord]

Some introduction...

**Features**

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

**Examples**

- [HTML Video](https://stackblitz.com/edit/media-captions?embed=1&file=index.ts&hideExplorer=1&hideNavigation=1&view=editor)
- [React + Next.js](https://stackblitz.com/edit/media-captions-next?embed=1&file=index.ts&hideExplorer=1&hideNavigation=1&view=editor)

⏭️ **[Skip to Installation](#installation)**

⏭️ **[Skip to API](#api)**

## Motivation

Intro into why I built this?

**Are native captions good enough?**

no -> accessibility + customization + consistency + features (karaoke/regions)
custom rendering

**What about [mozilla/vtt](https://github.com/mozilla/vtt.js)?**

old and missing features

## Installation

First, install the NPM package:

```bash
npm i media-captions
```

Next, include styles if you plan on rendering captions using the [`CaptionsOverlayRenderer`](#captionsoverlayrenderer):

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
  - [`createVTTCueTemplate`](#createvttcuetemplate)
  - [`renderVTTCueString`](#rendervttcuestring)
  - [`tokenizeVTTCue`](#tokenizevttcue)
  - [`renderVTTTokensString`](#rendervtttokensstring)
  - [`updateTimedVTTCueNodes`](#updatetimedvttcuenodes)
  - [`CaptionsOverlayRenderer`](#captionsoverlayrenderer)
  - [Styling](#styling)
- **Formats**
  - [VTT](#vtt)
  - [SRT](#srt)
  - [SSA/ASS](#ssaass)
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

// You can await the parse result.
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

// You can await the parse result.
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

// You can await the parse result.
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

## `createVTTCueTemplate`

This function takes a `VTTCue` and renders the cue text string into a HTML template element
and returns a `VTTCueTemplate`. The template can be used to efficiently store and clone
the rendered cue HTML like so:

```ts
import { createVTTCueTemplate, VTTCue } from 'media-captions';

const cue = new VTTCue(0, 10, '<v Joe>Hello world!');
const template = createVTTCueTemplate(cue);

template.cue; // original `VTTCue`
template.content; // `DocumentFragment`

// <span title="Joe" part="voice">Hello world!</span>
const cueHTML = template.content.cloneNode(true);
```

## `renderVTTCueString`

This function takes a `VTTCue` and renders the cue text string into a HTML string. This
function can be used server-side to render cue content like so:

```ts
import { renderVTTCueString, VTTCue } from 'media-captions';

const cue = new VTTCue(0, 10, '<v Joe>Hello world!');

// Output: <span title="Joe" part="voice">Hello world!</span>
const content = renderVTTCueString(cue);
```

The second argument accepts the current playback time to add the correct `data-past` and
`data-future` attributes to timed text (i.e., karaoke-style captions):

```ts
const cue = new VTTCue(0, 320, 'Hello my name is <5:20>Joe!');

// Output: Hello my name is <span part="timed" data-time="80" data-future>Joe!</span>
renderVTTCueString(cue, 310);

// Output: Hello my name is <span part="timed" data-time="80" data-past>Joe!</span>
renderVTTCueString(cue, 321);
```

## `tokenizeVTTCue`

This function takes a `VTTCue` and returns a collection of VTT tokens based on the cue
text. Tokens represent the render nodes for a cue:

```ts
import { tokenizeVTTCue, VTTCue } from 'media-captions';

const cue = new VTTCue(0, 10, '<b.foo.bar><v Joe>Hello world!');

const tokens = tokenizeVTTCue(cue);

// `tokens` output:
[
  {
    tagName: 'b',
    type: 'b',
    class: 'foo bar',
    children: [
      {
        tagName: 'span',
        type: 'v',
        voice: 'Joe',
        children: [{ type: 'text', data: 'Hello world!' }],
      },
    ],
  },
];
```

Nodes can be a `VTTBlockNode` which can have children (i.e., class, italic, bold, underline,
ruby, ruby text, voice, lang, timestamp) or a `VTTLeafNode` (i.e., text nodes). The tokens
can be used for custom rendering like so:

```ts
function renderTokens(tokens: VTTNode[]) {
  for (const token of tokens) {
    if (token.type === 'text') {
      // Process text nodes here...
      token.data;
    } else {
      // Process block nodes here...
      token.tagName;
      token.class;
      token.type === 'v' && token.voice;
      token.type === 'lang' && token.lang;
      token.type === 'timestamp' && token.time;
      token.color;
      token.bgColor;
      renderTokens(tokens.children);
    }
  }
}
```

All token types are listed below for use in TypeScript:

```ts
import type {
  VTTBlock,
  VTTBlockNode,
  VTTBlockType,
  VTTBoldNode,
  VTTClassNode,
  VTTextNode,
  VTTItalicNode,
  VTTLangNode,
  VTTLeafNode,
  VTTNode,
  VTTRubyNode,
  VTTRubyTextNode,
  VTTTimestampNode,
  VTTUnderlineNode,
  VTTVoiceNode,
} from 'media-captions';
```

## `renderVTTTokensString`

This function takes an array of `VTToken` objects and renders them into a string:

```ts
import { renderVTTTokensString, tokenizeVTTCue, VTTCue } from 'media-captions';

const cue = new VTTCue(0, 10, '<v Joe>Hello world!');
const tokens = tokenizeVTTCue(cue);

// Output: <span title="Joe" part="voice">Hello world!</span>
const result = renderVTTTokensString(tokens);
```

## `updateTimedVTTCueNodes`

This function accepts a root DOM node to update all timed text nodes by setting the correct
`data-future` and `data-past` attributes.

```ts
import { updateTimedVTTCueNodes } from 'media-captions';

const video = document.querySelector('video')!,
  captions = document.querySelector('#captions')!;

video.addEventListener('timeupdate', () => {
  updateTimedVTTCueNodes(captions, video.currentTime);
});
```

This can be used when working with karaoke-style captions:

```ts
const cue = new VTTCue(300, 308, '<05:00>Timed...<05:05>Text!');

// Timed text nodes that would be updated at 303 seconds:
// <span part="timed" data-time="300" data-past>Timed...</span>
// <span part="timed" data-time="305" data-future>Text!</span>
```

## `CaptionsOverlayRenderer`

The overlay renderer is used to render captions over a video player. It follows the
[WebVTT rendering specification](https://www.w3.org/TR/webvtt1/#rendering) on how regions
and cues should be visually rendered. It includes:

- Correctly aligning and positioning regions and cues.
- Processing and applying all region and cue settings.
- Rendering captions top-down in-order (Cue 1, Cue 2, Cue 3).
- Rendering roll up captions in regions.
- Collision detection to avoid overlapping cues.
- Updating timed text nodes with `data-past` and `data-future` attributes.
- Updating when the overlay is resized.
- Applying SSA/ASS styles.
- Accepts native `VTTCue` objects.

> **Warning**
> The [styles files](#installation) need to be included for the overlay renderer to work correctly!

```html
<div>
  <video src="..."></video>
  <div id="captions"></div>
</div>
```

```ts
import 'media-captions/styles/captions.css';
import 'media-captions/styles/regions.css';

import { CaptionsOverlayRenderer, parseResponse } from 'media-captions';

const video = document.querySelector('video')!,
  captions = document.querySelector('#captions')!,
  renderer = new CaptionsOverlayRenderer(captions);

parseResponse(fetch('/media/subs/english.vtt')).then(({ regions, cues }) => {
  renderer.setup(regions, cues);
});

video.addEventListener('timeupdate', () => {
  renderer.currentTime = video.currentTime;
});
```

**Props**

- `dir`: Sets the text direction (i.e., `ltr` or `rtl`).
- `currentTime`: Updates the current playback time and schedules a re-render.

**Methods**

- `setup(regions: VTTRegion[], cues: VTTCue[])`: Resets the renderer and prepares new regions
  and cues. This should be called on text track change.
- `addCue(cue: VTTCue)`: Add a new cue to the renderer.
- `removeCue(cue: VTTCue)`: Remove a cue from the renderer.
- `update(forceUpdate: boolean)`: Schedule a re-render.
- `reset()`: Reset the renderer and clear all internal state including region and cue DOM nodes.
- `destroy()`: Reset the renderer and destroy internal observers and event listeners.

## Styling

Captions rendered with the [`CaptionOverlayRenderer`](#captionsoverlayrenderer) can be
easily customized with CSS. Here are all the parts you can select and customize:

```css
/* `#captions` assumes you set the id on the captions overlay element. */
#captions {
  /* simple CSS vars customization (defaults below) */
  --overlay-padding: 1%;
  --cue-color: white;
  --cue-bg-color: rgba(0, 0, 0, 0.8);
  --cue-font-size: calc(var(--overlay-height) / 100 * 5);
  --cue-line-height: calc(var(--cue-font-size) * 1.2);
  --cue-padding-x: calc(var(--cue-font-size) * 0.6);
  --cue-padding-y: calc(var(--cue-font-size) * 0.4);
}

#captions [part='region'] {
}

#captions [part='region'][data-active] {
}

#captions [part='region'][data-scroll='up'] {
}

#captions [part='cue-display'] {
}

#captions [part='cue'] {
}

#captions [part='voice'] {
}

#captions [part='voice'][title='Joe'] {
}

#captions [part='timed'] {
}

#captions [part='timed'][data-past] {
}

#captions [part='timed'][data-future] {
}
```

## VTT

Web Video Text Tracks (WebVTT) is the natively supported captions format supported
by browsers. You can learn more about it on
[MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebVTT_API) or by reading the
[W3 specification](https://www.w3.org/TR/webvtt1).

WebVTT file is a plain-text file that looks something like this:

```text
WEBVTT

REGION id:foo width:100 lines:3 viewportanchor:0%,0% regionanchor:0%,0% scroll:up

1
00:00 --> 00:02 region:foo
Hello, Joe!

2
00:02 --> 00:04 region:foo
Hello, Jane!
```

> **Warning**
> The parser will throw in strict parsing mode if the WEBVTT header line is not present.

### VTT Regions

WebVTT supports regions for bounding/positioning cues and implementing roll up captions
by setting `scroll:up`.

<img 
  src="./assets/vtt-regions.png" 
  width="400px" 
  alt="Visual explanation of VTT regions" 
/>

<img 
  src="./assets/vtt-region-scroll.png" 
  width="400px" 
  alt="Visual explanation of VTT region scroll up setting for roll up captions" 
/>

### VTT Cues

WebVTT cues are used for positioning and displaying text. They can snap to lines or be
freely positioned as a percentage of the viewport.

```ts
const cue = new VTTCue(0, 10, '...');

// Position at line 5 in the video.
// Lines are calculated using cue line height.
cue.line = 5;

// 50% from the top and 10% from the left of the video.
cue.snapToLines = false;
cue.line = 50;
cue.position = 10;

// Align cue horizontally at end of line.
cue.align = 'end';
// Align top of the cue at the bottom of the line.
cue.lineAlign = 'end';
```

<img 
  src="./assets/vtt-cues.png" 
  width="400px" 
  alt="Visual explanation of VTT cues" 
/>

## SRT

SubRip Subtitle (SRT) is a simple captions format that only contains cues. There are no
regions or positioning settings as found in [VTT](#vtt).

SRT is a plain-text file that looks like this:

```text
00:00 --> 00:02,200
Hello, Joe!

00:02,200 --> 00:04,400
Hello, Jane!
```

Note that SRT timestamps use a comma `,` to separate the milliseconds unit unlike VTT which uses
a dot `.`.

## SSA/ASS

SubStation Alpha (SSA) and its successor Advanced SubStation Alpha (ASS) are subtitle formats
commonly used for anime content. They allow for rich text formatting, including
color, font size, bold, italic, and underline, as well as more advanced features like karaoke and
typesetting.

SSA/ASS is a plain-text file that looks like this:

```text
[Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,36,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:05.10,0:00:07.20,Default,,0,0,0,,Hello, world!

[Other Events]
Format: Start, End, Text
Dialogue: 0:00:04,\t0:00:07.20, One!
Dialogue: 0:00:05,\t0:00:08.20, Two!
Dialogue: 0:00:06,\t0:00:09.20, Three!
Continue dialogue on a new line.
```

The following features are supported:

- Multiple styles blocks and all format fields (e.g., PrimaryColour, Bold, ScaleX, etc.).
- Multiple events blocks and associating them with styles.

The following features are not supported yet:

- Layers
- Movie
- Picture
- Sound
- Command
- Font Loading
- Text Codes (stripped out for now)

It is very likely we will implement custom font loading, layers, and text codes in the
near future. The rest is unlikely for now. You can always try and implement custom transitions
or animations using CSS (see [Styling](#styling)).

We recommend using [SubtitlesOctopus](https://github.com/libass/JavascriptSubtitlesOctopus) for
SSA/ASS captions as it supports most features and is a performant WASM wrapper of
[libass](https://github.com/libass/libass). You'll need to fall back to this implementation on
iOS Safari (iPhone) as custom captions are not possible.

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
  VTTCueTemplate,
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
