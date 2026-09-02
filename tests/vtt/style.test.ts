import { parseText, transformVTTStyle } from 'media-captions';

test('collects STYLE blocks in order and keeps parsing cues', async () => {
  const styles: string[] = [];
  const result = await parseText(
    [
      'WEBVTT',
      '',
      'STYLE',
      '::cue {',
      '  background-image: linear-gradient(to bottom, dimgray, lightgray);',
      '  color: papayawhip;',
      '}',
      '',
      'STYLE',
      '::cue(b) { color: peachpuff; }',
      '',
      'NOTE comment',
      '',
      '00:00.000 --> 00:02.000',
      '<b>Hello</b>',
      '',
    ].join('\n'),
    { onStyle: (css) => styles.push(css) },
  );

  expect(result.cues).toHaveLength(1);
  expect(result.styles).toEqual([
    '::cue {\n  background-image: linear-gradient(to bottom, dimgray, lightgray);\n  color: papayawhip;\n}',
    '::cue(b) { color: peachpuff; }',
  ]);
  expect(styles).toEqual(result.styles);
});

test('recovers when the blank line after a STYLE block is missing', async () => {
  const result = await parseText(
    ['WEBVTT', '', 'STYLE', '::cue { color: red }', '00:00.000 --> 00:02.000', 'Hi', ''].join('\n'),
  );
  expect(result.styles).toEqual(['::cue { color: red }']);
  expect(result.cues).toHaveLength(1);
  expect(result.cues[0].text).toBe('Hi');
});

describe('transformVTTStyle', () => {
  const scope = '[data-scope="mc1"]';

  test('rewrites ::cue and ::cue(selector)', () => {
    expect(
      transformVTTStyle(
        '::cue { color: red; } ::cue(b) { font-weight: bold } ::cue(.yellow) { color: yellow }',
        scope,
      ),
    ).toBe(
      [
        '[data-scope="mc1"] [data-part="cue"] {\n  color: red;\n}',
        '[data-scope="mc1"] [data-part="cue"] b {\n  font-weight: bold;\n}',
        '[data-scope="mc1"] [data-part="cue"] .yellow {\n  color: yellow;\n}',
      ].join('\n'),
    );
  });

  test('maps voice, class, timed, id, and region selectors to rendered markup', () => {
    const css = [
      '::cue(v[voice="Bob"]) { color: lime }',
      '::cue(v) { font-style: italic }',
      '::cue(c.foo) { color: cyan }',
      '::cue(:past) { color: gray }',
      '::cue(#intro) { color: white }',
      '::cue-region { background: black }',
      '::cue-region(#top) { opacity: 0.5 }',
    ].join('\n');

    expect(transformVTTStyle(css, scope)).toBe(
      [
        '[data-scope="mc1"] [data-part="cue"] [data-part="voice"][title="Bob"] {\n  color: lime;\n}',
        '[data-scope="mc1"] [data-part="cue"] [data-part="voice"] {\n  font-style: italic;\n}',
        '[data-scope="mc1"] [data-part="cue"] span.foo {\n  color: cyan;\n}',
        '[data-scope="mc1"] [data-part="cue"] [data-part="timed"][data-past] {\n  color: gray;\n}',
        '[data-scope="mc1"] [data-part="cue"][data-id="intro"] {\n  color: white;\n}',
        '[data-scope="mc1"] [data-part="region"] {\n  background: black;\n}',
        '[data-scope="mc1"] [data-part="region"][data-id="top"] {\n  opacity: 0.5;\n}',
      ].join('\n'),
    );
  });

  test('drops non-cue selectors, disallowed properties, and external resources', () => {
    const css = [
      'body { display: none }',
      '::cue { position: fixed; color: red; background-image: url(https://evil.example/pixel.png); width: 100vw }',
      '@import url("x.css");',
      '::cue { }',
    ].join('\n');
    expect(transformVTTStyle(css, scope)).toBe(
      '[data-scope="mc1"] [data-part="cue"] {\n  color: red;\n}',
    );
  });

  test('escapes attribute values', () => {
    expect(transformVTTStyle('::cue(#a"b) { color: red }', scope)).toBe(
      '[data-scope="mc1"] [data-part="cue"][data-id="a\\"b"] {\n  color: red;\n}',
    );
  });
});
