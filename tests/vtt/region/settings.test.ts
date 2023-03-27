import { parseText } from 'media-captions';

// -------------------------------------------------------------------------------
// ID Setting
// -------------------------------------------------------------------------------

test('GOOD: id setting', async () => {
  const { regions, errors } = await parseText(['WEBVTT', '', 'REGION id:foo'].join('\n'));
  expect(regions).toHaveLength(1);
  expect(errors).toHaveLength(0);
  expect(regions[0].id).toBe('foo');
});

// -------------------------------------------------------------------------------
// Width Setting
// -------------------------------------------------------------------------------

test('GOOD: width setting', async () => {
  const { regions, errors } = await parseText(['WEBVTT', '', 'REGION width:45'].join('\n'));
  expect(regions).toHaveLength(1);
  expect(errors).toHaveLength(0);
  expect(regions[0].width).toBe(45);
});

test('BAD: width setting', async () => {
  const { regions, errors } = await parseText(['WEBVTT', '', 'REGION width:NaN'].join('\n'));
  expect(regions).toHaveLength(1);
  expect(regions[0].width).toBe(100);
  expect(errors).toMatchInlineSnapshot(`
    [
      [Error: invalid value for region setting \`width\` on line 3 (value: NaN)],
    ]
  `);
});

// -------------------------------------------------------------------------------
// Line Setting
// -------------------------------------------------------------------------------

test('GOOD: lines setting', async () => {
  const { regions, errors } = await parseText(['WEBVTT', '', 'REGION lines:5'].join('\n'));
  expect(regions).toHaveLength(1);
  expect(errors).toHaveLength(0);
  expect(regions[0].lines).toBe(5);
});

test('BAD: lines setting', async () => {
  const { regions, errors } = await parseText(['WEBVTT', '', 'REGION lines:NaN'].join('\n'));
  expect(regions).toHaveLength(1);
  expect(regions[0].lines).toBe(3);
  expect(errors).toMatchInlineSnapshot(`
    [
      [Error: invalid value for region setting \`lines\` on line 3 (value: NaN)],
    ]
  `);
});

// -------------------------------------------------------------------------------
// Region Anchor Setting
// -------------------------------------------------------------------------------

test('GOOD: region anchor setting', async () => {
  const { regions, errors } = await parseText(
    ['WEBVTT', '', 'REGION regionanchor:10%,50%'].join('\n'),
  );
  expect(regions).toHaveLength(1);
  expect(errors).toHaveLength(0);
  expect(regions[0].regionAnchorX).toBe(10);
  expect(regions[0].regionAnchorY).toBe(50);
});

test('BAD: region anchor x setting', async () => {
  const { regions, errors } = await parseText(
    ['WEBVTT', '', 'REGION regionanchor:NaN,50%'].join('\n'),
  );
  expect(regions).toHaveLength(1);
  expect(regions[0].regionAnchorX).toBe(0);
  expect(regions[0].regionAnchorY).toBe(100);
  expect(errors).toMatchInlineSnapshot(`
    [
      [Error: invalid value for region setting \`regionanchor\` on line 3 (value: NaN,50%)],
    ]
  `);
});

test('BAD: region anchor y setting', async () => {
  const { regions, errors } = await parseText(
    ['WEBVTT', '', 'REGION regionanchor:50%,NaN'].join('\n'),
  );
  expect(regions).toHaveLength(1);
  expect(regions[0].regionAnchorX).toBe(0);
  expect(regions[0].regionAnchorY).toBe(100);
  expect(errors).toMatchInlineSnapshot(`
    [
      [Error: invalid value for region setting \`regionanchor\` on line 3 (value: 50%,NaN)],
    ]
  `);
});

// -------------------------------------------------------------------------------
// Viewport Anchor Setting
// -------------------------------------------------------------------------------

test('GOOD: viewport anchor setting', async () => {
  const { regions, errors } = await parseText(
    ['WEBVTT', '', 'REGION viewportanchor:10%,50%'].join('\n'),
  );
  expect(regions).toHaveLength(1);
  expect(errors).toHaveLength(0);
  expect(regions[0].viewportAnchorX).toBe(10);
  expect(regions[0].viewportAnchorY).toBe(50);
});

test('BAD: viewport anchor x setting', async () => {
  const { regions, errors } = await parseText(
    ['WEBVTT', '', 'REGION viewportanchor:NaN,50%'].join('\n'),
  );
  expect(regions).toHaveLength(1);
  expect(regions[0].viewportAnchorX).toBe(0);
  expect(regions[0].viewportAnchorY).toBe(100);
  expect(errors).toMatchInlineSnapshot(`
    [
      [Error: invalid value for region setting \`viewportanchor\` on line 3 (value: NaN,50%)],
    ]
  `);
});

test('BAD: viewport anchor y setting', async () => {
  const { regions, errors } = await parseText(
    ['WEBVTT', '', 'REGION viewportanchor:50%,NaN'].join('\n'),
  );
  expect(regions).toHaveLength(1);
  expect(regions[0].viewportAnchorX).toBe(0);
  expect(regions[0].viewportAnchorY).toBe(100);
  expect(errors).toMatchInlineSnapshot(`
    [
      [Error: invalid value for region setting \`viewportanchor\` on line 3 (value: 50%,NaN)],
    ]
  `);
});

// -------------------------------------------------------------------------------
// Scroll Setting
// -------------------------------------------------------------------------------

test('GOOD: scroll setting', async () => {
  const { regions, errors } = await parseText(['WEBVTT', '', 'REGION scroll:up'].join('\n'));
  expect(regions).toHaveLength(1);
  expect(errors).toHaveLength(0);
  expect(regions[0].scroll).toBe('up');
});

test('BAD: scroll setting', async () => {
  const { regions, errors } = await parseText(['WEBVTT', '', 'REGION scroll:nope'].join('\n'));
  expect(regions).toHaveLength(1);
  expect(regions[0].scroll).toBe('');
  expect(errors).toMatchInlineSnapshot(`
    [
      [Error: invalid value for region setting \`scroll\` on line 3 (value: nope)],
    ]
  `);
});

// -------------------------------------------------------------------------------
// Unknown Setting
// -------------------------------------------------------------------------------

test('GOOD: unknown setting', async () => {
  const { regions, errors } = await parseText(['WEBVTT', '', 'REGION unknown:50%'].join('\n'));
  expect(regions).toHaveLength(1);
  expect(errors).toMatchInlineSnapshot(`
    [
      [Error: unknown region setting \`unknown\` on line 3 (value: 50%)],
    ]
  `);
});
