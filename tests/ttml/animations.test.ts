import { parseText } from 'media-captions';

const TTML_NS =
  'xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling" ' +
  'xmlns:ttp="http://www.w3.org/ns/ttml#parameter" xmlns:smpte="http://www.smpte-ra.org/schemas/2052-1/2010/smpte-tt"';

// A 1x1 transparent PNG.
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function times(cues: { startTime: number; endTime: number; text: string }[]) {
  return cues.map((cue) => [cue.startTime, cue.endTime, cue.text]);
}

test('GOOD: paragraph set splits the cue at the animation boundaries', async () => {
  const { cues, errors } = await parseText(
    `<tt ${TTML_NS}>
  <body>
    <div>
      <p xml:id="p1" begin="0s" end="3s">
        Hello
        <set begin="1s" dur="1s" tts:color="#ff0000"/>
      </p>
    </div>
  </body>
</tt>`,
    { type: 'ttml', errors: true },
  );

  expect(errors).toHaveLength(0);
  expect(times(cues)).toEqual([
    [0, 1, 'Hello'],
    [1, 2, '<c.red>Hello</c>'],
    [2, 3, 'Hello'],
  ]);
  // Every slice keeps the paragraph id.
  expect(cues.map((cue) => cue.id)).toEqual(['p1', 'p1', 'p1']);
});

test('GOOD: span set only affects that span', async () => {
  const { cues, errors } = await parseText(
    `<tt ${TTML_NS}>
  <body>
    <p begin="0s" end="4s">Plain <span>word<set begin="1s" end="3s" tts:fontWeight="bold"/></span> after</p>
  </body>
</tt>`,
    { type: 'ttml', errors: true },
  );

  expect(errors).toHaveLength(0);
  expect(times(cues)).toEqual([
    [0, 1, 'Plain word after'],
    [1, 3, 'Plain <b>word</b> after'],
    [3, 4, 'Plain word after'],
  ]);
});

test('GOOD: set on a timed span is relative to the span begin', async () => {
  const { cues, errors } = await parseText(
    `<tt ${TTML_NS}>
  <body>
    <p begin="10s" end="14s">A <span begin="1s">B<set begin="1s" dur="1s" tts:fontStyle="italic"/></span></p>
  </body>
</tt>`,
    { type: 'ttml', errors: true },
  );

  expect(errors).toHaveLength(0);
  // The span starts at 11s, so its animation runs 12s-13s.
  expect(times(cues)).toEqual([
    [10, 12, 'A <00:00:11.000>B'],
    [12, 13, 'A <i>B</i>'],
    [13, 14, 'A B'],
  ]);
});

test('GOOD: visibility hidden omits the text for that slice', async () => {
  const { cues, errors } = await parseText(
    `<tt ${TTML_NS}>
  <body>
    <p begin="0s" end="3s">
      Shown <span>blink<set begin="1s" end="2s" tts:visibility="hidden"/></span>
    </p>
    <p begin="5s" end="8s">
      Gone
      <set begin="1s" end="2s" tts:visibility="hidden"/>
    </p>
    <p begin="10s" end="11s"><span tts:visibility="hidden">static</span> visible</p>
  </body>
</tt>`,
    { type: 'ttml', errors: true },
  );

  expect(errors).toHaveLength(0);
  expect(times(cues)).toEqual([
    [0, 1, 'Shown blink'],
    [1, 2, 'Shown'],
    [2, 3, 'Shown blink'],
    // The whole paragraph is hidden between 6s and 7s: no cue at all.
    [5, 6, 'Gone'],
    [7, 8, 'Gone'],
    [10, 11, 'visible'],
  ]);
});

