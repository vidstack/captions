/**
 * WebVTT cue text parsing conformance: https://www.w3.org/TR/webvtt1/#cue-text-parsing-rules
 */
import { renderVTTCueString, tokenizeVTTCue, VTTCue } from 'media-captions';

const cue = (text: string, start = 0, end = 100) => new VTTCue(start, end, text);
const render = (text: string, time?: number) => renderVTTCueString(cue(text), time);

describe('tags', () => {
  test('supports the full tag set', () => {
    expect(
      render(
        '<c>c</c><i>i</i><b>b</b><u>u</u><ruby>r<rt>t</rt></ruby><v Bob>v</v><lang en>l</lang>',
      ),
    ).toBe(
      '<span>c</span><i>i</i><b>b</b><u>u</u><ruby>r<rt>t</rt></ruby><span title="Bob" data-part="voice">v</span><span lang="en">l</span>',
    );
  });

  test('classes on any tag, multiple classes, and colour classes', () => {
    expect(render('<b.x.y>b</b><i.red>i</i><c.bg_blue.yellow>c</c>')).toBe(
      '<b class="x y">b</b><i style="color: red;">i</i><span style="color: yellow;background-color: blue;">c</span>',
    );
  });

  test('voice and lang annotations', () => {
    expect(render('<v.loud Bob Smith>hi</v>')).toBe(
      '<span class="loud" title="Bob Smith" data-part="voice">hi</span>',
    );
    expect(render('<v   Bob  Smith  >hi</v>')).toBe(
      '<span title="Bob Smith" data-part="voice">hi</span>',
    );
    expect(render('<lang en-GB>colour</lang>')).toBe('<span lang="en-GB">colour</span>');
  });

  test('unknown tags are dropped but their text is kept', () => {
    expect(render('<x>text</x> <font color="red">red</font> <br>')).toBe('text red ');
  });

  test('unclosed tags are closed at the end of the cue', () => {
    expect(render('<b>bold <i>both')).toBe('<b>bold <i>both</i></b>');
  });

  test('a stray < at the end of text is dropped', () => {
    expect(render('trailing <')).toBe('trailing ');
    expect(render('trailing <b')).toBe('trailing ');
  });

  test('end tags without a matching start are ignored', () => {
    expect(render('a</b>b</i>c')).toBe('abc');
  });

  test('ruby text is closed by </ruby>', () => {
    expect(render('<ruby>漢<rt>kan</ruby>字')).toBe('<ruby>漢<rt>kan</rt></ruby>字');
  });

  test('voice tags can be left unclosed when they cover the whole cue', () => {
    expect(render('<v Bob>Hello world')).toBe(
      '<span title="Bob" data-part="voice">Hello world</span>',
    );
  });

  test('newlines are preserved in text nodes', () => {
    expect(tokenizeVTTCue(cue('line 1\nline 2'))).toEqual([
      { type: 'text', data: 'line 1\nline 2' },
    ]);
  });
});

describe('character references', () => {
  test('named references from the spec list', () => {
    expect(tokenizeVTTCue(cue('&amp;&lt;&gt;&quot;&#39;&nbsp;&lrm;&rlm;'))).toEqual([
      { type: 'text', data: '&<>"\'\u00a0\u200e\u200f' },
    ]);
  });

  test('decimal, hex, and extended named references', () => {
    expect(tokenizeVTTCue(cue('&#169; &#xA9; &copy; &hellip;'))).toEqual([
      { type: 'text', data: '© © © …' },
    ]);
  });

  test('invalid or unknown references are preserved as text', () => {
    expect(tokenizeVTTCue(cue('&bogus; & &#; &#xZZ;'))).toEqual([
      { type: 'text', data: '&bogus; & &#; &#xZZ;' },
    ]);
  });

  test('surrogate and out of range code points become the replacement character', () => {
    expect(tokenizeVTTCue(cue('&#xD800;&#1114112;'))).toEqual([
      { type: 'text', data: '\ufffd\ufffd' },
    ]);
  });

  test('decoded text is re-escaped when rendered', () => {
    expect(render('&lt;b&gt; &amp; "q"')).toBe('&lt;b&gt; &amp; "q"');
  });
});

describe('timestamps', () => {
  test('timestamp tags produce timed spans that reflect the current time', () => {
    expect(render('a<00:00:10.000>b<00:00:20.000>c', 15)).toBe(
      'a<span data-part="timed" data-time="10" data-past="">b</span><span data-part="timed" data-time="20" data-future="">c</span>',
    );
  });

  test('timestamps outside the cue range are ignored', () => {
    expect(renderVTTCueString(cue('a<00:05:00.000>b', 0, 10))).toBe('ab');
  });

  test('timestamps accept both timestamp forms', () => {
    const tokens = tokenizeVTTCue(cue('<00:10.500>a<01:00:00.000>b', 0, 4000));
    expect(tokens.map((t) => (t.type === 'timestamp' ? t.time : t))).toEqual([10.5, 3600]);
  });

  test('a timestamp inside formatting is scoped to that formatting', () => {
    expect(render('<i><00:00:01.000>a</i>b<00:00:02.000>c', 5)).toBe(
      '<i><span data-part="timed" data-time="1" data-past="">a</span></i>b<span data-part="timed" data-time="2" data-past="">c</span>',
    );
  });
});
