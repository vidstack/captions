import { parseText } from 'media-captions';

test('GOOD: valid timestamp', async () => {
  const { cues, errors } = await parseText(['1', '00:00:00 --> 00:00:02,200', 'Text'].join('\n'), {
    strict: true,
    type: 'srt',
  });
  expect(cues).toHaveLength(1);
  expect(cues[0].id).toBe('1');
  expect(cues[0].startTime).toBe(0);
  expect(cues[0].endTime).toBe(2.2);
  expect(errors).toHaveLength(0);
});
