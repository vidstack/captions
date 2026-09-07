import type { TextSample } from './types';

export const ssaSample: TextSample = {
  kind: 'text',
  id: 'ass',
  name: 'SSA / ASS',
  type: 'ass',
  extension: 'ass',
  duration: 26,
  description:
    'Outlined dialogue, an opaque-box sign, \\pos, \\move, \\fad, \\t colour + scale, \\kf karaoke ' +
    'sweeps, a \\p drawing, \\clip, Scroll and Banner effects, and per-span \\fs / \\fn.',
  text: String.raw`[Script Info]
Title: Playground typesetting
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720
WrapStyle: 0
ScaledBorderAndShadow: yes
Collisions: Normal

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,52,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,3,2,2,40,40,40,1
Style: Sign,Arial,40,&H0000FFFF,&H000000FF,&H00403020,&H00403020,-1,0,0,0,100,100,0,0,3,4,0,8,40,40,30,1
Style: Karaoke,Arial,56,&H00FFFFFF,&H0000A5FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,0,2,40,40,40,1
Style: Note,Arial,34,&H00FFD0A0,&H000000FF,&H00000000,&H00000000,0,-1,0,0,100,100,1,0,1,2,0,7,40,40,120,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:04.00,Default,Rin,0,0,0,,Outlined dialogue with {\i1}italics{\i0} and {\c&H00A5FF&}colour{\r} tags
Dialogue: 1,0:00:00.00,0:00:06.00,Sign,,0,0,0,,BorderStyle 3 opaque box sign (top centre)
Dialogue: 0,0:00:00.00,0:00:06.00,Note,,0,0,0,,Italic note with letter spacing (\an7)
Dialogue: 0,0:00:02.00,0:00:06.00,Default,,0,0,0,,{\pos(320,300)\an5}\pos anchored at (320,300)
Dialogue: 0,0:00:04.00,0:00:08.00,Default,,0,0,0,,{\move(200,600,1080,600)\an5}\move across the frame
Dialogue: 0,0:00:06.00,0:00:10.00,Default,,0,0,0,,{\fad(600,600)}Fade in and out with \fad
Dialogue: 0,0:00:08.00,0:00:12.00,Default,,0,0,0,,{\an8\t(0,3000,\c&H0000FF&\fscx150\fscy150)}\t colour + scale
Dialogue: 0,0:00:10.00,0:00:14.00,Karaoke,,0,0,0,,{\kf60}Ka{\kf60}ra{\kf60}o{\kf60}ke {\kf80}sweeps {\kf80}the {\kf100}fill
Dialogue: 2,0:00:12.00,0:00:16.00,Default,,0,0,0,,{\an7\pos(80,80)\bord3\c&H66D1FF&\3c&H000000&\p1}m 0 0 l 200 0 200 120 100 170 0 120{\p0}
Dialogue: 0,0:00:12.00,0:00:16.00,Default,,0,0,0,,{\an5\pos(640,360)\clip(240,338,1040,382)}Clipped to a rectangle band: \clip
Dialogue: 0,0:00:16.00,0:00:20.00,Default,,0,0,0,Scroll up;600;100;40,Scroll up effect through a band
Dialogue: 0,0:00:18.00,0:00:22.00,Default,,0,0,0,Banner;20;0;60,Banner text scrolls right to left across the screen like a ticker
Dialogue: 0,0:00:20.00,0:00:24.00,Default,,0,0,0,,Per-span {\fs76}bigger{\fs52} and {\fnCourier New}monospace{\fnArial} and {\b1}bold{\b0} runs
Dialogue: 0,0:00:22.00,0:00:26.00,Default,,0,0,0,,{\an5\pos(640,300)\frz15\fscx110}Rotated with \frz and stretched with \fscx
`,
};
