import type { TextSample } from './types';

export const lrcSample: TextSample = {
  kind: 'text',
  id: 'lrc',
  name: 'LRC lyrics',
  type: 'lrc',
  extension: 'lrc',
  duration: 18,
  description:
    'ID tags as metadata, an offset, plain lines, and enhanced word timings mapped to karaoke ' +
    'timestamp tags (style :past / :future to see them light up).',
  text: `[ti:Playground Song]
[ar:media-captions]
[al:Samples]
[by:playground]
[offset:0]
[00:00.50]Plain LRC line one
[00:03.00]<00:03.00>Enhanced <00:03.60>LRC <00:04.20>words <00:04.80>light <00:05.40>up
[00:06.50]<00:06.50>Karaoke <00:07.10>style <00:07.70>timing <00:08.30>per <00:08.90>word
[00:10.00]Each line ends when the next one begins
[00:13.00]<00:13.00>Last <00:14.00>line <00:15.00>fades <00:16.00>out
`,
};
