import { parseText, renderVTTCueString, tokenizeVTTCue, VTTCue } from 'media-captions';

describe('cue text sanitization', () => {
  test('entity-encoded markup can not inject elements', () => {
    const cue = new VTTCue(0, 10, '&lt;img src=x onerror=alert(1)&gt;');
    expect(renderVTTCueString(cue)).toBe('&lt;img src=x onerror=alert(1)&gt;');
  });

  test('class names can not break out of the attribute', () => {
    const cue = new VTTCue(0, 10, '<c.foo"onmouseover="alert(1)>hi</c>');
    expect(renderVTTCueString(cue)).toBe('<span class="fooonmouseoveralert1">hi</span>');
  });

  test('voice annotations are attribute-escaped', () => {
    const cue = new VTTCue(0, 10, '<v Joe&quot; onmouseover=&quot;alert(1)>hi</v>');
    expect(renderVTTCueString(cue)).toBe(
      '<span title="Joe&quot; onmouseover=&quot;alert(1)" data-part="voice">hi</span>',
    );
  });

  test('language annotations are attribute-escaped', () => {
    const cue = new VTTCue(0, 10, '<lang en"onclick="x>x</lang>');
    expect(renderVTTCueString(cue)).toBe('<span lang="en&quot;onclick=&quot;x">x</span>');
  });

  test('ampersands and angle brackets in text are escaped', () => {
    const cue = new VTTCue(0, 10, 'Tom &amp; Jerry &lt;3 > 2');
    expect(renderVTTCueString(cue)).toBe('Tom &amp; Jerry &lt;3 &gt; 2');
  });

  test('hex colour classes are validated', () => {
    expect(renderVTTCueString(new VTTCue(0, 10, '<c.#FF0000>a</c>'))).toBe(
      '<span style="color: #ff0000;">a</span>',
    );
    expect(renderVTTCueString(new VTTCue(0, 10, '<c.#ff0000;x>a</c>'))).toBe(
      '<span class="ff0000x">a</span>',
    );
  });
});

describe('tokenizer nesting', () => {
  test('unknown end tags do not corrupt nesting', () => {
    const cue = new VTTCue(0, 10, '<i>a <font color="red">b</font> c</i>');
    expect(renderVTTCueString(cue)).toBe('<i>a b c</i>');
  });

  test('a mismatched end tag is ignored and never corrupts nesting (spec)', () => {
    const cue = new VTTCue(0, 10, '<b><i>x</b>y');
    expect(renderVTTCueString(cue)).toBe('<b><i>xy</i></b>');
  });

  test('closing ruby closes ruby text', () => {
    const cue = new VTTCue(0, 10, '<ruby>漢<rt>kan</ruby>字');
    expect(renderVTTCueString(cue)).toBe('<ruby>漢<rt>kan</rt></ruby>字');
  });

  test('self-closing unknown tags are skipped', () => {
    const cue = new VTTCue(0, 10, 'a<br/>b');
    expect(renderVTTCueString(cue)).toBe('ab');
  });

  test('timestamps are siblings, not nested', () => {
    const cue = new VTTCue(0, 10, '<00:01.000>a<00:02.000>b<00:03.000>c');
    const tokens = tokenizeVTTCue(cue);
    expect(tokens).toHaveLength(3);
    expect(renderVTTCueString(cue, 2.5)).toBe(
      '<span data-part="timed" data-time="1" data-past="">a</span>' +
        '<span data-part="timed" data-time="2" data-past="">b</span>' +
        '<span data-part="timed" data-time="3" data-future="">c</span>',
    );
  });

  test('timestamps inside formatting are closed by the formatting end tag', () => {
    const cue = new VTTCue(0, 10, '<i><00:01.000>a</i>b');
    expect(renderVTTCueString(cue, 5)).toBe(
      '<i><span data-part="timed" data-time="1" data-past="">a</span></i>b',
    );
  });

  test('current time is applied to nested timestamps', () => {
    const cue = new VTTCue(0, 10, '<b><00:01.000>a</b>');
    expect(renderVTTCueString(cue, 5)).toContain('data-past');
    expect(renderVTTCueString(cue, 0.5)).toContain('data-future');
  });
});

describe('entities', () => {
  test('numeric and extended named entities are decoded', () => {
    const cue = new VTTCue(0, 10, '&#8230; &#x2014; &hellip; &copy; &unknown; &#0;');
    expect(tokenizeVTTCue(cue)).toEqual([{ type: 'text', data: '… — … © &unknown; �' }]);
  });
});

describe('parser tolerance', () => {
  test('header metadata keeps the full value', async () => {
    const { metadata } = await parseText(
      'WEBVTT\nX-TIMESTAMP-MAP=MPEGTS:900000,LOCAL:00:00:00.000\nLanguage: en-US\n\n00:01.000 --> 00:02.000\nhi\n',
    );
    expect(metadata).toEqual({
      'X-TIMESTAMP-MAP': 'MPEGTS:900000,LOCAL:00:00:00.000',
      Language: 'en-US',
    });
  });

  test('percentages keep decimals', async () => {
    const { cues } = await parseText(
      'WEBVTT\n\n00:01.000 --> 00:02.000 position:12.5% line:87.5% size:33.3%\nhi\n',
    );
    expect(cues[0].position).toBe(12.5);
    expect(cues[0].line).toBe(87.5);
    expect(cues[0].size).toBe(33.3);
  });
});
