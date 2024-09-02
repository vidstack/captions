import { parseText } from 'media-captions';

test('GOOD: header is missing in non-strict mode', async () => {
  const { cues, errors } = await parseText(['', '00:00 --> 00:01', 'Lorem ipsum...'].join('\n'), {
    errors: true,
  });
  expect(cues).toHaveLength(1);
  expect(errors).toHaveLength(0);
});

test('BAD: should throw in strict mode if header is missing', async () => {
  await expect(() =>
    parseText(['', '00:00 --> 00:01', 'Lorem ipsum...'].join('\n'), { strict: true }),
  ).rejects.toThrowError();
});

test('GOOD: parse header metadata with : and =', async () => {
  const { errors, metadata, cues } = await parseText(
    ['WEBVTT', 'Kind: Language', 'Language= en-US'].join('\n'),
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

test('GOOD: parse header metadata with proper trimming', async () => {
  const { errors, metadata, cues } = await parseText(
    ['WEBVTT', 'Message:Hello World! ', ' My Property : Value '].join('\n'),
  );

  expect(errors).toHaveLength(0);
  expect(cues).toHaveLength(0);

  expect(metadata).toStrictEqual({
    'Message': 'Hello World!',
    'My Property': 'Value',
  });
});

test('GOOD: parse header metadata with value containing = or :', async () => {
  const { errors, metadata, cues } = await parseText(
    ['WEBVTT', 'Key1: Value with = sign', 'Key2: Value with : colon'].join('\n'),
  );

  expect(errors).toHaveLength(0);
  expect(cues).toHaveLength(0);

  expect(metadata).toStrictEqual({
    "Key1": "Value with = sign",
    "Key2": "Value with : colon",
  });
});

test('GOOD: parse header metadata with JSON and "=" in value', async () => {
  const { errors, metadata, cues } = await parseText(
    ['WEBVTT', 
     'X-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:0',
     'Json: {"a": 1, "b": 2}',
     'Eval: 1 + 1 = 2'].join('\n'),
  );

  expect(errors).toHaveLength(0);
  expect(cues).toHaveLength(0);

  expect(metadata).toStrictEqual({
    "X-TIMESTAMP-MAP": "LOCAL:00:00:00.000,MPEGTS:0",
    "Json": '{"a": 1, "b": 2}',
    "Eval": "1 + 1 = 2",
  });
});