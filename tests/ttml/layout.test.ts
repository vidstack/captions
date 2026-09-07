import { parseText } from 'media-captions';

const TTML_NS =
  'xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling" ' +
  'xmlns:ttp="http://www.w3.org/ns/ttml#parameter"';

test('GOOD: cell units resolve against ttp:cellResolution', async () => {
  const { cues, errors } = await parseText(
    `<tt ${TTML_NS} ttp:cellResolution="40 24">
  <head>
    <layout>
      <region xml:id="r" tts:origin="4c 18c" tts:extent="32c 3c" tts:displayAlign="after" tts:padding="1c 0.5c"/>
    </layout>
  </head>
  <body>
    <div>
      <p begin="0s" end="1s" region="r" tts:fontSize="1c">Cells</p>
    </div>
  </body>
</tt>`,
    { type: 'ttml', errors: true },
  );

  expect(errors).toHaveLength(0);
  expect(cues).toHaveLength(1);

  // 4/40 = 10%, 18/24 = 75%, 32/40 = 80%, 3/24 = 12.5%, then the padding insets the box by
  // 0.5/40 = 1.25% on the sides and 1/24 = 4.1667% on the top and bottom.
  expect(cues[0].snapToLines).toBe(false);
  expect(cues[0].position).toBeCloseTo(11.25);
  expect(cues[0].size).toBeCloseTo(77.5);
  expect(cues[0].line).toBeCloseTo(87.5 - 100 / 24);
  expect(cues[0].lineAlign).toBe('end');
  expect(cues[0].vertical).toBe('');
  expect(cues[0].textStyle).toEqual({ fontSize: 'calc(var(--overlay-height) * 0.04167)' });
});

test('GOOD: font sizes in %, c, px and em', async () => {
  const { cues, errors } = await parseText(
    `<tt ${TTML_NS} tts:extent="1280px 720px">
  <head>
    <styling>
      <style xml:id="pct" tts:fontSize="80%"/>
      <style xml:id="cell" tts:fontSize="1c"/>
    </styling>
  </head>
  <body>
    <div>
      <p begin="0s" end="1s" style="pct">percent</p>
      <p begin="1s" end="2s" style="cell">cell</p>
      <p begin="2s" end="3s" tts:fontSize="36px">pixels</p>
      <p begin="3s" end="4s" tts:fontSize="1.5em">em</p>
      <p begin="4s" end="5s" tts:fontSize="1c 2c">two values</p>
      <p begin="5s" end="6s" tts:fontSize="12pt">unsupported</p>
      <p begin="6s" end="7s">none</p>
    </div>
  </body>
</tt>`,
    { type: 'ttml', errors: true },
  );

  expect(errors).toHaveLength(0);
  expect(cues).toHaveLength(7);

  expect(cues[0].textStyle).toEqual({ fontSize: 'calc(var(--overlay-height) * 0.05 * 0.8)' });
  // Default cell resolution is 32x15.
  expect(cues[1].textStyle).toEqual({ fontSize: 'calc(var(--overlay-height) * 0.06667)' });
  // 36 / 720
  expect(cues[2].textStyle).toEqual({ fontSize: 'calc(var(--overlay-height) * 0.05)' });
  expect(cues[3].textStyle).toEqual({ fontSize: '1.5em' });
  // Second (vertical) value wins: 2 / 15.
  expect(cues[4].textStyle).toEqual({ fontSize: 'calc(var(--overlay-height) * 0.13333)' });
  expect(cues[5].textStyle).toBeUndefined();
  expect(cues[6].textStyle).toBeUndefined();
});

test('GOOD: px font size falls back to the default 1080px root height', async () => {
  const { cues, errors } = await parseText(
    `<tt ${TTML_NS}>
  <body>
    <div style="s">
      <p begin="0s" end="1s" tts:fontSize="54px">pixels</p>
    </div>
  </body>
</tt>`,
    { type: 'ttml', errors: true },
  );

  expect(errors).toHaveLength(0);
  expect(cues[0].textStyle).toEqual({ fontSize: 'calc(var(--overlay-height) * 0.05)' });
});

