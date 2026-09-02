import { parseText, parseTextStream } from 'media-captions';

const NETFLIX_IMSC1 = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling"
    xmlns:ttp="http://www.w3.org/ns/ttml#parameter" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"
    xml:lang="en" ttp:profile="http://www.w3.org/ns/ttml/profile/imsc1/text"
    ttp:timeBase="media" ttp:frameRate="24" ttp:frameRateMultiplier="1000 1001">
  <head>
    <metadata>
      <ttm:title>Example Title</ttm:title>
      <ttm:desc>An example &amp; description</ttm:desc>
      <ttm:copyright>Copyright 2023</ttm:copyright>
    </metadata>
    <styling>
      <style xml:id="base" tts:fontFamily="proportionalSansSerif" tts:color="white" tts:textAlign="center"/>
      <style xml:id="italic" style="base" tts:fontStyle="italic"/>
      <style xml:id="yellowBold" style="base italic" tts:fontStyle="normal" tts:color="#FFFF00" tts:fontWeight="bold"/>
    </styling>
    <layout>
      <region xml:id="top" tts:origin="10% 10%" tts:extent="80% 20%" tts:displayAlign="before"/>
      <region xml:id="bottom" tts:origin="10% 70%" tts:extent="80% 20%" tts:displayAlign="after" tts:textAlign="start"/>
    </layout>
  </head>
  <body style="base">
    <div>
      <p xml:id="c1" begin="00:00:01.000" end="00:00:03.500" region="bottom">
        Hello, <span style="italic">world</span>!
      </p>
      <p begin="00:00:04:12" end="00:00:06:00" region="top" style="yellowBold">
        Line one<br/>
        Line two
      </p>
      <p begin="7s" dur="2s">Default region <span tts:fontWeight="bold" tts:fontStyle="italic">styled</span></p>
    </div>
  </body>
</tt>`;

test('GOOD: Netflix-style IMSC1 document', async () => {
  const { metadata, cues, errors } = await parseText(NETFLIX_IMSC1, { type: 'ttml' });

  expect(errors).toHaveLength(0);
  expect(metadata).toEqual({
    Language: 'en',
    Title: 'Example Title',
    Description: 'An example & description',
    Copyright: 'Copyright 2023',
  });

  expect(cues).toHaveLength(3);

  const fps = 24 * (1000 / 1001);

  expect(cues[0].id).toBe('c1');
  expect(cues[0].startTime).toBe(1);
  expect(cues[0].endTime).toBe(3.5);
  expect(cues[0].text).toBe('<c.white>Hello, <i>world</i>!</c>');
  expect(cues[0].snapToLines).toBe(false);
  expect(cues[0].line).toBe(90);
  expect(cues[0].lineAlign).toBe('end');
  expect(cues[0].position).toBe(10);
  expect(cues[0].positionAlign).toBe('line-left');
  expect(cues[0].size).toBe(80);
  expect(cues[0].align).toBe('start');

  expect(cues[1].startTime).toBeCloseTo(4 + 12 / fps);
  expect(cues[1].endTime).toBe(6);
  expect(cues[1].text).toBe('<c.yellow><b>Line one\nLine two</b></c>');
  expect(cues[1].line).toBe(10);
  expect(cues[1].lineAlign).toBe('start');
  expect(cues[1].align).toBe('center');

  // No region specified and two regions exist -> default cue layout.
  expect(cues[2].startTime).toBe(7);
  expect(cues[2].endTime).toBe(9);
  expect(cues[2].text).toBe('<c.white>Default region <b><i>styled</i></b></c>');
  expect(cues[2].snapToLines).toBe(true);
  expect(cues[2].line).toBe('auto');
  expect(cues[2].position).toBe('auto');
  expect(cues[2].size).toBe(100);
});

test('GOOD: EBU-TT-D document', async () => {
  const { cues, errors, metadata } = await parseText(
    `<?xml version="1.0" encoding="UTF-8"?>
