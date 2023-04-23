import { parseText } from 'media-captions';

test('GOOD: parse blocks', async () => {
  const { errors, cues } = await parseText(
    `
[Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,36,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1

[Other Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Other,Arial,24,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,-1,-1,-1,100,100,0,0,1,2,2,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:05.10,0:00:07.20,Default,,0,0,0,,Hello, world!

[Second Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,1:10:05.10,1:20:08,Other,,0,0,0,,Never!
This is text on a new line.
And, another line.

[Third Events]
Format: Start, End, Text
Dialogue: 0:00:04,\t0:00:07.20, One!
Dialogue: 0:00:05,\t0:00:08.20, Two!
Dialogue: 0:00:06,\t0:00:09.20, Three!
New line of text on three.

Dialogue: 0:00:08,\t0:00:09.20, Four!
`,
    { type: 'ssa' },
  );

  expect(cues).toHaveLength(6);
  expect(errors).toHaveLength(0);

  expect(cues[0].startTime).toBe(5.1);
  expect(cues[0].endTime).toBe(7.2);
  expect(cues[0].text).toBe('Hello, world!');
  delete cues[0].style!['--cue-text-shadow'];
  expect(cues[0].style).toMatchInlineSnapshot(`
    {
      "--cue-bg-color": "none",
      "--cue-bottom": "10px",
      "--cue-color": "rgba(255,255,255,1)",
      "--cue-left": "10px",
      "--cue-line-height": "normal",
      "--cue-padding-y": "0",
      "--cue-right": "10px",
      "--cue-text-align": "center",
      "--cue-transform": "scaleX(1) scaleY(1) rotate(0deg)",
      "--cue-white-space": "normal",
      "--cue-width": "auto",
      "font-family": "Arial",
      "font-size": "calc(36 / var(--overlay-height))",
      "letter-spacing": "0px",
    }
  `);

  expect(cues[1].startTime).toBe(4205.1);
  expect(cues[1].endTime).toBe(4808);
  expect(cues[1].text).toBe('Never!\nThis is text on a new line.\nAnd, another line.');
  delete cues[1].style!['--cue-text-shadow'];
  expect(cues[1].style).toMatchInlineSnapshot(`
    {
      "--cue-bg-color": "none",
      "--cue-bottom": "10px",
      "--cue-color": "rgba(255,255,255,1)",
      "--cue-left": "10px",
      "--cue-line-height": "normal",
      "--cue-padding-y": "0",
      "--cue-right": "10px",
      "--cue-text-align": "center",
      "--cue-transform": "scaleX(1) scaleY(1) rotate(0deg)",
      "--cue-white-space": "normal",
      "--cue-width": "auto",
      "font-family": "Arial",
      "font-size": "calc(24 / var(--overlay-height))",
      "font-style": "italic",
      "font-weight": "bold",
      "letter-spacing": "0px",
      "text-decoration": "line-through",
    }
  `);

  expect(cues[2].startTime).toBe(4);
  expect(cues[2].endTime).toBe(7.2);
  expect(cues[2].text).toBe('One!');
  expect(cues[2].style).toBeUndefined();

  expect(cues[3].startTime).toBe(5);
  expect(cues[3].endTime).toBe(8.2);
  expect(cues[3].text).toBe('Two!');
  expect(cues[3].style).toBeUndefined();

  expect(cues[4].startTime).toBe(6);
  expect(cues[4].endTime).toBe(9.2);
  expect(cues[4].text).toBe('Three!\nNew line of text on three.');
  expect(cues[4].style).toBeUndefined();

  expect(cues[5].startTime).toBe(8);
  expect(cues[5].endTime).toBe(9.2);
  expect(cues[5].text).toBe('Four!');
  expect(cues[5].style).toBeUndefined();
});

test('BAD: events block missing format line', async () => {
  const { errors, cues } = await parseText(
    `
[Events]
Dialogue: 0,1:10:05.10,1:20:08,Other,,0,0,0,,Never!
Dialogue: 0,1:10:05.10,1:20:08,Other,,0,0,0,,Never!

[Second Events]
Format: Start, End, Text
Dialogue: 0:00:05.10,0:00:07.20,Hello, world!
`,
    { type: 'ssa' },
  );

  expect(cues).toHaveLength(1);
  expect(errors).toHaveLength(2);
  expect(errors).toMatchInlineSnapshot(`
    [
      [Error: format missing for \`Dialogue\` block on line 3],
      [Error: format missing for \`Dialogue\` block on line 4],
    ]
  `);
});

test('BAD: styles block missing format line', async () => {
  const { errors, cues } = await parseText(
    `
[Styles]
Style: Default,Arial,36,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1

[Events]
Format: Start, End, Text
Dialogue: 0:00:05.10,0:00:07.20,Hello, world!
`,
    { type: 'ssa' },
  );

  expect(cues).toHaveLength(1);
  expect(errors).toHaveLength(1);
  expect(errors).toMatchInlineSnapshot(`
    [
      [Error: format missing for \`Style\` block on line 3],
    ]
  `);
});

test('GOOD: parse timestamp milliseconds correctly', async () => {
  const { errors, cues } = await parseText(
    `
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:03.67,0:00:06.04,Default,,0,0,0,,Hello, world!
`,
    { type: 'ssa' },
  );

  expect(errors).toHaveLength(0);
  expect(cues[0].startTime).toBe(3.67);
  expect(cues[0].endTime).toBe(6.04);
});