test('GOOD: slices that render identically are coalesced', async () => {
  const { cues, errors } = await parseText(
    `<tt ${TTML_NS}>
  <body>
    <p begin="0s" end="4s">
      Same
      <set begin="1s" end="2s" tts:color="#123456"/>
      <set begin="2s" end="3s" tts:fontFamily="serif"/>
    </p>
    <p begin="10s" end="14s">
      Merge
      <set begin="1s" end="2s" tts:color="yellow"/>
      <set begin="2s" end="3s" tts:color="#ffff00"/>
    </p>
  </body>
</tt>`,
    { type: 'ttml', errors: true },
  );

  expect(errors).toHaveLength(0);
  expect(times(cues)).toEqual([
    // Neither the unsupported colour nor the font family change the cue text.
    [0, 4, 'Same'],
    // Two adjacent animations produce the same text: one cue.
    [10, 11, 'Merge'],
    [11, 13, '<c.yellow>Merge</c>'],
    [13, 14, 'Merge'],
  ]);
});

test('GOOD: slicing is capped at 64 slices per paragraph', async () => {
  let sets = '';
  for (let i = 0; i < 200; i++) {
    sets += `<set begin="${i * 0.1}s" dur="0.05s" tts:fontWeight="bold"/>`;
  }

  const { cues, errors } = await parseText(
    `<tt ${TTML_NS}>
  <body>
    <p begin="0s" end="30s">Blink${sets}</p>
  </body>
</tt>`,
    { type: 'ttml', errors: true },
  );

  expect(errors).toHaveLength(0);
  expect(cues).toHaveLength(64);
  expect(cues[0].startTime).toBe(0);
  expect(cues[0].text).toBe('<b>Blink</b>');
  expect(cues[1].text).toBe('Blink');
  // The final slice runs to the paragraph end.
  expect(cues[63].endTime).toBe(30);
  for (let i = 1; i < cues.length; i++) {
    expect(cues[i].startTime).toBe(cues[i - 1].endTime);
  }
});

test('GOOD: opacity on a paragraph or region maps to textStyle.opacity', async () => {
  const { cues, errors } = await parseText(
    `<tt ${TTML_NS}>
  <head>
    <layout>
      <region xml:id="r" tts:origin="10% 10%" tts:extent="80% 80%" tts:opacity="0.5"/>
      <region xml:id="clear" tts:origin="10% 10%" tts:extent="80% 80%"/>
    </layout>
  </head>
  <body>
    <p begin="0s" end="1s" region="r">Region</p>
    <p begin="1s" end="2s" region="clear" tts:opacity="0.25">Own</p>
    <p begin="2s" end="5s" region="clear">
      Fade
      <set begin="1s" end="2s" tts:opacity="0"/>
    </p>
    <p begin="5s" end="6s" region="clear" tts:opacity="1">Opaque</p>
  </body>
</tt>`,
    { type: 'ttml', errors: true },
  );

  expect(errors).toHaveLength(0);
  expect(cues[0].textStyle).toEqual({ opacity: 0.5 });
  expect(cues[1].textStyle).toEqual({ opacity: 0.25 });
  expect(times(cues.slice(2, 5))).toEqual([
    [2, 3, 'Fade'],
    [3, 4, 'Fade'],
    [4, 5, 'Fade'],
  ]);
  expect(cues[2].textStyle).toBeUndefined();
  expect(cues[3].textStyle).toEqual({ opacity: 0 });
  expect(cues[4].textStyle).toBeUndefined();
  expect(cues[5].textStyle).toBeUndefined();
});

test('GOOD: set on a region re-resolves the cue position per slice', async () => {
  const { cues, errors } = await parseText(
    `<tt ${TTML_NS}>
  <head>
    <layout>
      <region xml:id="r" tts:origin="10% 70%" tts:extent="80% 20%">
        <set begin="1s" end="2s" tts:origin="10% 10%"/>
      </region>
    </layout>
  </head>
  <body>
    <p begin="0s" end="3s" region="r">Move</p>
    <p begin="10s" end="11s" region="r">Later</p>
  </body>
</tt>`,
    { type: 'ttml', errors: true },
  );

  expect(errors).toHaveLength(0);
  expect(times(cues)).toEqual([
    [0, 1, 'Move'],
    [1, 2, 'Move'],
    [2, 3, 'Move'],
    [10, 11, 'Later'],
  ]);
  expect(cues.map((cue) => cue.line)).toEqual([70, 10, 70, 70]);
  expect(cues.map((cue) => cue.position)).toEqual([10, 10, 10, 10]);
});

