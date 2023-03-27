import { parseText, parseVTTTimestamp } from 'media-captions';

// -------------------------------------------------------------------------------
// BAD
// -------------------------------------------------------------------------------

test('BAD: invalid timestamp separators', async () => {
  const { cues, errors } = await parseText(
    ['WEBVTT', '', '00:00 00:02', '', '00:00-->00:02', 'Text'].join('\n'),
  );
  expect(cues).toHaveLength(0);
  expect(errors).toMatchInlineSnapshot(`
    [
      [Error: cue start timestamp \`00:00-->00:02\` is invalid on line 5],
      [Error: cue end timestamp \`\` is invalid on line 5],
    ]
  `);
});

test('BAD: invalid fractional digits', async () => {
  const { cues, errors } = await parseText(
    ['WEBVTT', '', '00:00.00 --> 00:02.000', 'Text'].join('\n'),
  );
  expect(cues).toHaveLength(0);
  expect(errors).toMatchInlineSnapshot(`
    [
      [Error: cue start timestamp \`00:00.00\` is invalid on line 3],
    ]
  `);
});

test('BAD: invalid time unit separator', async () => {
  const { cues, errors } = await parseText(
    ['WEBVTT', '', '00.00.00 --> 00:02.000', 'Text'].join('\n'),
  );
  expect(cues).toHaveLength(0);
  expect(errors).toMatchInlineSnapshot(`
    [
      [Error: cue start timestamp \`00.00.00\` is invalid on line 3],
    ]
  `);
});

test('BAD: missing start & end timestamp', async () => {
  const { cues, errors } = await parseText(['WEBVTT', '', ' --> ', 'Text'].join('\n'));
  expect(cues).toHaveLength(0);
  expect(errors).toMatchInlineSnapshot(`
    [
      [Error: cue start timestamp \`\` is invalid on line 3],
      [Error: cue end timestamp \`\` is invalid on line 3],
    ]
  `);
});

test('BAD: missing start timestamp', async () => {
  const { cues, errors } = await parseText(['WEBVTT', '', '--> 00:02', 'Text'].join('\n'));
  expect(cues).toHaveLength(0);
  expect(errors).toMatchInlineSnapshot(`
    [
      [Error: cue start timestamp \`\` is invalid on line 3],
    ]
  `);
});

test('BAD: missing end timestamp', async () => {
  const { cues, errors } = await parseText(['WEBVTT', '', '00:00.000 --> ', 'Text'].join('\n'));
  expect(cues).toHaveLength(0);
  expect(errors).toMatchInlineSnapshot(`
    [
      [Error: cue end timestamp \`\` is invalid on line 3],
    ]
  `);
});

// -------------------------------------------------------------------------------
// GOOD
// -------------------------------------------------------------------------------

test('GOOD: valid timestamps', async () => {
  const { cues, errors } = await parseText(
    [
      'WEBVTT',
      '',
      '00:00\t-->\t00:00:02.100',
      'Text A',
      '',
      '00:00:02.100 -->\t\t00:04.300',
      'Text B',
      '',
      '01:01:04.300\t-->  02:01:06',
      'Text C',
    ].join('\n'),
  );

  expect(cues).toHaveLength(3);
  expect(errors).toHaveLength(0);

  expect(cues[0].startTime).toBe(0);
  expect(cues[0].endTime).toBe(2.1);
  expect(cues[0].text).toBe('Text A');

  expect(cues[1].startTime).toBe(2.1);
  expect(cues[1].endTime).toBe(4.3);
  expect(cues[1].text).toBe('Text B');

  expect(cues[2].startTime).toBe(3664.3);
  expect(cues[2].endTime).toBe(7266);
  expect(cues[2].text).toBe('Text C');
});

test('GOOD: parse raw timestamp', () => {
  const testCases = [
    // Valid
    ['00:00:01.000', 1],
    ['00:01:00.000', 60],
    ['01:00:00.000', 3600],
    ['01:23:45.678', 5025.678],

    // Valid - optional parts omitted
    ['00:00:00', 0],
    ['0:00:00', 0],
    ['00:00', 0],
    ['59:00', 3540],
    ['00:01:23', 83],
    ['01:23:45', 5025],
    ['1:23:45.678', 5025.678],

    // Invalid
    ['00:60', null], // minutes part is 60 and no seconds part
    ['00:00.10', null], // milliseconds part has less than 3 digits
    ['01:23:45.1234', null], // milliseconds part has more than 3 digits
    ['00:60:00.000', null], // minutes part is 60
    ['00:80:00.000', null], // minutes part is greater than 60
    ['00:00:60.000', null], // seconds part is 60
    ['00:00:80.000', null], // seconds part is greater than 60
    ['12:34:56:789', null], // timestamp format is incorrect
    ['12,34,56.100', null], // invalid unit separator
  ] as const;

  for (const [timestamp, expected] of testCases) {
    expect(parseVTTTimestamp(timestamp)).toBe(expected);
  }
});
