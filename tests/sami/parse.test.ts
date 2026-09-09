import { inferCaptionsFormat, parseText, renderVTTCueString } from 'media-captions';

const MULTI_LANGUAGE = [
  '<SAMI>',
  '<HEAD>',
  '<TITLE>Sample Film</TITLE>',
  '<STYLE TYPE="text/css">',
  '<!--',
  'P { margin-left: 8pt; text-align: center; }',
  '.ENCC { Name: English; lang: en-US; SAMIType: CC; }',
  '.KRCC { Name: Korean; lang: ko-KR; SAMIType: CC; }',
  '-->',
  '</STYLE>',
  '</HEAD>',
  '<BODY>',
  '<SYNC Start=1000>',
  '<P Class=ENCC>Hello<br>world',
  '<P Class=KRCC>안녕',
  '<SYNC Start=3000>',
  '<P Class=ENCC>&nbsp;',
  '<SYNC Start=4000>',
  '<P Class=ENCC>Second',
  '<P Class=KRCC>&nbsp;',
  '<SYNC Start=6000>',
  '<P Class=ENCC>&nbsp;',
  '</BODY>',
  '</SAMI>',
].join('\n');

test('GOOD: multi-language document with unclosed tags and &nbsp; clears', async () => {
  const onCue = vi.fn(),
    onHeaderMetadata = vi.fn();

  const { cues, errors, metadata, regions } = await parseText(MULTI_LANGUAGE, {
    type: 'smi',
    onCue,
    onHeaderMetadata,
  });

  expect(errors).toHaveLength(0);
  expect(regions).toHaveLength(0);
  expect(metadata).toEqual({ Title: 'Sample Film', Languages: 'en-US,ko-KR' });
  expect(onHeaderMetadata).toHaveBeenCalledTimes(1);
  expect(onHeaderMetadata).toHaveBeenCalledWith(metadata);
  expect(onCue).toHaveBeenCalledTimes(3);

  expect(cues.map((cue) => [cue.id, cue.startTime, cue.endTime, cue.text])).toEqual([
    ['ENCC', 1, 3, '<lang en-US>Hello\nworld</lang>'],
    ['KRCC', 1, 4, '<lang ko-KR>안녕</lang>'],
    ['ENCC', 4, 6, '<lang en-US>Second</lang>'],
  ]);

  // `P { text-align }` from the style block.
  for (const cue of cues) expect(cue.align).toBe('center');

  expect(renderVTTCueString(cues[0])).toBe('<span lang="en-US">Hello\nworld</span>');
});

test('GOOD: consumers pick a language by filtering on cue.id', async () => {
  const { cues } = await parseText(MULTI_LANGUAGE, { type: 'sami' });
  expect(cues.filter((cue) => cue.id === 'KRCC').map((cue) => cue.text)).toEqual([
    '<lang ko-KR>안녕</lang>',
  ]);
});

test('GOOD: formatting and colours map to WebVTT tags', async () => {
  const { cues, errors } = await parseText(
    [
      '<SAMI><BODY>',
      '<SYNC Start=0><P Class=ENCC>',
      '<b>Bold</b> <i>Italic</i> <u>Under</u><br>',
      '<FONT COLOR=FFFF00>Yellow</FONT> <font color="red">Red</font> <font color=orange>Orange</font> <font face=Arial>Plain</font>',
      '</P></SYNC>',
      '<SYNC Start=1000><P Class=ENCC><b><i>Mis</b>nested</i> <span>and</span> <i>unclosed',
      '</BODY></SAMI>',
    ].join('\n'),
    { type: 'smi' },
  );

  expect(errors).toHaveLength(0);
  expect(cues).toHaveLength(2);
  expect(cues[0].text).toBe(
    '<b>Bold</b> <i>Italic</i> <u>Under</u>\n<c.#ffff00>Yellow</c> <c.red>Red</c> <c.#ffa500>Orange</c> <c>Plain</c>',
  );
  expect(cues[1].text).toBe('<b><i>Mis</i></b><i>nested</i> and <i>unclosed</i>');

  expect(renderVTTCueString(cues[0])).toBe(
    '<b>Bold</b> <i>Italic</i> <u>Under</u>\n<span style="color: #ffff00;">Yellow</span> <span style="color: red;">Red</span> <span style="color: #ffa500;">Orange</span> <span>Plain</span>',
  );
});

test('GOOD: whitespace collapses like HTML', async () => {
  const { cues } = await parseText(
    [
      '<SAMI><BODY>',
      '<SYNC Start=0>',
      '  <P Class=ENCC>',
      '    Hello   there',
      '    friend  <br>  second   line  ',
      '  </P>',
      '</BODY></SAMI>',
    ].join('\n'),
    { type: 'smi' },
  );
  expect(cues[0].text).toBe('Hello there friend\nsecond line');
});

test('GOOD: entities are decoded then re-escaped for WebVTT', async () => {
  const { cues } = await parseText(
    '<SAMI><BODY><SYNC Start=0><P>Tom &amp; Jerry &lt;3 &quot;caf&#233;&quot; &#x26; raw & and <3</P></BODY></SAMI>',
    { type: 'smi' },
  );
  expect(cues).toHaveLength(1);
  expect(cues[0].text).toBe('Tom &amp; Jerry &lt;3 "café" &amp; raw &amp; and &lt;3');
});

test('GOOD: out-of-order SYNC blocks are sorted', async () => {
  const { cues, errors } = await parseText(
    [
      '<SAMI><BODY>',
      '<SYNC Start=5000><P>Late',
      '<SYNC Start=1000><P>Early',
      '<SYNC Start=3000><P>&nbsp;',
      '</BODY></SAMI>',
    ].join('\n'),
    { type: 'smi' },
  );

  expect(errors).toHaveLength(0);
  expect(cues.map((cue) => [cue.startTime, cue.endTime, cue.text])).toEqual([
    [1, 3, 'Early'],
    [5, 10, 'Late'],
  ]);
  expect(cues[0].id).toBe('');
});