<tt:tt xmlns:tt="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter"
  xmlns:tts="http://www.w3.org/ns/ttml#styling" xmlns:ebuttm="urn:ebu:tt:metadata"
  xmlns:ebutts="urn:ebu:tt:style" xml:lang="de" ttp:timeBase="media" ttp:cellResolution="32 15">
  <tt:head>
    <tt:metadata>
      <ebuttm:documentMetadata>
        <ebuttm:conformsToStandard>urn:ebu:tt:distribution:2014-01</ebuttm:conformsToStandard>
      </ebuttm:documentMetadata>
    </tt:metadata>
    <tt:styling>
      <tt:style xml:id="defaultStyle" tts:fontFamily="monospaceSansSerif" tts:fontSize="1c 1c" tts:lineHeight="normal" tts:textAlign="center" tts:color="white" tts:backgroundColor="transparent"/>
      <tt:style xml:id="textCenter" tts:textAlign="center"/>
      <tt:style xml:id="whiteOnBlack" tts:color="#FFFFFF" tts:backgroundColor="#000000" ebutts:linePadding="0.5c"/>
    </tt:styling>
    <tt:layout>
      <tt:region xml:id="bottom" tts:origin="10% 10%" tts:extent="80% 80%" tts:displayAlign="after" tts:padding="0c" tts:writingMode="lrtb"/>
    </tt:layout>
  </tt:head>
  <tt:body>
    <tt:div style="defaultStyle">
      <tt:p xml:id="sub1" region="bottom" style="textCenter" begin="00:00:01.000" end="00:00:02.000">
        <tt:span style="whiteOnBlack">Hallo Welt</tt:span>
      </tt:p>
      <tt:p xml:id="sub2" region="bottom" begin="00:00:02.000" end="00:00:03.000">
        <tt:span style="whiteOnBlack">Erste Zeile</tt:span><tt:br/><tt:span style="whiteOnBlack">Zweite Zeile</tt:span>
      </tt:p>
    </tt:div>
  </tt:body>
</tt:tt>`,
    { type: 'ttml' },
  );

  expect(errors).toHaveLength(0);
  expect(metadata).toEqual({ Language: 'de' });
  expect(cues).toHaveLength(2);

  expect(cues[0].id).toBe('sub1');
  expect(cues[0].startTime).toBe(1);
  expect(cues[0].endTime).toBe(2);
  expect(cues[0].text).toBe('<c.white.bg_black>Hallo Welt</c>');
  expect(cues[0].snapToLines).toBe(false);
  expect(cues[0].line).toBe(90);
  expect(cues[0].lineAlign).toBe('end');
  expect(cues[0].align).toBe('center');

  expect(cues[1].startTime).toBe(2);
  expect(cues[1].endTime).toBe(3);
  expect(cues[1].text).toBe('<c.white.bg_black>Erste Zeile\nZweite Zeile</c>');
});

test('GOOD: DFXP document with frame times and dur', async () => {
  const { cues, errors } = await parseText(
    `<?xml version="1.0" encoding="utf-8"?>
<tt xmlns="http://www.w3.org/2006/10/ttaf1" xmlns:tts="http://www.w3.org/2006/10/ttaf1#styling"
    xmlns:ttp="http://www.w3.org/2006/10/ttaf1#parameter" ttp:frameRate="25" ttp:timeBase="smpte" xml:lang="en">
  <head>
    <styling>
      <style id="s0" tts:color="white" tts:fontFamily="Arial"/>
    </styling>
    <layout>
      <region id="r0" tts:origin="0px 900px" tts:extent="1920px 180px" tts:displayAlign="center"/>
    </layout>
  </head>
  <body style="s0">
    <div begin="00:00:10:00">
      <p begin="00:00:00:00" dur="00:00:02:12">First</p>
      <p begin="00:00:02:12" end="00:00:05:00">Second &amp; third</p>
    </div>
  </body>
</tt>`,
    { type: 'dfxp' },
  );

  expect(errors).toHaveLength(0);
  expect(cues).toHaveLength(2);

  // Child times are relative to the parent div begin (10s).
  expect(cues[0].startTime).toBe(10);
  expect(cues[0].endTime).toBeCloseTo(12.48);
  expect(cues[0].text).toBe('<c.white>First</c>');

  expect(cues[1].startTime).toBeCloseTo(12.48);
  expect(cues[1].endTime).toBe(15);
  expect(cues[1].text).toBe('<c.white>Second &amp; third</c>');

  // Pixels converted using the assumed 1920x1080 root container.
  expect(cues[0].snapToLines).toBe(false);
  expect(cues[0].position).toBe(0);
  expect(cues[0].size).toBe(100);
  expect(cues[0].line).toBeCloseTo((900 + 90) / 10.8);
  expect(cues[0].lineAlign).toBe('center');
});

test('GOOD: nested span timing produces timestamp tags', async () => {
  const { cues, errors } = await parseText(
    `<tt xmlns="http://www.w3.org/ns/ttml" xml:lang="en">
  <body>
    <div begin="1m">
      <p begin="2s" end="10s">
        <span begin="0s">One</span> <span begin="1s">Two <span begin="500ms">Three</span></span>
        <span begin="3s" tts:fontStyle="italic">Four</span>
      </p>
    </div>
  </body>