test('GOOD: SMPTE-TT background image produces an image cue in the region box', async () => {
  const { cues, errors } = await parseText(
    `<tt ${TTML_NS} ttp:timeBase="media">
  <head>
    <metadata>
      <smpte:image xml:id="img1" imagetype="PNG" encoding="Base64">
        ${PNG_BASE64.slice(0, 40)}
        ${PNG_BASE64.slice(40)}
      </smpte:image>
    </metadata>
    <layout>
      <region xml:id="bottom" tts:origin="10% 70%" tts:extent="80% 20%"/>
    </layout>
  </head>
  <body>
    <div>
      <p xml:id="i1" begin="1s" end="3s" region="bottom" smpte:backgroundImage="#img1"/>
      <p begin="3s" end="4s" region="bottom" smpte:backgroundImage="#missing">Text</p>
    </div>
    <div begin="5s" end="6s" smpte:backgroundImage="#img1"/>
  </body>
</tt>`,
    { type: 'ttml', errors: true },
  );

  expect(cues).toHaveLength(3);

  expect(cues[0].id).toBe('i1');
  expect(cues[0].startTime).toBe(1);
  expect(cues[0].endTime).toBe(3);
  expect(cues[0].text).toBe('');
  expect(cues[0].layout).toEqual({ left: 10, top: 70, width: 80, height: 20 });
  expect(cues[0].textStyle).toEqual({
    image: { url: `data:image/png;base64,${PNG_BASE64}` },
    backgroundColor: 'transparent',
  });

  // An unresolved reference is reported and the text is still emitted.
  expect(cues[1].text).toBe('Text');
  expect(cues[1].textStyle).toBeUndefined();
  expect(errors).toHaveLength(1);
  expect(errors[0].code).toBe(3);
  expect(errors[0].line).toBe(16);

  // A `div` image with no region covers the whole overlay (single region -> that region).
  expect(cues[2].startTime).toBe(5);
  expect(cues[2].endTime).toBe(6);
  expect(cues[2].text).toBe('');
  expect(cues[2].layout).toEqual({ left: 10, top: 70, width: 80, height: 20 });
});

test('GOOD: tts:backgroundImage data URL and IMSC 1.1 image element', async () => {
  const { cues, errors } = await parseText(
    `<tt ${TTML_NS}>
  <head>
    <image xml:id="logo" type="image/png">${PNG_BASE64}</image>
    <layout>
      <region xml:id="a" tts:origin="0% 0%" tts:extent="50% 50%"/>
      <region xml:id="b" tts:origin="50% 50%" tts:extent="50% 50%"/>
    </layout>
  </head>
  <body>
    <div>
      <p begin="0s" end="1s" tts:backgroundImage="data:image/png;base64,${PNG_BASE64}"/>
      <p begin="1s" end="2s" region="b" tts:backgroundImage="url(#logo)"/>
      <p begin="2s" end="3s" region="b" tts:backgroundImage="https://example.com/x.png"/>
    </div>
  </body>
</tt>`,
    { type: 'ttml', errors: true },
  );

  expect(errors).toHaveLength(0);
  expect(cues).toHaveLength(2);

  // No region and two regions declared: full overlay.
  expect(cues[0].layout).toEqual({ left: 0, top: 0, width: 100, height: 100 });
  expect(cues[0].textStyle?.image?.url).toBe(`data:image/png;base64,${PNG_BASE64}`);

  expect(cues[1].layout).toEqual({ left: 50, top: 50, width: 50, height: 50 });
  expect(cues[1].textStyle?.image?.url).toBe(`data:image/png;base64,${PNG_BASE64}`);
});

