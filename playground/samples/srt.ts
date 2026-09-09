import type { TextSample } from './types';

export const srtSample: TextSample = {
  kind: 'text',
  id: 'srt',
  name: 'SubRip (SRT)',
  type: 'srt',
  extension: 'srt',
  duration: 16,
  description:
    'Font colours, <b>/<i>/<u> tags, {\\anN} numpad alignment left over from ASS conversions, and ' +
    'ignored X1/Y1 extended coordinates.',
  text: `1
00:00:00,000 --> 00:00:03,500
<font color="#ffd166">Colour</font> via <font color="cyan">font tags</font>

2
00:00:01,500 --> 00:00:05,000
{\\an8}Top-centre placement (an8)

3
00:00:04,000 --> 00:00:08,000
<b>Bold</b>, <i>italic</i>, and <u>underline</u>
on a second line

4
00:00:06,000 --> 00:00:09,000
{\\an7}Top-left (an7)

5
00:00:08,500 --> 00:00:12,000
{\\an3}Bottom-right (an3)

6
00:00:10,000 --> 00:00:14,000 X1:100 X2:500 Y1:400 Y2:450
Extended X1/X2/Y1/Y2 coordinates are ignored

7
00:00:12,000-->00:00:15,500
Tolerant of "-->" without spaces and 00:00:12.000 dots
`,
};
