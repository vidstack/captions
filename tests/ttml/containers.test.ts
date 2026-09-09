import { parseText } from 'media-captions';

const TTML_NS =
  'xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling" ' +
  'xmlns:ttp="http://www.w3.org/ns/ttml#parameter"';

function times(cues: { startTime: number; endTime: number; text: string }[]) {
  return cues.map((cue) => [cue.startTime, cue.endTime, cue.text]);
}

test('GOOD: seq time container runs children back to back', async () => {
  const { cues, errors } = await parseText(
    `<tt ${TTML_NS}>
  <body>
    <div timeContainer="seq">
      <p begin="1s" dur="2s">A</p>
      <p dur="3s">B</p>
      <p begin="1s" end="3s">C</p>
      <p timeContainer="seq">Zero</p>
      <p dur="1s">D</p>
    </div>
  </body>
</tt>`,
    { type: 'ttml', errors: true },
  );

  expect(errors).toHaveLength(0);
  expect(times(cues)).toEqual([
    [1, 3, 'A'],
    // Begins where A ended.
    [3, 6, 'B'],
    // `begin` and `end` are both offsets from the previous sibling's end.
    [7, 9, 'C'],
    // Text in a seq container has a zero implicit duration, so `Zero` never shows.
    [9, 10, 'D'],
  ]);
});

test('GOOD: nested seq containers with durations', async () => {
  const { cues, errors } = await parseText(
    `<tt ${TTML_NS}>
  <body>
    <div timeContainer="seq" dur="40s">
      <div timeContainer="seq" dur="20s">
        <p begin="5s" dur="5s">A</p>
        <p dur="5s">B</p>
      </div>
      <div timeContainer="seq" dur="20s">
        <p begin="5s" dur="5s">C</p>
      </div>
    </div>
  </body>
</tt>`,
    { type: 'ttml', errors: true },
  );

  expect(errors).toHaveLength(0);
  expect(times(cues)).toEqual([
    [5, 10, 'A'],
    [10, 15, 'B'],
    [25, 30, 'C'],
  ]);
});

test('GOOD: paragraph end is implied by its timed spans, which slice the cue', async () => {
  const { cues, errors } = await parseText(
    `<tt ${TTML_NS}>
  <body>
    <div>
      <p begin="0s">
        <span dur="2s">Two</span> <span end="4s">Four</span> <span begin="1s" dur="1s">Blink</span>
      </p>
      <p begin="10s" end="20s"><span begin="2s" end="8s">Late</span></p>
    </div>
  </body>
</tt>`,
    { type: 'ttml', errors: true },
  );

  expect(errors).toHaveLength(0);
  expect(times(cues)).toEqual([
    [0, 2, 'Two Four <00:00:01.000>Blink'],
    [2, 4, 'Four'],
    // Nothing is visible before the only span begins, so the cue starts with it.
    [12, 18, 'Late'],
  ]);
});

test('GOOD: par container end is the latest child end', async () => {
  const { cues, errors } = await parseText(
    `<tt ${TTML_NS}>
  <body>
    <div timeContainer="seq">
      <div>
        <p begin="0s" end="2s">A</p>
        <p begin="1s" end="3s">B</p>
      </div>
      <p dur="1s">C</p>
    </div>
  </body>
</tt>`,
    { type: 'ttml', errors: true },
  );

  expect(errors).toHaveLength(0);
  expect(times(cues)).toEqual([
    [0, 2, 'A'],
    [1, 3, 'B'],
    [3, 4, 'C'],
  ]);
});

test('GOOD: region timing bounds the content shown in it', async () => {
  const { cues, errors } = await parseText(
    `<tt ${TTML_NS}>
  <head>
    <layout>
      <region xml:id="r1" begin="0s" end="10s" tts:origin="5% 5%" tts:extent="80% 20%"/>
      <region xml:id="r2" begin="10s" end="20s" tts:origin="5% 25%" tts:extent="80% 40%"/>
    </layout>
  </head>
  <body>
    <div region="r1">
      <p>Early</p>
    </div>
    <div region="r2">
      <p begin="5s" end="15s">Clipped start</p>
      <p begin="16s" end="25s">Clipped end</p>
      <p begin="21s" end="22s">Never</p>
    </div>
  </body>
</tt>`,
    { type: 'ttml', errors: true },
  );

  // The untimed paragraph ends with its region instead of reporting a missing end.
  expect(errors).toHaveLength(0);
  expect(times(cues)).toEqual([
    [0, 10, 'Early'],
    [10, 15, 'Clipped start'],
    [16, 20, 'Clipped end'],
  ]);
  expect(cues.map((cue) => cue.line)).toEqual([5, 25, 25]);
});

test('GOOD: spans with their own region render into that region', async () => {
  const { cues, errors } = await parseText(
    `<tt ${TTML_NS}>
  <head>
    <layout>
      <region xml:id="top" tts:origin="10% 10%" tts:extent="80% 20%"/>
      <region xml:id="bottom" tts:origin="10% 70%" tts:extent="80% 20%"/>
    </layout>
  </head>
  <body>
    <div>
      <p begin="0s" end="1s">Dropped <span region="top">Up</span> <span region="bottom">Down</span></p>
      <p begin="1s" end="2s" region="top">Kept <span region="bottom">Down</span></p>
    </div>
  </body>
</tt>`,
    { type: 'ttml', errors: true },
  );

  expect(errors).toHaveLength(0);
  // Text outside every span region is not associated with any region and is pruned.
  expect(times(cues)).toEqual([
    [0, 1, 'Up'],
    [0, 1, 'Down'],
    [1, 2, 'Kept'],
    [1, 2, 'Down'],
  ]);
  expect(cues.map((cue) => cue.line)).toEqual([10, 70, 10, 70]);
});

test('GOOD: set on body and div containers slices the paragraphs within', async () => {
  const { cues, errors } = await parseText(
    `<tt ${TTML_NS}>
  <body>
    <set begin="10s" dur="1s" tts:visibility="hidden"/>
    <div begin="0s" end="6s">
      <set begin="2s" end="4s" tts:color="#ff0000"/>
      <p begin="0s" end="6s">A</p>
      <p begin="1s" end="5s">B</p>
    </div>
    <div>
      <p begin="9s" end="12s">C</p>
    </div>
  </body>
</tt>`,
    { type: 'ttml', errors: true },
  );

  expect(errors).toHaveLength(0);
  expect(times(cues)).toEqual([
    [0, 2, 'A'],
    [2, 4, '<c.red>A</c>'],
    [4, 6, 'A'],
    [1, 2, 'B'],
    [2, 4, '<c.red>B</c>'],
    [4, 5, 'B'],
    [9, 10, 'C'],
    [11, 12, 'C'],
  ]);
});

test('GOOD: display none hides the paragraph until a set turns it on', async () => {
  const { cues, errors } = await parseText(
    `<tt ${TTML_NS}>
  <body>
    <div timeContainer="seq" dur="20s">
      <p dur="10s" tts:display="none"><set tts:display="auto" begin="5s"/>Shown at 5</p>
      <p dur="10s" tts:display="none">Never</p>
    </div>
  </body>
</tt>`,
    { type: 'ttml', errors: true },
  );

  expect(errors).toHaveLength(0);
  expect(times(cues)).toEqual([[5, 10, 'Shown at 5']]);
});