test('GOOD: clock time base is relative to the earliest begin', async () => {
  const { cues, errors, metadata } = await parseText(
    `<tt ${TTML_NS} ttp:timeBase="clock" ttp:clockMode="utc">
  <body>
    <div>
      <p begin="14:30:05.500" end="14:30:07">Second</p>
      <p begin="14:30:02" end="14:30:04.250">First <span begin="1s">late</span></p>
      <p begin="14:30:10">Open</p>
      <p begin="14:30:12" end="14:30:13">Last</p>
    </div>
  </body>
</tt>`,
    { type: 'ttml', errors: true },
  );

  expect(errors).toHaveLength(0);
  expect(metadata).toEqual({ TimeBase: 'clock', ClockStart: '14:30:02' });
  expect(times(cues)).toEqual([
    [3.5, 5, 'Second'],
    [0, 2.25, 'First <00:00:01.000>late'],
    // Missing end inferred from the next paragraph, still in shifted time.
    [8, 10, 'Open'],
    [10, 11, 'Last'],
  ]);
});

test('GOOD: clock time base with nested container begin', async () => {
  const { cues, errors, metadata } = await parseText(
    `<tt ${TTML_NS} ttp:timeBase="clock" ttp:clockMode="local">
  <body begin="09:00:00">
    <div>
      <p begin="30s" end="40s">A</p>
    </div>
  </body>
</tt>`,
    { type: 'ttml', errors: true },
  );

  expect(errors).toHaveLength(0);
  expect(metadata).toEqual({ TimeBase: 'clock', ClockStart: '09:00:30.000' });
  expect(times(cues)).toEqual([[0, 10, 'A']]);
});

test('GOOD: media time base is never shifted', async () => {
  const { cues, metadata } = await parseText(
    `<tt ${TTML_NS}>
  <body>
    <p begin="10s" end="11s">A</p>
  </body>
</tt>`,
    { type: 'ttml', errors: true },
  );

  expect(metadata).toEqual({});
  expect(cues[0].startTime).toBe(10);
});

test('GOOD: smpte dropNTSC timecodes', async () => {
  const { cues, errors } = await parseText(
    `<tt ${TTML_NS} ttp:timeBase="smpte" ttp:frameRate="30" ttp:dropMode="dropNTSC">
  <body>
    <div>
      <p begin="00:00:00:00" end="00:00:01:00">One second</p>
      <p begin="00:01:00:02" end="00:02:00:04">Minute</p>
      <p begin="00:10:00:00" end="00:11:00:02">Ten minutes</p>
    </div>
  </body>
</tt>`,
    { type: 'ttml', errors: true },
  );

  expect(errors).toHaveLength(0);
  expect(cues).toHaveLength(3);

  const fps = 30000 / 1001;

  // 30 nominal frames -> 1.001s of real time.
  expect(cues[0].startTime).toBe(0);
  expect(cues[0].endTime).toBeCloseTo(30 / fps, 3);

  // 00:01:00:02 is frame 1800 (frames 0 and 1 are skipped at the start of the minute) and
  // 00:02:00:04 is frame 3600 (four frames skipped by then).
  expect(cues[1].startTime).toBeCloseTo(1800 / fps, 3);
  expect(cues[1].endTime).toBeCloseTo(3600 / fps, 3);

  // 00:10:00:00: 18000 nominal frames minus 2 x 9 dropped -> 17982 frames ~= 599.999s.
  expect(cues[2].startTime).toBeCloseTo(17982 / fps, 3);
  expect(cues[2].startTime).toBeCloseTo(600, 2);
  expect(cues[2].endTime).toBeCloseTo((17982 + 1800) / fps, 3);
});

test('GOOD: dropMode is ignored outside the smpte time base', async () => {
  const { cues, errors } = await parseText(
    `<tt ${TTML_NS} ttp:timeBase="media" ttp:frameRate="30" ttp:dropMode="dropNTSC">
  <body>
    <p begin="00:10:00:00" end="00:10:01:00">Media</p>
  </body>
</tt>`,
    { type: 'ttml', errors: true },
  );

  expect(errors).toHaveLength(0);
  expect(cues[0].startTime).toBe(600);
  expect(cues[0].endTime).toBe(601);
});
