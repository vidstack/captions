import { parseText, renderVTTCueString } from 'media-captions';

test('GOOD: metadata tags', async () => {
  const { metadata, cues, errors } = await parseText(
    [
      '[ti:Song Title]',
      '[ar:The Artist]',
      '[al:The Album]',
      '[au:The Author]',
      '[by:Creator]',
      '[la:en]',
      '[length:03:45]',
      '[re:LRC Maker]',
      '[ve:1.0]',
      '',
      '[00:01.00]First line',
    ].join('\n'),
    { type: 'lrc' },
  );

  expect(errors).toHaveLength(0);
  expect(metadata).toEqual({
    ti: 'Song Title',
    ar: 'The Artist',
    al: 'The Album',
    au: 'The Author',
    by: 'Creator',
    la: 'en',
    length: '03:45',
    re: 'LRC Maker',
    ve: '1.0',
  });

  expect(cues).toHaveLength(1);
  expect(cues[0].startTime).toBe(1);
  // Last cue extends to the song length when it is later than the default duration.
  expect(cues[0].endTime).toBe(225);
  expect(cues[0].text).toBe('First line');
});

test('GOOD: metadata callback invoked once', async () => {
  const onHeaderMetadata = vi.fn();
  await parseText('[ti:Title]\n[00:01.00]One\n[00:02.00]Two', { type: 'lrc', onHeaderMetadata });
  expect(onHeaderMetadata).toHaveBeenCalledTimes(1);
  expect(onHeaderMetadata).toHaveBeenCalledWith({ ti: 'Title' });
});

test('GOOD: end times chain to next cue and last cue defaults to 5 seconds', async () => {
  const onCue = vi.fn();
  const { cues, errors } = await parseText(
    ['[00:12.00]Line one', '[00:17.50]Line two', '[01:02.250]Line three'].join('\n'),
    { type: 'lrc', onCue },
  );

  expect(errors).toHaveLength(0);
  expect(cues).toHaveLength(3);
  expect(onCue).toHaveBeenCalledTimes(3);

  expect(cues[0].startTime).toBe(12);
  expect(cues[0].endTime).toBe(17.5);
  expect(cues[0].text).toBe('Line one');

  expect(cues[1].startTime).toBe(17.5);
  expect(cues[1].endTime).toBe(62.25);
  expect(cues[1].text).toBe('Line two');

  expect(cues[2].startTime).toBe(62.25);
  expect(cues[2].endTime).toBe(67.25);
  expect(cues[2].text).toBe('Line three');
});

test('GOOD: multiple timestamps on one line repeat the text', async () => {
  const { cues, errors } = await parseText(
    ['[00:30.00][00:10.00][00:50.00]Chorus', '[00:20.00]Verse'].join('\n'),
    { type: 'lrc' },
  );

  expect(errors).toHaveLength(0);
  expect(cues.map((cue) => [cue.startTime, cue.endTime, cue.text])).toEqual([
    [10, 20, 'Chorus'],
    [20, 30, 'Verse'],
    [30, 50, 'Chorus'],
    [50, 55, 'Chorus'],
  ]);
});

test('GOOD: empty lyric lines terminate the previous cue', async () => {
  const { cues } = await parseText(['[00:10.00]Line', '[00:12.00]', '[00:20.00]Next'].join('\n'), {
    type: 'lrc',
  });

  expect(cues).toHaveLength(2);
  expect(cues[0].endTime).toBe(12);
  expect(cues[1].startTime).toBe(20);
});

test('GOOD: identical start times are kept', async () => {
  const { cues } = await parseText(['[00:10.00]A', '[00:10.00]B', '[00:15.00]C'].join('\n'), {
    type: 'lrc',
  });

  expect(cues).toHaveLength(3);
  expect(cues[0].endTime).toBe(15);
  expect(cues[1].endTime).toBe(15);
});

