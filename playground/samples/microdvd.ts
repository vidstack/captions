import type { TextSample } from './types';

export const microdvdSample: TextSample = {
  kind: 'text',
  id: 'sub',
  name: 'MicroDVD (SUB)',
  type: 'sub',
  extension: 'sub',
  duration: 18,
  description:
    'Frame-based MicroDVD timing with a {1}{1}fps header, {y:} style tags, {c:$BBGGRR} colours, ' +
    '{s:} font size, and | line breaks. Parsed via type "sub".',
  text: `{1}{1}25.000
{25}{100}MicroDVD frame-based timing at 25 fps
{110}{200}{y:i}Italic line|Second line via a pipe
{210}{300}{c:$66d1ff}{y:b}Coloured bold text
{310}{400}{s:28}Larger font size|{Y:u}Underlined second line
{410}{445}Short cue
`,
};