</tt>`,
    { type: 'ttml' },
  );

  expect(errors).toHaveLength(0);
  expect(cues).toHaveLength(1);
  expect(cues[0].startTime).toBe(62);
  expect(cues[0].endTime).toBe(70);
  expect(cues[0].text).toBe('One <00:01:03.000>Two <00:01:03.500>Three <00:01:05.000><i>Four</i>');
});

test('GOOD: ancestor end clips child end and is inherited when missing', async () => {
  const { cues, errors } = await parseText(
    `<tt xmlns="http://www.w3.org/ns/ttml">
  <body begin="5s" end="20s">
    <div>
      <p begin="1s">Inherits body end</p>
      <p begin="2s" end="1h">Clipped</p>
      <p begin="30s" end="40s">Never shown</p>
    </div>
  </body>
</tt>`,
    { type: 'ttml' },
  );

  expect(errors).toHaveLength(0);
  expect(cues).toHaveLength(2);
  expect(cues[0].startTime).toBe(6);
  expect(cues[0].endTime).toBe(20);
  expect(cues[1].startTime).toBe(7);
  expect(cues[1].endTime).toBe(20);
});

test('GOOD: entity decoding and escaping', async () => {
  const { cues, errors } = await parseText(
    `<tt xmlns="http://www.w3.org/ns/ttml">
  <body>
    <p begin="0s" end="1s">Tom &amp; Jerry &lt;3 &gt; &quot;quoted&quot; &apos;single&apos; &#169; &#xA9; &unknown;</p>
    <p begin="1s" end="2s"><![CDATA[<raw> & cdata]]></p>
    <!-- a comment <p>ignored</p> -->
    <p begin="2s" end="3s" title='single &amp; "quotes"'>Attr</p>
  </body>
</tt>`,
    { type: 'ttml' },
  );

  expect(errors).toHaveLength(0);
  expect(cues).toHaveLength(3);
  expect(cues[0].text).toBe('Tom &amp; Jerry &lt;3 > "quoted" \'single\' © © &amp;unknown;');
  expect(cues[1].text).toBe('&lt;raw> &amp; cdata');
  expect(cues[2].text).toBe('Attr');
});

test('GOOD: xml:space preserve vs default', async () => {
  const { cues, errors } = await parseText(
    `<tt xmlns="http://www.w3.org/ns/ttml">
  <body>
    <p begin="0s" end="1s">
      Collapse    all
      of   this   <span>  whitespace </span>  please  <br/>
      next
    </p>
    <p begin="1s" end="2s" xml:space="preserve">  keep    this
 as   is  </p>
    <p begin="2s" end="3s" xml:space="preserve"><span xml:space="default">  inner   default  </span>  outer</p>
  </body>
</tt>`,
    { type: 'ttml' },
  );

  expect(errors).toHaveLength(0);
  expect(cues).toHaveLength(3);
  expect(cues[0].text).toBe('Collapse all of this whitespace please\nnext');
  expect(cues[1].text).toBe('  keep    this\n as   is  ');
  expect(cues[2].text).toBe('inner default   outer');
});

test('GOOD: styling features', async () => {
  const { cues, errors } = await parseText(
    `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling" xml:lang="en">
  <head>
    <styling>
      <style xml:id="u" tts:textDecoration="underline"/>
      <style xml:id="ignored" tts:color="rgb(12, 34, 56)" tts:backgroundColor="#123456"/>
    </styling>
  </head>
  <body>
    <div>
      <p begin="0s" end="1s" tts:fontStyle="italic">Italic <span tts:fontStyle="normal">normal</span> <span style="u">under</span></p>
      <p begin="1s" end="2s"><span xml:lang="fr">Bonjour</span> hello <span xml:lang="en">same</span></p>
      <p begin="2s" end="3s" style="ignored">No colour <span tts:color="rgb(255,0,0)" tts:backgroundColor="#00000000">red</span></p>
      <p begin="3s" end="4s" tts:color="#00FFFF" tts:backgroundColor="black">cyan on black</p>
      <p begin="4s" end="5s"><span tts:ruby="container"><span tts:ruby="base">漢</span><span tts:ruby="text">kan</span></span></p>
      <p begin="5s" end="6s">Unknown <foo>elements</foo> kept<set begin="0s" tts:color="red"/></p>
      <p begin="6s" end="7s">   </p>
    </div>
  </body>