test('GOOD: cues that are never cleared end 5 seconds after the last SYNC', async () => {
  const { cues } = await parseText(
    [
      '<SAMI><BODY>',
      '<SYNC Start=1000><P Class=A>a1<P Class=B>b1',
      '<SYNC Start=8000><P Class=B>b2',
      '</BODY></SAMI>',
    ].join('\n'),
    { type: 'smi' },
  );

  expect(cues.map((cue) => [cue.id, cue.startTime, cue.endTime, cue.text])).toEqual([
    ['A', 1, 13, 'a1'],
    ['B', 1, 8, 'b1'],
    ['B', 8, 13, 'b2'],
  ]);
});

test('GOOD: case-insensitive tags, quoted attributes, and comments', async () => {
  const { cues, metadata } = await parseText(
    [
      '<?xml version="1.0"?>',
      '<!DOCTYPE sami>',
      '<sami><head><title>Lower</title>',
      "<style type='text/css'>.encc { name: English; lang: en; }</style></head>",
      '<body>',
      '<!-- a comment <sync start=99999> that is skipped -->',
      '<sync start="1000"><p class="ENCC" id="Source">One</p></sync>',
      '<sync start=\'2000\'><p class="encc">&nbsp;</p></sync>',
      '</body></sami>',
    ].join('\n'),
    { type: 'smi' },
  );

  expect(metadata).toEqual({ Title: 'Lower', Languages: 'en' });
  expect(cues).toHaveLength(1);
  expect(cues[0].id).toBe('ENCC');
  expect(cues[0].startTime).toBe(1);
  expect(cues[0].endTime).toBe(2);
  expect(cues[0].text).toBe('<lang en>One</lang>');
});

test('GOOD: paragraphs of one class in the same SYNC stack into one cue', async () => {
  const { cues } = await parseText(
    '<SAMI><BODY><SYNC Start=0><P Class=A>One<P Class=A>Two<SYNC Start=1000><P Class=A>&nbsp;</BODY></SAMI>',
    { type: 'smi' },
  );
  expect(cues).toHaveLength(1);
  expect(cues[0].text).toBe('One\nTwo');
});

test('GOOD: decimal start times', async () => {
  const { cues } = await parseText(
    '<SAMI><BODY><SYNC Start=1500.5><P>A<SYNC Start=2000><P>&nbsp;</BODY></SAMI>',
    { type: 'smi' },
  );
  expect(cues[0].startTime).toBe(1.5005);
  expect(cues[0].endTime).toBe(2);
});

test('GOOD: format inference from extension', () => {
  expect(inferCaptionsFormat('text/plain', '/captions/x.smi')).toBe('smi');
  expect(inferCaptionsFormat('text/plain', '/captions/x.sami')).toBe('smi');
});

test('BAD: invalid SYNC start is reported and its paragraphs skipped', async () => {
  const onError = vi.fn();
  const { cues, errors } = await parseText(
    [
      '<SAMI><BODY>',
      '<SYNC Start=abc>',
      '<P>Skipped',
      '<SYNC>',
      '<P>Also skipped',
      '<SYNC Start=2000>',
      '<P>Kept',
      '</BODY></SAMI>',
    ].join('\n'),
    { type: 'smi', errors: true, onError },
  );

  expect(cues).toHaveLength(1);
  expect(cues[0].text).toBe('Kept');
  expect(cues[0].startTime).toBe(2);
  expect(cues[0].endTime).toBe(7);
  expect(errors).toHaveLength(2);
  expect(onError).toHaveBeenCalledTimes(2);
  expect(errors[0].code).toBe(2);
  expect(errors[0].line).toBe(2);
  expect(errors).toMatchInlineSnapshot(`
    [
      [Error: sync start \`abc\` is invalid on line 2],
      [Error: sync start \`\` is invalid on line 4],
    ]
  `);
});

test('BAD: missing SAMI root is a signature error but cues are still parsed', async () => {
  const { cues, errors } = await parseText('<BODY><SYNC Start=1000><P>Text</BODY>', {
    type: 'smi',
    errors: true,
  });
  expect(cues).toHaveLength(1);
  expect(cues[0].text).toBe('Text');
  expect(errors).toHaveLength(1);
  expect(errors[0].code).toBe(1);
  expect(errors[0].message).toBe('missing SAMI `<SAMI>` root element');
});

test('BAD: missing BODY is a signature error', async () => {
  const { cues, errors } = await parseText('<SAMI><SYNC Start=1000><P>Text</SAMI>', {
    type: 'smi',
    errors: true,
  });
  expect(cues).toHaveLength(1);
  expect(errors).toHaveLength(1);
  expect(errors[0].code).toBe(1);
  expect(errors[0].message).toBe('missing SAMI `<BODY>` element');
});

test('BAD: missing SAMI root throws in strict mode', async () => {
  await expect(
    parseText('<HTML><BODY><SYNC Start=0><P>x</BODY></HTML>', { type: 'smi', strict: true }),
  ).rejects.toThrow('missing SAMI `<SAMI>` root element');
});

test('BAD: invalid start throws in strict mode', async () => {
  await expect(
    parseText('<SAMI><BODY>\n<SYNC Start=abc><P>x</BODY></SAMI>', { type: 'smi', strict: true }),
  ).rejects.toThrow('sync start `abc` is invalid on line 2');
});

test('BAD: errors are not collected when disabled', async () => {
  const { errors } = await parseText('<SYNC Start=abc><P>x', { type: 'smi', errors: false });
  expect(errors).toHaveLength(0);
});
