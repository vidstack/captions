import { inferCaptionsFormat, parseText, renderVTTCueString } from 'media-captions';

test('GOOD: frame rate header converts frames to seconds', async () => {
  const onCue = vi.fn(),
    onHeaderMetadata = vi.fn();

  const { cues, errors, metadata, regions } = await parseText(
    ['{1}{1}25.000', '{25}{50}Hello|World', '', '{75}{100}Second'].join('\n'),
    { type: 'sub', onCue, onHeaderMetadata },
  );

  expect(errors).toHaveLength(0);
  expect(regions).toHaveLength(0);
  expect(metadata).toEqual({ FrameRate: '25' });
  expect(onHeaderMetadata).toHaveBeenCalledWith({ FrameRate: '25' });
  expect(onCue).toHaveBeenCalledTimes(2);

  expect(cues.map((cue) => [cue.startTime, cue.endTime, cue.text])).toEqual([
    [1, 2, 'Hello\nWorld'],
    [3, 4, 'Second'],
  ]);
});

test('GOOD: frame rate header accepts a decimal comma', async () => {
  const { cues, metadata } = await parseText('{1}{1}23,976\n{23976}{47952}X', { type: 'sub' });
  expect(metadata.FrameRate).toBe('23.976');
  expect(cues[0].startTime).toBe(1000);
  expect(cues[0].endTime).toBe(2000);
});

test('GOOD: defaults to 23.976 fps without a header', async () => {
  const { cues, metadata } = await parseText('{0}{23976}Text\n{24}{48}Next', { type: 'sub' });
  expect(metadata).toEqual({ FrameRate: '23.976' });
  expect(cues[0].startTime).toBe(0);
  expect(cues[0].endTime).toBe(1000);
  expect(cues[1].startTime).toBe(1.001);
  expect(cues[1].endTime).toBe(2.002);
});

test('GOOD: per-line formatting codes', async () => {
  const { cues } = await parseText(
    '{1}{1}25\n{25}{50}{y:i}Italic line|{y:b,u}Bold under|Plain|{y:U}Upper flag',
    { type: 'sub' },
  );
  expect(cues[0].text).toBe(
    '<i>Italic line</i>\n<b><u>Bold under</u></b>\nPlain\n<u>Upper flag</u>',
  );
});

test('GOOD: whole-subtitle formatting codes apply to every line', async () => {
  const { cues } = await parseText('{25}{50}{Y:i}First|Second', { type: 'sub' });
  expect(cues[0].text).toBe('<i>First</i>\n<i>Second</i>');
});

test('GOOD: BGR colours become RGB colour classes', async () => {
  const { cues } = await parseText(
    [
      '{25}{50}{c:$0000FF}Red|{c:$ff0000}Blue',
      '{60}{70}{C:$00ff00}Green|Also green|{c:$00ffff}Yellow',
    ].join('\n'),
    { type: 'sub' },
  );

  expect(cues[0].text).toBe('<c.#ff0000>Red</c>\n<c.#0000ff>Blue</c>');
  expect(cues[1].text).toBe(
    '<c.#00ff00>Green</c>\n<c.#00ff00>Also green</c>\n<c.#ffff00>Yellow</c>',
  );
  expect(renderVTTCueString(cues[0])).toBe(
    '<span style="color: #ff0000;">Red</span>\n<span style="color: #0000ff;">Blue</span>',
  );
});

test('GOOD: colour and style codes nest', async () => {
  const { cues } = await parseText('{25}{50}{c:$0000ff}{y:i,b}Red bold italic', { type: 'sub' });
  expect(cues[0].text).toBe('<c.#ff0000><b><i>Red bold italic</i></b></c>');
});

test('GOOD: font and size become per-cue spans', async () => {
  const { cues } = await parseText(
    ['{25}{50}{f:Arial}{s:36}Big Arial|{s:12}Small|{y:s}Struck|Plain'].join('\n'),
    { type: 'sub' },
  );

  expect(cues[0].text).toBe('<c.s-1>Big Arial</c>\n<c.s-2>Small</c>\n<c.s-3>Struck</c>\nPlain');
  expect(cues[0].spans).toEqual({
    '1': { fontFamily: 'Arial', fontSize: { unit: 'em', value: 1.5 } },
    '2': { fontSize: { unit: 'em', value: 0.5 } },
    '3': { strike: true },
  });
});

