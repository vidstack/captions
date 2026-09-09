import type { TextSample } from './types';

export const sbvSample: TextSample = {
  kind: 'text',
  id: 'sbv',
  name: 'SubViewer (SBV)',
  type: 'sbv',
  extension: 'sbv',
  duration: 12,
  description: 'The simple YouTube export format: comma-separated timings and [br] line breaks.',
  text: `0:00:00.000,0:00:03.000
SubViewer (SBV) sample as exported by YouTube

0:00:03.000,0:00:06.500
Two lines with[br]a [br] break tag

0:00:06.500,0:00:10.000
>> Speaker change marker
and a plain second line

0:00:10.000,0:00:12.000
Last cue
`,
};