test('GOOD: offset is applied to cue and word times', async () => {
  const { cues } = await parseText(
    ['[offset:+500]', '[00:00.20]Early', '[00:10.00]Some <00:11.00>words'].join('\n'),
    { type: 'lrc' },
  );

  expect(cues).toHaveLength(2);
  // Clamped at zero.
  expect(cues[0].startTime).toBe(0);
  expect(cues[0].endTime).toBe(9.5);
  expect(cues[1].startTime).toBe(9.5);
  expect(cues[1].endTime).toBe(14.5);
  expect(cues[1].text).toBe('Some <00:00:10.500>words');
});

test('GOOD: negative offset shifts times later', async () => {
  const { cues } = await parseText(['[offset:-250]', '[00:01.00]Late'].join('\n'), {
    type: 'lrc',
  });
  expect(cues[0].startTime).toBe(1.25);
});

test('GOOD: enhanced word timing converts to WebVTT timestamp tags', async () => {
  const { cues, errors } = await parseText(
    ['[01:02.00]<01:02.00>Hello <01:02.50>there <01:03.10>world', '[01:05.00]Next'].join('\n'),
    { type: 'lrc' },
  );

  expect(errors).toHaveLength(0);
  expect(cues).toHaveLength(2);
  expect(cues[0].text).toBe('Hello <00:01:02.500>there <00:01:03.100>world');

  expect(renderVTTCueString(cues[0], 62.6)).toMatchInlineSnapshot(
    `"Hello <span data-part="timed" data-time="62.5" data-past="">there </span><span data-part="timed" data-time="63.1" data-future="">world</span>"`,
  );
});

test('GOOD: hours timestamp', async () => {
  const { cues } = await parseText('[01:02:03.50]Long song', { type: 'lrc' });
  expect(cues[0].startTime).toBe(3723.5);
});

test('GOOD: escapes special characters in text', async () => {
  const { cues } = await parseText('[00:01.00]Tom & Jerry <3 you', { type: 'lrc' });
  expect(cues[0].text).toBe('Tom &amp; Jerry &lt;3 you');
});

test('GOOD: lines without tags are ignored', async () => {
  const { cues, errors } = await parseText(
    ['Plain text', '[Chorus]', '[00:01.00]Line', 'More text'].join('\n'),
    { type: 'lrc' },
  );
  expect(errors).toHaveLength(0);
  expect(cues).toHaveLength(1);
  expect(cues[0].text).toBe('Line');
});

test('BAD: invalid timestamp is reported', async () => {
  const onError = vi.fn();
  const { cues, errors } = await parseText(
    ['[00:xx.00]Broken', '[00:99.00]Broken', '[00:01.00]Good'].join('\n'),
    { type: 'lrc', errors: true, onError },
  );

  expect(cues).toHaveLength(1);
  expect(errors).toHaveLength(2);
  expect(onError).toHaveBeenCalledTimes(2);
  expect(errors).toMatchInlineSnapshot(`
    [
      [Error: lyric timestamp \`00:xx.00\` is invalid on line 1],
      [Error: lyric timestamp \`00:99.00\` is invalid on line 2],
    ]
  `);
  expect(errors[0].code).toBe(2);
  expect(errors[0].line).toBe(1);
});

test('BAD: invalid timestamp throws in strict mode', async () => {
  await expect(
    parseText(['[00:01.00]Good', '[00:xx.00]Broken'].join('\n'), { type: 'lrc', strict: true }),
  ).rejects.toThrow('lyric timestamp `00:xx.00` is invalid on line 2');
});

test('BAD: errors are not collected when disabled', async () => {
  const { errors } = await parseText('[00:xx.00]Broken', { type: 'lrc', errors: false });
  expect(errors).toHaveLength(0);
});

test('GOOD: repeated lines shift their word timings to each repeat', async () => {
  const { cues } = await parseText('[00:10.00][00:20.00]<00:10.00>a <00:10.50>b', { type: 'lrc' });
  expect(cues[0].text).toBe('a <00:00:10.500>b');
  expect(cues[1].text).toBe('a <00:00:20.500>b');
});