test('GOOD: whole-subtitle font applies to every line', async () => {
  const { cues } = await parseText('{25}{50}{F:Courier New}One|Two', { type: 'sub' });
  expect(cues[0].text).toBe('<c.s-1>One</c>\n<c.s-2>Two</c>');
  expect(cues[0].spans).toEqual({
    '1': { fontFamily: 'Courier New' },
    '2': { fontFamily: 'Courier New' },
  });
});

test('GOOD: position becomes a fixed layout on a 640x480 canvas', async () => {
  const { cues } = await parseText(
    [
      '{25}{50}{P:320,432}Bottom center|Second line',
      '{60}{70}One|{p:64,48}Lower-case fallback',
    ].join('\n'),
    { type: 'sub' },
  );
  expect(cues[0].layout).toEqual({ left: 50, top: 90, fixed: true });
  expect(cues[0].text).toBe('Bottom center\nSecond line');
  expect(cues[1].layout).toEqual({ left: 10, top: 10, fixed: true });
  expect(cues[1].text).toBe('One\nLower-case fallback');
});

test('GOOD: unknown control codes are dropped', async () => {
  const { cues } = await parseText('{25}{50}{o:1,2}{H:cp1250}{x:foo}Text', { type: 'sub' });
  expect(cues[0].text).toBe('Text');
  expect(cues[0].layout).toBeUndefined();
  expect(cues[0].spans).toBeUndefined();
});

test('GOOD: escapes special characters in text', async () => {
  const { cues } = await parseText('{25}{50}Tom & Jerry <3', { type: 'sub' });
  expect(cues[0].text).toBe('Tom &amp; Jerry &lt;3');
});

test('GOOD: CRLF input and surrounding whitespace', async () => {
  const { cues, errors } = await parseText('{1}{1}25\r\n  {25}{50}One  \r\n{50}{75}Two\r\n', {
    type: 'sub',
  });
  expect(errors).toHaveLength(0);
  expect(cues.map((cue) => cue.text)).toEqual(['One', 'Two']);
});

test('GOOD: `microdvd` type alias', async () => {
  const { cues } = await parseText('{1}{1}25\n{25}{50}Alias', { type: 'microdvd' });
  expect(cues).toHaveLength(1);
  expect(cues[0].startTime).toBe(1);
  expect(cues[0].text).toBe('Alias');
});

test('GOOD: format inference from extension', () => {
  expect(inferCaptionsFormat('text/plain', '/captions/x.sub')).toBe('sub');
  expect(inferCaptionsFormat('application/x-microdvd')).toBe('sub');
});

test('BAD: lines that are not subtitles are reported and skipped', async () => {
  const onError = vi.fn();
  const { cues, errors } = await parseText(
    ['{1}{1}25', 'garbage line', '{25}{50}Good', '{30}Half', '[1][2]Other'].join('\n'),
    { type: 'sub', errors: true, onError },
  );

  expect(cues).toHaveLength(1);
  expect(cues[0].text).toBe('Good');
  expect(errors).toHaveLength(3);
  expect(onError).toHaveBeenCalledTimes(3);
  expect(errors[0].code).toBe(4);
  expect(errors[0].line).toBe(2);
  expect(errors).toMatchInlineSnapshot(`
    [
      [Error: expected subtitle line \`{start}{end}Text\` on line 2],
      [Error: expected subtitle line \`{start}{end}Text\` on line 4],
      [Error: expected subtitle line \`{start}{end}Text\` on line 5],
    ]
  `);
});

test('BAD: end before start is reported but the cue is kept', async () => {
  const { cues, errors } = await parseText('{1}{1}25\n{50}{25}Backwards', {
    type: 'sub',
    errors: true,
  });

  expect(cues).toHaveLength(1);
  expect(cues[0].startTime).toBe(2);
  expect(cues[0].endTime).toBe(1);
  expect(errors).toHaveLength(1);
  expect(errors[0].code).toBe(2);
  expect(errors[0].line).toBe(2);
  expect(errors[0].message).toBe('subtitle end frame `25` is before start frame `50` on line 2');
});

test('BAD: malformed line throws in strict mode', async () => {
  await expect(
    parseText('{1}{1}25\n{25}{50}Good\nnot a subtitle', { type: 'sub', strict: true }),
  ).rejects.toThrow('expected subtitle line `{start}{end}Text` on line 3');
});

test('BAD: errors are not collected when disabled', async () => {
  const { errors } = await parseText('garbage', { type: 'sub', errors: false });
  expect(errors).toHaveLength(0);
});