</tt>`,
    { type: 'ttml' },
  );

  expect(errors).toHaveLength(0);
  expect(cues).toHaveLength(6);
  expect(cues[0].text).toBe('<i>Italic </i>normal<i> <u>under</u></i>');
  expect(cues[1].text).toBe('<lang fr>Bonjour</lang> hello same');
  expect(cues[2].text).toBe('No colour <c.red>red</c>');
  expect(cues[3].text).toBe('<c.cyan.bg_black>cyan on black</c>');
  expect(cues[4].text).toBe('<ruby>漢<rt>kan</rt></ruby>');
  expect(cues[5].text).toBe('Unknown elements kept');
});

test('GOOD: CRLF line endings parse identically', async () => {
  const lf = await parseText(NETFLIX_IMSC1, { type: 'ttml' }),
    crlf = await parseText(NETFLIX_IMSC1.replace(/\n/g, '\r\n'), { type: 'ttml' });

  expect(crlf.errors).toHaveLength(0);
  expect(crlf.cues).toHaveLength(lf.cues.length);

  for (let i = 0; i < lf.cues.length; i++) {
    expect(crlf.cues[i].startTime).toBe(lf.cues[i].startTime);
    expect(crlf.cues[i].endTime).toBe(lf.cues[i].endTime);
    expect(crlf.cues[i].text).toBe(lf.cues[i].text);
    expect(crlf.cues[i].line).toBe(lf.cues[i].line);
  }
});

test('GOOD: parse through text stream with callbacks', async () => {
  const lines = NETFLIX_IMSC1.split('\n'),
    stream = new ReadableStream<string>({
      start(controller) {
        for (const line of lines) controller.enqueue(line);
        controller.close();
      },
    });

  const onCue = vi.fn(),
    onHeaderMetadata = vi.fn();

  const { cues } = await parseTextStream(stream, { type: 'xml', onCue, onHeaderMetadata });

  expect(cues).toHaveLength(3);
  expect(onCue).toHaveBeenCalledTimes(3);
  expect(onHeaderMetadata).toHaveBeenCalledTimes(1);
  expect(onHeaderMetadata).toHaveBeenCalledWith(
    expect.objectContaining({ Title: 'Example Title' }),
  );
});

test('BAD: missing tt root element', async () => {
  const onError = vi.fn();

  const { cues, errors } = await parseText('<html><body><p>Hi</p></body></html>', {
    type: 'ttml',
    errors: true,
    onError,
  });

  expect(cues).toHaveLength(0);
  expect(errors).toHaveLength(1);
  expect(errors[0].code).toBe(1);
  expect(errors[0].line).toBe(1);
  expect(errors[0].message).toBe('missing TTML `<tt>` root element');
  expect(onError).toHaveBeenCalledTimes(1);
});

test('BAD: invalid time expressions and missing end', async () => {
  const { cues, errors } = await parseText(
    `<tt xmlns="http://www.w3.org/ns/ttml">
  <body>
    <p begin="bad" end="1s">Skipped</p>
    <p begin="1s" end="nope">Bad end</p>
    <p begin="10s">No end</p>
    <p begin="2s" end="1s">Inverted</p>
  </body>
</tt>`,
    { type: 'ttml', errors: true },
  );

  expect(cues).toHaveLength(2);
  expect(cues[0].text).toBe('Bad end');
  expect(cues[0].startTime).toBe(1);
  expect(cues[0].endTime).toBe(11);
  expect(cues[1].text).toBe('No end');
  expect(cues[1].startTime).toBe(10);
  expect(cues[1].endTime).toBe(20);

  expect(errors.map((e) => e.code)).toEqual([2, 2, 2, 2, 2]);
  expect(errors).toMatchInlineSnapshot(`
    [
      [Error: time expression \`bad\` is invalid on line 3],
      [Error: time expression \`nope\` is invalid on line 4],
      [Error: cue on line 4 has no end time (missing \`end\` or \`dur\` on the element or an ancestor), defaulting to a 10s duration],
      [Error: cue on line 5 has no end time (missing \`end\` or \`dur\` on the element or an ancestor), defaulting to a 10s duration],
      [Error: cue end time \`1\` is not greater than start time \`2\` on line 6],
    ]
  `);
});

test('BAD: errors are not collected when disabled', async () => {
  const { cues, errors } = await parseText('<tt><body><p begin="0s">Hi</p></body></tt>', {
    type: 'ttml',
    errors: false,
  });

  expect(errors).toHaveLength(0);
  expect(cues).toHaveLength(1);
  expect(cues[0].endTime).toBe(10);
});

test('BAD: strict mode throws', async () => {
  await expect(parseText('<not-ttml/>', { type: 'ttml', strict: true })).rejects.toThrow(
    'missing TTML `<tt>` root element',
  );

  await expect(
    parseText('<tt><body><p begin="x" end="1s">Hi</p></body></tt>', {
      type: 'ttml',
      strict: true,
    }),
  ).rejects.toThrow('time expression `x` is invalid on line 1');
});
