import { parseText } from 'media-captions';

test('GOOD: header is missing in non-strict mode', async () => {
  const { cues, errors } = await parseText(['', '00:00 --> 00:01', 'Lorem ipsum...'].join('\n'), {
    errors: true,
  });
  expect(cues).toHaveLength(1);
  // Tolerant: the file still plays but the missing signature is reported.
  expect(errors.map((e) => e.message)).toEqual(['missing WEBVTT file header']);
});

test('BAD: should throw in strict mode if header is missing', async () => {
  await expect(() =>
    parseText(['', '00:00 --> 00:01', 'Lorem ipsum...'].join('\n'), { strict: true }),
  ).rejects.toThrowError();
});

test('GOOD: parse header metadata', async () => {
  const { errors, metadata, cues } = await parseText(
    ['WEBVTT', 'Kind: Language', 'Language:en-US'].join('\n'),
  );

  expect(errors).toHaveLength(0);
  expect(cues).toHaveLength(0);

  expect(metadata).toMatchInlineSnapshot(`
    {
      "Kind": "Language",
      "Language": "en-US",
    }
  `);
});