test('GOOD: font size is inherited from region and container', async () => {
  const { cues, errors } = await parseText(
    `<tt ${TTML_NS}>
  <head>
    <layout>
      <region xml:id="r" tts:origin="0% 0%" tts:extent="100% 100%" tts:fontSize="200%"/>
      <!-- A second region so paragraphs without a region get the default layout. -->
      <region xml:id="unused" tts:origin="0% 0%" tts:extent="100% 100%"/>
    </layout>
  </head>
  <body tts:fontSize="50%">
    <div>
      <p begin="0s" end="1s">from body</p>
      <p begin="1s" end="2s" region="r">from region</p>
      <p begin="2s" end="3s" region="r" tts:fontSize="1em">own</p>
    </div>
  </body>
</tt>`,
    { type: 'ttml', errors: true },
  );

  expect(errors).toHaveLength(0);
  expect(cues[0].textStyle).toEqual({ fontSize: 'calc(var(--overlay-height) * 0.05 * 0.5)' });
  expect(cues[1].textStyle).toEqual({ fontSize: 'calc(var(--overlay-height) * 0.05 * 2)' });
  expect(cues[2].textStyle).toEqual({ fontSize: '1em' });
});

test('GOOD: tbrl writing mode maps to vertical rl with swapped axes', async () => {
  const { cues, errors } = await parseText(
    `<tt ${TTML_NS} xml:lang="ja">
  <head>
    <layout>
      <region xml:id="before" tts:origin="80% 10%" tts:extent="10% 80%" tts:writingMode="tbrl" tts:displayAlign="before" tts:textAlign="start"/>
      <region xml:id="after" tts:origin="80% 10%" tts:extent="10% 80%" tts:writingMode="tbrl" tts:displayAlign="after"/>
      <region xml:id="center" tts:origin="80% 10%" tts:extent="10% 80%" tts:writingMode="tb" tts:displayAlign="center"/>
    </layout>
  </head>
  <body>
    <div>
      <p begin="0s" end="1s" region="before">縦書き</p>
      <p begin="1s" end="2s" region="after">縦書き</p>
      <p begin="2s" end="3s" region="center">縦書き</p>
    </div>
  </body>
</tt>`,
    { type: 'ttml', errors: true },
  );

  expect(errors).toHaveLength(0);
  expect(cues).toHaveLength(3);

  for (const cue of cues) {
    expect(cue.vertical).toBe('rl');
    expect(cue.snapToLines).toBe(false);
    // position/size come from the vertical region box (origin-y / extent-h).
    expect(cue.position).toBe(10);
    expect(cue.positionAlign).toBe('line-left');
    expect(cue.size).toBe(80);
  }

  // Block progression is right->left: `before` is the right edge of the region.
  expect(cues[0].line).toBe(90);
  expect(cues[0].lineAlign).toBe('end');
  expect(cues[0].align).toBe('start');

  // `after` is the left edge.
  expect(cues[1].line).toBe(80);
  expect(cues[1].lineAlign).toBe('start');

  expect(cues[2].line).toBe(85);
  expect(cues[2].lineAlign).toBe('center');
});

test('GOOD: tblr writing mode maps to vertical lr', async () => {
  const { cues, errors } = await parseText(
    `<tt ${TTML_NS}>
  <head>
    <layout>
      <region xml:id="before" tts:origin="10% 10%" tts:extent="10% 80%" tts:writingMode="tblr" tts:displayAlign="before"/>
      <region xml:id="after" tts:origin="10% 10%" tts:extent="10% 80%" tts:writingMode="tblr" tts:displayAlign="after"/>
      <region xml:id="center" tts:origin="10% 10%" tts:extent="10% 80%" tts:writingMode="tblr" tts:displayAlign="center"/>
    </layout>
  </head>
  <body>
    <div>
      <p begin="0s" end="1s" region="before">A</p>
      <p begin="1s" end="2s" region="after">B</p>
      <p begin="2s" end="3s" region="center">C</p>
    </div>
  </body>
</tt>`,
    { type: 'ttml', errors: true },
  );

  expect(errors).toHaveLength(0);
  expect(cues).toHaveLength(3);

  for (const cue of cues) {
    expect(cue.vertical).toBe('lr');
    expect(cue.position).toBe(10);
    expect(cue.size).toBe(80);
  }

  // Block progression is left->right: `before` is origin-x.
  expect(cues[0].line).toBe(10);
  expect(cues[0].lineAlign).toBe('start');
  expect(cues[1].line).toBe(20);
  expect(cues[1].lineAlign).toBe('end');
  expect(cues[2].line).toBe(15);
  expect(cues[2].lineAlign).toBe('center');
});

