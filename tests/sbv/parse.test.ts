import { parseText } from 'media-captions';

test('GOOD: parse basic file', async () => {
  const onCue = vi.fn();
  const { cues, errors, metadata, regions } = await parseText(
    [
      '0:00:00.599,0:00:04.160',
      '>> ALICE: Hi, my name is Alice Miller and this is John Brown',
      '',
      '0:00:04.160,0:00:06.770',
      ">> JOHN: and we're the owners of Miller Bakery.",
      'Second line.',
      '',
    ].join('\n'),
    { type: 'sbv', onCue },
  );

  expect(errors).toHaveLength(0);
  expect(regions).toHaveLength(0);
  expect(metadata).toEqual({});
  expect(cues).toHaveLength(2);
  expect(onCue).toHaveBeenCalledTimes(2);

  expect(cues[0].startTime).toBe(0.599);
  expect(cues[0].endTime).toBe(4.16);
  expect(cues[0].text).toBe('>> ALICE: Hi, my name is Alice Miller and this is John Brown');

  expect(cues[1].startTime).toBe(4.16);
  expect(cues[1].endTime).toBe(6.77);
  expect(cues[1].text).toBe(">> JOHN: and we're the owners of Miller Bakery.\nSecond line.");
});

test('GOOD: [br] becomes a line break', async () => {
  const { cues } = await parseText(
    ['0:00:01.000,0:00:02.000', 'First[br]Second[BR]Third'].join('\n'),
    { type: 'sbv' },
  );
  expect(cues).toHaveLength(1);
  expect(cues[0].text).toBe('First\nSecond\nThird');
});

test('GOOD: hours with multiple digits', async () => {
  const { cues, errors } = await parseText(['1:02:03.004,12:00:00.500', 'Text'].join('\n'), {
    type: 'sbv',
  });
  expect(errors).toHaveLength(0);
  expect(cues[0].startTime).toBe(3723.004);
  expect(cues[0].endTime).toBe(43200.5);
});

test('GOOD: CRLF input', async () => {
  const { cues, errors } = await parseText(
    '0:00:00.000,0:00:01.000\r\nOne\r\n\r\n0:00:01.000,0:00:02.000\r\nTwo\r\nMore\r\n',
    { type: 'sbv' },
  );
  expect(errors).toHaveLength(0);
  expect(cues).toHaveLength(2);
  expect(cues[0].text).toBe('One');
  expect(cues[1].text).toBe('Two\nMore');
});

test('GOOD: last cue without trailing blank line is flushed', async () => {
  const { cues } = await parseText('0:00:00.000,0:00:01.000\nOnly', { type: 'sbv' });
  expect(cues).toHaveLength(1);
  expect(cues[0].text).toBe('Only');
});

test('GOOD: escapes special characters in text', async () => {
  const { cues } = await parseText('0:00:00.000,0:00:01.000\nTom & Jerry <3', { type: 'sbv' });
  expect(cues[0].text).toBe('Tom &amp; Jerry &lt;3');
});

test('BAD: end time not greater than start', async () => {
  const onError = vi.fn();
  const { cues, errors } = await parseText(
    [
      '0:00:05.000,0:00:04.000',
      'Skipped',
      '',
      '0:00:05.000,0:00:05.000',
      'Also skipped',
      '',
      '0:00:06.000,0:00:07.000',
      'Kept',
    ].join('\n'),
    { type: 'sbv', errors: true, onError },
  );

  expect(cues).toHaveLength(1);
  expect(cues[0].text).toBe('Kept');
  expect(errors).toHaveLength(2);
  expect(onError).toHaveBeenCalledTimes(2);
  expect(errors[0].code).toBe(2);
  expect(errors[0].line).toBe(1);
  expect(errors).toMatchInlineSnapshot(`
    [
      [Error: cue end timestamp \`0:00:04.000\` is not greater than start \`0:00:05.000\` on line 1],
      [Error: cue end timestamp \`0:00:05.000\` is not greater than start \`0:00:05.000\` on line 4],
    ]
  `);
});

test('BAD: malformed timing line', async () => {
  const { cues, errors } = await parseText(
    ['00:00:01,000 --> 00:00:02,000', 'Not SBV', '', '0:00:03.000,0:00:04.000', 'Good'].join('\n'),
    { type: 'sbv', errors: true },
  );

  expect(cues).toHaveLength(1);
  expect(cues[0].text).toBe('Good');
  expect(errors).toHaveLength(1);
  expect(errors[0].code).toBe(4);
});

test('BAD: bad range throws in strict mode', async () => {
  await expect(
    parseText('0:00:05.000,0:00:04.000\nText', { type: 'sbv', strict: true }),
  ).rejects.toThrow('is not greater than start');
});
