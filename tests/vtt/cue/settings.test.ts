import { parseText } from 'media-captions';

// -------------------------------------------------------------------------------
// Vertical Setting
// -------------------------------------------------------------------------------

test('GOOD: vertical settings', async () => {
  const { cues, errors } = await parseText(
    [
      'WEBVTT',
      '',
      '00:00 --> 00:02 vertical:lr',
      'Text A',
      '',
      '00:02 --> 00:04 vertical:rl',
      'Text B',
    ].join('\n'),
  );

  expect(cues).toHaveLength(2);
  expect(errors).toBeNull();

  expect(cues[0].vertical).toBe('lr');
  expect(cues[1].vertical).toBe('rl');
});

test('BAD: vertical settings', async () => {
  const { cues, errors } = await parseText(
    ['WEBVTT', '', '00:00 --> 00:02 vertical:unknown', 'Text A'].join('\n'),
  );

  expect(cues).toHaveLength(1);
  expect(errors).toMatchInlineSnapshot(`
    [
      [Error: invalid value for cue setting \`vertical\` on line 3 (value: unknown)],
    ]
  `);

  expect(cues[0].vertical).toBe('');
});

// -------------------------------------------------------------------------------
// Line Setting
// -------------------------------------------------------------------------------

test('GOOD: line settings', async () => {
  const { cues, errors } = await parseText(
    [
      'WEBVTT',
      '',
      '00:00 --> 00:02 line:50%',
      'Text A',
      '',
      '00:02 --> 00:04 line:100,center',
      'Text B',
      '',
      '00:04 --> 00:06 line:42.3,end',
      'Text C',
    ].join('\n'),
  );

  expect(cues).toHaveLength(3);
  expect(errors).toBeNull();

  expect(cues[0].line).toBe(50);
  expect(cues[0].snapToLines).toBe(false);
  expect(cues[0].lineAlign).toBe('start');

  expect(cues[1].line).toBe(100);
  expect(cues[1].snapToLines).toBe(true);
  expect(cues[1].lineAlign).toBe('center');

  expect(cues[2].line).toBe(42.3);
  expect(cues[2].snapToLines).toBe(true);
  expect(cues[2].lineAlign).toBe('end');
});

test('BAD: line settings', async () => {
  const { cues, errors } = await parseText(
    [
      'WEBVTT',
      '',
      '00:00 --> 00:02 line:NaN',
      'Text A',
      '',
      '00:02 --> 00:04 line:10,middle',
      'Text B',
    ].join('\n'),
  );

  expect(cues).toHaveLength(2);
  expect(errors).toMatchInlineSnapshot(`
    [
      [Error: invalid value for cue setting \`line\` on line 3 (value: NaN)],
      [Error: invalid value for cue setting \`line\` on line 6 (value: 10,middle)],
    ]
  `);

  expect(cues[0].line).toBe('auto');
  expect(cues[0].snapToLines).toBe(true);
  expect(cues[0].lineAlign).toBe('start');

  expect(cues[1].line).toBe(10);
  expect(cues[1].snapToLines).toBe(true);
  expect(cues[1].lineAlign).toBe('start');
});

// -------------------------------------------------------------------------------
// Position Setting
// -------------------------------------------------------------------------------

test('GOOD: position settings', async () => {
  const { cues, errors } = await parseText(
    [
      'WEBVTT',
      '',
      '00:00 --> 00:02 position:50%',
      'Text A',
      '',
      '00:02 --> 00:04 position:45%,line-left',
      'Text B',
      '',
      '00:04 --> 00:06 position:20%,line-right',
      'Text C',
    ].join('\n'),
  );

  expect(cues).toHaveLength(3);
  expect(errors).toBeNull();

  expect(cues[0].position).toBe(50);
  expect(cues[0].positionAlign).toBe('auto');

  expect(cues[1].position).toBe(45);
  expect(cues[1].positionAlign).toBe('line-left');

  expect(cues[2].position).toBe(20);
  expect(cues[2].positionAlign).toBe('line-right');
});

