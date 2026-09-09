import type { TextSample } from './types';

export const samiSample: TextSample = {
  kind: 'text',
  id: 'smi',
  name: 'SAMI (SMI)',
  type: 'smi',
  extension: 'smi',
  duration: 14,
  description:
    'Microsoft SAMI: SYNC blocks with class-based languages, inline <b>/<i>/<font> tags, entities, ' +
    'and &nbsp; clears. Parsed via type "smi".',
  text: `<SAMI>
<HEAD>
<TITLE>Playground SAMI</TITLE>
<STYLE TYPE="text/css"><!--
P { margin-left: 8pt; margin-right: 8pt; font-size: 20pt; text-align: center; font-family: Arial, sans-serif; color: white; }
.ENUSCC { Name: English; lang: en-US; SAMIType: CC; }
.FRFRCC { Name: French; lang: fr-FR; SAMIType: CC; }
#Source { color: #ffd166; font-style: italic; }
--></STYLE>
</HEAD>
<BODY>
<SYNC Start=0><P Class=ENUSCC ID=Source>Narrator:</P><P Class=FRFRCC>Narrateur :</P>
<SYNC Start=500><P Class=ENUSCC>SAMI captions with <b>bold</b> and <i>italic</i>.<br>Second line.</P><P Class=FRFRCC>Sous-titres SAMI avec du <b>gras</b>.</P>
<SYNC Start=4000><P Class=ENUSCC><font color="#9cc4ff">Coloured</font> text via font tags</P>
<SYNC Start=7500><P Class=ENUSCC>&nbsp;</P>
<SYNC Start=8000><P Class=ENUSCC>Entities: &amp; &lt;tags&gt; caf&eacute;</P>
<SYNC Start=11000><P Class=ENUSCC>&nbsp;</P>
<SYNC Start=11500><P Class=ENUSCC>Final SAMI cue</P>
<SYNC Start=14000><P Class=ENUSCC>&nbsp;</P>
</BODY>
</SAMI>
`,
};
