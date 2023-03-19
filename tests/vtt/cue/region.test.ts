import { parseText } from '../../../src/parse/parse-text';

test('GOOD: associate cue with region', async () => {
  const { cues, regions, errors } = await parseText(
    [
      'WEBVTT',
      '',
      'REGION id:foo',
      '',
      'REGION id:bar',
      '',
      '00:00 --> 00:02 region:foo',
      'Text...',
      '',
      '00:02 --> 00:04 region:bar',
      'Text...',
    ].join('\n'),
  );

  expect(errors).toBeNull();
  expect(regions).toHaveLength(2);
  expect(cues).toHaveLength(2);

  expect(regions[0].id).toBe('foo');
  expect(cues[0].region).toBe(regions[0]);

  expect(regions[1].id).toBe('bar');
  expect(cues[1].region).toBe(regions[1]);
});

test('GOOD: disassociate region from cue if no longer valid', async () => {
  const { cues, regions, errors } = await parseText(
    [
      'WEBVTT',
      '',
      'REGION id:foo',
      '',
      'NOTE: no vertical regions',
      '',
      '00:00 --> 00:02 region:foo vertical:rl',
      'Text...',
      '',
      'NOTE: cue has been explicitly positioned with a line offset and thus drops out of the region',
      '',
      '00:02 --> 00:04 region:foo line:50%',
      'Text...',
      '',
      'NOTE: cue has been explicitly sized and thus drops out of the region',
      '',
      '00:04 --> 00:06 region:foo size:50%',
      'Text...',
      '',
      '00:06 --> 00:08 region:foo',
      'Text...',
    ].join('\n'),
  );

  expect(errors).toBeNull();
  expect(regions).toHaveLength(1);
  expect(cues).toHaveLength(4);

  expect(cues[0].region).toBeNull();
  expect(cues[1].region).toBeNull();
  expect(cues[2].region).toBeNull();
  expect(cues[3].region).toBe(regions[0]);
});
