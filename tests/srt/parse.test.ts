import { parseText, renderVTTCueString } from 'media-captions';

test('strips extended coordinates from the timing line', async () => {
  const { cues } = await parseText(
    '1\n00:00:01,000 --> 00:00:02,000 X1:100 X2:200 Y1:50 Y2:80\nHello\n',
    { type: 'srt' },
  );
  expect(cues).toHaveLength(1);
  expect(cues[0].text).toBe('Hello');
});

test('maps font colour tags to WebVTT colour classes', async () => {
  const { cues } = await parseText(
    [
      '1',
      '00:00:01,000 --> 00:00:02,000',
      '<font color="#ff0000">red</font> <font color="yellow">yellow</font> <font color="orange">orange</font> <font face="Arial">plain</font>',
      '',
    ].join('\n'),
    { type: 'srt' },
  );
  expect(cues[0].text).toBe(
    '<c.#ff0000>red</c> <c.yellow>yellow</c> <c.#ffa500>orange</c> <c>plain</c>',
  );
  expect(renderVTTCueString(cues[0])).toBe(
    '<span style="color: #ff0000;">red</span> <span style="color: yellow;">yellow</span> <span style="color: #ffa500;">orange</span> <span>plain</span>',
  );
});

test('keeps italics around font tags intact', async () => {
  const { cues } = await parseText(
    '1\n00:00:01,000 --> 00:00:02,000\n<i>a <font color="red">b</font> c</i>\n',
    { type: 'srt' },
  );
  expect(renderVTTCueString(cues[0])).toBe('<i>a <span style="color: red;">b</span> c</i>');
});

test('applies numpad alignment override tags', async () => {
  const { cues } = await parseText(
    [
      '1',
      '00:00:01,000 --> 00:00:02,000',
      '{\\an8}Top',
      '',
      '2',
      '00:00:03,000 --> 00:00:04,000',
      '{\\an1}Bottom left',
      '',
      '3',
      '00:00:05,000 --> 00:00:06,000',
      '{\\an6}Middle right',
      '',
    ].join('\n'),
    { type: 'srt' },
  );

  expect(cues[0].text).toBe('Top');
  expect(cues[0].line).toBe(0);
  expect(cues[0].snapToLines).toBe(true);
  expect(cues[0].align).toBe('center');

  expect(cues[1].text).toBe('Bottom left');
  expect(cues[1].line).toBe('auto');
  expect(cues[1].align).toBe('left');

  expect(cues[2].text).toBe('Middle right');
  expect(cues[2].line).toBe(50);
  expect(cues[2].snapToLines).toBe(false);
  expect(cues[2].lineAlign).toBe('center');
  expect(cues[2].align).toBe('right');
});

test('strips strike-through and unknown override tags', async () => {
  const { cues } = await parseText(
    '1\n00:00:01,000 --> 00:00:02,000\n{\\pos(10,10)}<s>old</s> new\n',
    { type: 'srt' },
  );
  expect(cues[0].text).toBe('old new');
});

test('tolerates missing whitespace around the arrow', async () => {
  const { cues } = await parseText('1\n00:00:01,000-->00:00:02,000\nHello\n', { type: 'srt' });
  expect(cues).toHaveLength(1);
  expect(cues[0].startTime).toBe(1);
  expect(cues[0].endTime).toBe(2);
});
