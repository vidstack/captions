import { parseText } from 'media-captions';

const TTML_NS =
  'xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling" ' +
  'xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ' +
  'xmlns:itts="http://www.w3.org/ns/ttml/profile/imsc1#styling" ' +
  'xmlns:ittp="http://www.w3.org/ns/ttml/profile/imsc1#parameter"';

// A 1x1 transparent PNG.
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

test('GOOD: span typography that differs from the paragraph maps to cue.spans', async () => {
  const { cues, errors } = await parseText(
    `<tt ${TTML_NS} tts:extent="640px 480px">
  <head>
    <styling>
      <style xml:id="big" tts:fontSize="160%" tts:fontFamily="monospaceSerif"/>
    </styling>
  </head>
  <body>
    <div>
      <p begin="0s" end="1s">Plain <span style="big">big</span> <span tts:fontSize="24px" tts:color="#ff000088">red</span> <span tts:backgroundColor="#808080" tts:textOutline="black 2px" tts:textShadow="10% -20% 5% lime" tts:opacity="0.5">boxed</span> <span tts:fontFamily="Times New Roman, serif" tts:color="rgba(0,0,255,128)">blue</span> <span tts:color="#00ff00">lime</span></p>
    </div>
  </body>
</tt>`,
    { type: 'ttml', errors: true },
  );

  expect(errors).toHaveLength(0);
  expect(cues).toHaveLength(1);
  expect(cues[0].text).toBe(
    'Plain <c.s-1>big</c> <c.s-2>red</c> <c.s-3>boxed</c> <c.s-4>blue</c> <c.lime>lime</c>',
  );
  expect(cues[0].textStyle).toBeUndefined();
  expect(cues[0].spans).toEqual({
    // `%` is relative to the paragraph font size, generic families map to CSS.
    '1': { fontSize: '1.6em', fontFamily: 'monospace' },
    // 24 / 480; a translucent palette colour is not `<c.red>`.
    '2': { fontSize: 'calc(var(--overlay-height) * 0.05)', color: '#ff000088' },
    '3': {
      textStroke: 'calc(var(--overlay-height) * 0.00417) black',
      backgroundColor: '#808080',
      opacity: '0.5',
      textShadow: '0.1em -0.2em 0.05em lime',
    },
    // TTML `rgba()` alpha is 0-255.
    '4': { fontFamily: '"Times New Roman", serif', color: 'rgba(0, 0, 255, 0.502)' },
  });
});

test('GOOD: palette colours and inherited styles do not create span styles', async () => {
  const { cues, errors } = await parseText(
    `<tt ${TTML_NS}>
  <body>
    <div>
      <p begin="0s" end="1s" tts:color="#123456" tts:fontSize="80%"><span tts:color="#123456" tts:fontSize="80%">same</span> <span tts:color="yellow">pal</span> <span tts:fontSize="80%">inherit</span> <span tts:backgroundColor="#00000000">clear</span></p>
      <p begin="1s" end="2s"><span tts:fontSize="200%">a</span> <span tts:fontSize="200%">b</span> <span tts:fontSize="200%" tts:fontStyle="italic">c</span></p>
    </div>
  </body>
</tt>`,
    { type: 'ttml', errors: true },
  );

  expect(errors).toHaveLength(0);
  expect(cues[0].text).toBe('same <c.yellow>pal</c> inherit clear');
  expect(cues[0].spans).toBeUndefined();
  expect(cues[0].textStyle).toEqual({ fontSize: 'calc(var(--overlay-height) * 0.05 * 0.8)' });

  // Identical span styles share a key.
  expect(cues[1].text).toBe('<c.s-1>a</c> <c.s-1>b</c> <c.s-1><i>c</i></c>');
  expect(cues[1].spans).toEqual({ '1': { fontSize: '2em' } });
});

test('GOOD: line height, text outline and text shadow on paragraphs', async () => {
  const { cues, errors } = await parseText(
    `<tt ${TTML_NS} ttp:cellResolution="32 15">
  <body tts:lineHeight="normal">
    <div>
      <p begin="0s" end="1s">normal</p>
      <p begin="1s" end="2s" tts:lineHeight="125%">pct</p>
      <p begin="2s" end="3s" tts:lineHeight="1c" tts:textOutline="red 0.1c" tts:textShadow="1px 1px black, 0.5c 0px">cell</p>
      <p begin="3s" end="4s" tts:textOutline="none" tts:textShadow="none">none</p>
    </div>
  </body>
</tt>`,
    { type: 'ttml', errors: true },
  );

  expect(errors).toHaveLength(0);
  expect(cues[0].textStyle).toEqual({ lineHeight: 'normal' });
  // A percentage is relative to the font size: a unitless multiple.
  expect(cues[1].textStyle).toEqual({ lineHeight: '1.25' });
  expect(cues[2].textStyle).toEqual({
    lineHeight: 'calc(var(--overlay-height) * 0.06667)',
    textStroke: 'calc(var(--overlay-height) * 0.00667) red',
    textShadow:
      'calc(var(--overlay-height) * 0.00093) calc(var(--overlay-height) * 0.00093) black, ' +
      'calc(var(--overlay-height) * 0.03333) calc(var(--overlay-height) * 0)',
  });
  expect(cues[3].textStyle).toEqual({ lineHeight: 'normal' });
});