test('BAD: position settings', async () => {
  const { cues, errors } = await parseText(
    [
      'WEBVTT',
      '',
      '00:00 --> 00:02 position:NaN',
      'Text A',
      '',
      '00:02 --> 00:04 position:45%,middle',
      'Text B',
    ].join('\n'),
  );

  expect(cues).toHaveLength(2);
  expect(errors).toMatchInlineSnapshot(`
    [
      [Error: invalid value for cue setting \`position\` on line 3 (value: NaN)],
      [Error: invalid value for cue setting \`position\` on line 6 (value: 45%,middle)],
    ]
  `);

  expect(cues[0].position).toBe('auto');
  expect(cues[0].positionAlign).toBe('auto');

  expect(cues[1].position).toBe(45);
  expect(cues[1].positionAlign).toBe('auto');
});

// -------------------------------------------------------------------------------
// Size Setting
// -------------------------------------------------------------------------------

test('GOOD: size settings', async () => {
  const { cues, errors } = await parseText(
    [
      'WEBVTT',
      '',
      '00:00 --> 00:02 size:45%',
      'Text A',
      '',
      '00:02 --> 00:04 size:25.5',
      'Text B',
    ].join('\n'),
  );

  expect(cues).toHaveLength(2);
  expect(errors).toBeNull();

  expect(cues[0].size).toBe(45);
  expect(cues[1].size).toBe(25);
});

test('BAD: size settings', async () => {
  const { cues, errors } = await parseText(
    ['WEBVTT', '', '00:00 --> 00:02 size:NaN', 'Text A'].join('\n'),
  );

  expect(cues).toHaveLength(1);
  expect(errors).toMatchInlineSnapshot(`
    [
      [Error: invalid value for cue setting \`size\` on line 3 (value: NaN)],
    ]
  `);

  expect(cues[0].size).toBe(100);
});

// -------------------------------------------------------------------------------
// Align Setting
// -------------------------------------------------------------------------------

test('GOOD: align settings', async () => {
  const { cues, errors } = await parseText(
    ['WEBVTT', '', '00:00 --> 00:02 align:end', 'Text A'].join('\n'),
  );

  expect(cues).toHaveLength(1);
  expect(errors).toBeNull();

  expect(cues[0].align).toBe('end');
});

test('BAD: align settings', async () => {
  const { cues, errors } = await parseText(
    ['WEBVTT', '', '00:00 --> 00:02 align:middle', 'Text A'].join('\n'),
  );

  expect(cues).toHaveLength(1);
  expect(errors).toMatchInlineSnapshot(`
    [
      [Error: invalid value for cue setting \`align\` on line 3 (value: middle)],
    ]
  `);

  expect(cues[0].align).toBe('center');
});

// -------------------------------------------------------------------------------
// Unknown Setting
// -------------------------------------------------------------------------------

test('GOOD: unknown setting', async () => {
  const { cues, errors } = await parseText(
    ['WEBVTT', '', '00:00 --> 00:02 unknown:50%', 'Text A'].join('\n'),
  );
  expect(cues).toHaveLength(1);
  expect(errors).toMatchInlineSnapshot(`
    [
      [Error: unknown cue setting \`unknown\` on line 3 (value: 50%)],
    ]
  `);
});

// -------------------------------------------------------------------------------
// Multiple Settings
// -------------------------------------------------------------------------------

test('GOOD: single line settings', async () => {
  const { cues, errors } = await parseText(
    ['WEBVTT', '', '00:00 --> 00:02 line=50% align=end size=45%', 'Text A'].join('\n'),
  );

  expect(cues).toHaveLength(1);
  expect(errors).toBeNull();

  expect(cues[0].line).toBe(50);
  expect(cues[0].size).toBe(45);
  expect(cues[0].align).toBe('end');
});

test('GOOD: multiline settings', async () => {
  const { cues, errors } = await parseText(
    ['WEBVTT', '', '00:00 --> 00:02', 'line:50%', 'align:end', 'size:45%', 'Text A'].join('\n'),
  );

  expect(cues).toHaveLength(1);
  expect(errors).toBeNull();

  expect(cues[0].line).toBe(50);
  expect(cues[0].size).toBe(45);
  expect(cues[0].align).toBe('end');
  expect(cues[0].text).toBe('Text A');
});
