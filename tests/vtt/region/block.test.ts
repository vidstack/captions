import { parseText } from 'media-captions';

test('GOOD: single line region block', async () => {
  const { errors, regions } = await parseText(
    ['WEBVTT', '', 'REGION id:foo width:40% lines:10'].join('\n'),
  );
  expect(errors).toBeNull();
  expect(regions).toHaveLength(1);
  expect(regions[0].id).toBe('foo');
  expect(regions[0].width).toBe(40);
  expect(regions[0].lines).toBe(10);
});

test('GOOD: multiline region block', async () => {
  const { errors, regions } = await parseText(
    ['WEBVTT', '', 'REGION', 'id:foo', 'width:40%', 'lines:10'].join('\n'),
  );
  expect(errors).toBeNull();
  expect(regions).toHaveLength(1);
  expect(regions[0].id).toBe('foo');
  expect(regions[0].width).toBe(40);
  expect(regions[0].lines).toBe(10);
});

test('GOOD: multiple region blocks', async () => {
  const { errors, regions } = await parseText(
    ['WEBVTT', '', 'REGION id:foo', '', 'REGION', 'id:bar'].join('\n'),
  );
  expect(errors).toBeNull();
  expect(regions).toHaveLength(2);
  expect(regions[0].id).toBe('foo');
  expect(regions[1].id).toBe('bar');
});
