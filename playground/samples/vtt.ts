import type { TextSample } from './types';

export const vttSample: TextSample = {
  kind: 'text',
  id: 'vtt',
  name: 'WebVTT',
  type: 'vtt',
  extension: 'vtt',
  duration: 30,
  description:
    'Positioning (line/position/size/align), regions with roll-up, STYLE blocks, karaoke ' +
    'timestamps, voices, ruby, RTL, and vertical writing.',
  text: `WEBVTT
Kind: captions
Language: en-US

STYLE
::cue { font-family: system-ui, sans-serif; }
::cue(b) { color: #ffd166; }
::cue(v[voice="Bob"]) { color: #9cc4ff; }
::cue(.shout) { text-transform: uppercase; letter-spacing: 0.05em; }
::cue(:past) { color: #ffd166; }
::cue(:future) { opacity: 0.55; }

REGION
id:rollup
width:60%
lines:3
regionanchor:0%,100%
viewportanchor:5%,92%
scroll:up

REGION
id:topright
width:38%
lines:2
regionanchor:100%,0%
viewportanchor:95%,8%

intro
00:00:00.000 --> 00:00:04.000
<v Alice>Welcome to the <b>media-captions</b> playground.

00:00:01.000 --> 00:00:04.000 line:1 align:start position:5% size:40%
<v Bob>line:1 align:start size:40%

00:00:04.000 --> 00:00:08.000 align:end position:95% size:45% line:-3
<c.shout>align:end</c> at position 95%, three lines up

00:00:04.500 --> 00:00:08.000 line:50% position:50% size:50%
line:50% (percentage, not snapped) centred

karaoke
00:00:08.000 --> 00:00:12.000
Karaoke <00:00:09.000>timed <00:00:10.000>text <00:00:11.000>lights up

00:00:12.000 --> 00:00:20.000 region:rollup
Roll-up region: first line

00:00:13.500 --> 00:00:20.000 region:rollup
Second line pushes the first up

00:00:15.000 --> 00:00:20.000 region:rollup
Third line fills the region

00:00:16.500 --> 00:00:20.000 region:rollup
Fourth line scrolls the first line out

00:00:12.000 --> 00:00:16.000 region:topright
<i>topright</i> region anchored at 95%,8%

00:00:14.000 --> 00:00:16.000 region:topright
Second line in the same region

00:00:20.000 --> 00:00:24.000
مرحبا بكم في ملعب <b>التسميات التوضيحية</b>

00:00:20.000 --> 00:00:24.000 line:1
Ruby: <ruby>漢<rt>kan</rt>字<rt>ji</rt></ruby> annotation, lang <lang de>Grüße</lang>

00:00:24.000 --> 00:00:29.500 vertical:rl
縦書きのキャプション（vertical:rl）

00:00:24.000 --> 00:00:29.500 vertical:lr
Latin text in vertical:lr
`,
};
