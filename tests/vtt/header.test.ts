import { parseText } from '../../src/parse/parse-text';

test('BAD: header is missing', async () => {
  const { cues, errors } = await parseText(['', '00:00 --> 00:01', 'Lorem ipsum...'].join('\n'));
  expect(cues).toHaveLength(0);
  expect(errors).toMatchInlineSnapshot(`
    [
      [Error: missing WEBVTT file header],
    ]
  `);
});

test('GOOD: parse header metadata', async () => {
  const { errors, metadata, cues } = await parseText(
    ['WEBVTT', 'Kind: Language', 'Language:en-US'].join('\n'),
  );

  expect(errors).toBeNull();
  expect(cues).toHaveLength(0);

  expect(metadata).toMatchInlineSnapshot(`
    {
      "Kind": "Language",
      "Language": "en-US",
    }
  `);
});