test('GOOD: horizontal and inherited writing modes', async () => {
  const { cues, errors } = await parseText(
    `<tt ${TTML_NS}>
  <head>
    <layout>
      <region xml:id="r" tts:origin="10% 70%" tts:extent="80% 20%" tts:displayAlign="after"/>
      <!-- A second region so paragraphs without a region get the default layout. -->
      <region xml:id="unused" tts:origin="0% 0%" tts:extent="100% 100%"/>
    </layout>
  </head>
  <body>
    <div tts:writingMode="rltb">
      <p begin="0s" end="1s" region="r">rltb</p>
    </div>
    <div tts:writingMode="tbrl">
      <p begin="1s" end="2s" region="r">inherited tbrl</p>
      <p begin="2s" end="3s">no region</p>
    </div>
  </body>
</tt>`,
    { type: 'ttml', errors: true },
  );

  expect(errors).toHaveLength(0);
  expect(cues).toHaveLength(3);

  expect(cues[0].vertical).toBe('');
  expect(cues[0].line).toBe(90);
  expect(cues[0].lineAlign).toBe('end');
  expect(cues[0].position).toBe(10);
  expect(cues[0].size).toBe(80);

  expect(cues[1].vertical).toBe('rl');
  expect(cues[1].position).toBe(70);
  expect(cues[1].size).toBe(20);
  // rl + after -> origin-x.
  expect(cues[1].line).toBe(10);
  expect(cues[1].lineAlign).toBe('start');

  expect(cues[2].vertical).toBe('rl');
  expect(cues[2].snapToLines).toBe(true);
  expect(cues[2].line).toBe('auto');
});

test('GOOD: missing end uses the next sibling paragraph begin', async () => {
  const { cues, errors } = await parseText(
    `<tt ${TTML_NS}>
  <body>
    <div begin="10s">
      <p begin="1s">A</p>
      <p begin="3s">B</p>
      <p begin="5s" end="7s">C</p>
      <p begin="8s">D</p>
      <p begin="2s">E</p>
    </div>
  </body>
</tt>`,
    { type: 'ttml', errors: true },
  );

  expect(cues.map((cue) => [cue.text, cue.startTime, cue.endTime])).toEqual([
    ['A', 11, 13],
    ['B', 13, 15],
    ['C', 15, 17],
    // Next sibling begins before this cue: fall back to the default duration.
    ['D', 18, 28],
    // Last paragraph: nothing to infer from.
    ['E', 12, 22],
  ]);

  expect(errors.map((e) => e.code)).toEqual([2, 2]);
  expect(errors[0].line).toBe(7);
  expect(errors[1].line).toBe(8);
});

test('GOOD: clock timeBase is made relative to the earliest paragraph', async () => {
  const { cues, errors, metadata } = await parseText(
    `<tt ${TTML_NS} ttp:timeBase="clock" ttp:clockMode="local" ttp:dropMode="nonDrop" ttp:frameRate="30">
  <body>
    <div>
      <p begin="10:00:00.000" end="10:00:02.000">Clock</p>
      <p begin="10:00:02:15" end="10:00:04:00">Frames</p>
    </div>
  </body>
</tt>`,
    { type: 'ttml', errors: true },
  );

  expect(errors).toHaveLength(0);
  expect(metadata).toEqual({ TimeBase: 'clock', ClockStart: '10:00:00.000' });
  expect(cues).toHaveLength(2);
  expect(cues[0].startTime).toBe(0);
  expect(cues[0].endTime).toBe(2);
  expect(cues[1].startTime).toBe(2.5);
  expect(cues[1].endTime).toBe(4);
});

test('GOOD: region background colour does not affect cue text', async () => {
  const { cues, errors } = await parseText(
    `<tt ${TTML_NS}>
  <head>
    <layout>
      <region xml:id="r" tts:origin="10% 10%" tts:extent="80% 80%" tts:backgroundColor="#000000" tts:showBackground="always"/>
    </layout>
  </head>
  <body>
    <div>
      <p begin="0s" end="1s" region="r">Hi <span tts:backgroundColor="black">there</span></p>
    </div>
  </body>
</tt>`,
    { type: 'ttml', errors: true },
  );

  expect(errors).toHaveLength(0);
  expect(cues).toHaveLength(1);
  expect(cues[0].text).toBe('Hi <c.bg_black>there</c>');
  expect(cues[0].position).toBe(10);
});