test('GOOD: forced display and aspect ratio', async () => {
  const forced = await parseText(
    `<tt ${TTML_NS} ittp:aspectRatio="4 3">
  <head>
    <layout>
      <region xml:id="r" tts:origin="10% 10%" tts:extent="80% 80%" itts:forcedDisplay="true"/>
      <region xml:id="n" tts:origin="10% 10%" tts:extent="80% 80%"/>
    </layout>
  </head>
  <body>
    <div>
      <p begin="0s" end="1s" region="r">Forced by region</p>
      <p begin="1s" end="2s" region="n" itts:forcedDisplay="true">Forced by p</p>
      <p begin="2s" end="3s" region="n">Normal</p>
    </div>
  </body>
</tt>`,
    { type: 'ttml', errors: true },
  );

  expect(forced.errors).toHaveLength(0);
  expect(forced.metadata).toEqual({ AspectRatio: '4:3', HasForcedCues: 'true' });
  expect(forced.cues.map((cue) => cue.textStyle)).toEqual([
    { className: 'forced' },
    { className: 'forced' },
    undefined,
  ]);

  const plain = await parseText(
    `<tt ${TTML_NS} ttp:displayAspectRatio="16 9">
  <body><p begin="0s" end="1s">Normal</p></body>
</tt>`,
    { type: 'ttml', errors: true },
  );

  expect(plain.metadata).toEqual({ AspectRatio: '16:9' });
  expect(plain.cues[0].textStyle).toBeUndefined();
});

test('GOOD: region padding and position inset and place the cue box', async () => {
  const { cues, errors } = await parseText(
    `<tt ${TTML_NS} ttp:cellResolution="40 20">
  <head>
    <layout>
      <region xml:id="pad" tts:origin="10% 20%" tts:extent="80% 40%" tts:padding="10% 5%"/>
      <region xml:id="pad4" tts:origin="0% 0%" tts:extent="100% 100%" tts:padding="1c 2c 3c 4c" tts:displayAlign="after"/>
      <region xml:id="vpad" tts:origin="50% 0%" tts:extent="50% 100%" tts:padding="10% 5%" tts:writingMode="tbrl"/>
      <region xml:id="pos" tts:extent="60% 20%" tts:position="center bottom 10%"/>
      <region xml:id="pos2" tts:extent="60% 20%" tts:position="right 5% top"/>
      <region xml:id="pos3" tts:extent="50rw 50rh" tts:position="25%"/>
    </layout>
  </head>
  <body>
    <div>
      <p begin="0s" end="1s" region="pad">a</p>
      <p begin="1s" end="2s" region="pad4">b</p>
      <p begin="2s" end="3s" region="vpad">c</p>
      <p begin="3s" end="4s" region="pos">d</p>
      <p begin="4s" end="5s" region="pos2">e</p>
      <p begin="5s" end="6s" region="pos3">f</p>
    </div>
  </body>
</tt>`,
    { type: 'ttml', errors: true },
  );

  expect(errors).toHaveLength(0);
  expect(cues).toHaveLength(6);

  const box = (cue: (typeof cues)[number]) => [cue.position, cue.size, cue.line, cue.lineAlign];

  // Percentages are relative to the region: 10% of the 40% height, 5% of the 80% width.
  expect(box(cues[0])).toEqual([14, 72, 24, 'start']);
  // `before end after start` in cells of a 40x20 grid: 5%, 5%, 15%, 10%.
  expect(box(cues[1])).toEqual([10, 85, 85, 'end']);
  // Vertical text: before/after are the right/left edges, start/end the top/bottom.
  expect(cues[2].vertical).toBe('rl');
  expect(box(cues[2])).toEqual([5, 90, 95, 'end']);
  // `center bottom 10%`: centred horizontally, 10% of the free space above the bottom.
  expect(box(cues[3])).toEqual([20, 60, 72, 'start']);
  // `right 5% top`.
  expect(box(cues[4])).toEqual([38, 60, 0, 'start']);
  // `rw`/`rh` are root percentages; a lone `25%` is horizontal, vertically centred.
  expect(box(cues[5])).toEqual([12.5, 50, 25, 'start']);
});

test('GOOD: IMSC 1.1 image element inside a div', async () => {
  const { cues, errors } = await parseText(
    `<tt ${TTML_NS}>
  <head>
    <image xml:id="logo" type="image/png">${PNG_BASE64}</image>
    <layout>
      <region xml:id="r" tts:origin="10% 70%" tts:extent="80% 20%"/>
    </layout>
  </head>
  <body>
    <div begin="0s" end="1s" region="r"><image src="#logo"/></div>
    <div begin="1s" end="2s" region="r"><image type="image/png" encoding="base64">${PNG_BASE64}</image></div>
    <div begin="2s" end="3s" region="r"><image src="external.png" type="image/png"/></div>
  </body>
</tt>`,
    { type: 'ttml', errors: true },
  );

  // External sources are not fetched; the third div produces nothing.
  expect(errors).toHaveLength(0);
  expect(cues).toHaveLength(2);

  for (const cue of cues) {
    expect(cue.text).toBe('');
    expect(cue.layout).toEqual({ left: 10, top: 70, width: 80, height: 20 });
    expect(cue.textStyle?.backgroundImage).toBe(`url(data:image/png;base64,${PNG_BASE64})`);
  }
  expect(cues[0].startTime).toBe(0);
  expect(cues[1].startTime).toBe(1);
});

test('GOOD: smpte dropPAL timecodes', async () => {
  const { cues, errors } = await parseText(
    `<tt ${TTML_NS} ttp:timeBase="smpte" ttp:frameRate="30" ttp:dropMode="dropPAL">
  <body>
    <div>
      <p begin="00:02:00:04" end="00:04:00:08">PAL</p>
    </div>
  </body>
</tt>`,
    { type: 'ttml', errors: true },
  );

  expect(errors).toHaveLength(0);

  const fps = 30000 / 1001;
  // Minutes 2 and 4 each drop four frames: 00:02:00:04 is frame 3600, 00:04:00:08 frame 7200.
  expect(cues[0].startTime).toBeCloseTo(3600 / fps, 6);
  expect(cues[0].endTime).toBeCloseTo(7200 / fps, 6);
});
