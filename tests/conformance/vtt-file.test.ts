/**
 * WebVTT file parsing conformance. Cases follow https://www.w3.org/TR/webvtt1/#file-parsing and
 * the web-platform-tests WebVTT suite, plus deliberate real-world tolerances (marked TOLERANT)
 * where the spec would discard content that players are expected to show.
 */
import { parseText } from 'media-captions';

const vtt = (...lines: string[]) => lines.join('\n');
const parse = (text: string, options = {}) => parseText(text, { errors: true, ...options });

describe('signature', () => {
  test('accepts WEBVTT followed by space, tab, or text', async () => {
    for (const header of ['WEBVTT', 'WEBVTT ', 'WEBVTT\t', 'WEBVTT - This file has cues.']) {
      const { cues, errors } = await parse(vtt(header, '', '00:00.000 --> 00:01.000', 'Hi'));
      expect(errors).toEqual([]);
      expect(cues).toHaveLength(1);
    }
  });

  test('accepts a UTF-8 byte order mark', async () => {
    const { cues, errors } = await parse(vtt('﻿WEBVTT', '', '00:00.000 --> 00:01.000', 'Hi'));
    expect(errors).toEqual([]);
    expect(cues).toHaveLength(1);
  });

  test('rejects an invalid signature in strict mode', async () => {
    await expect(
      parse(vtt('WEBVTTx', '', '00:00.000 --> 00:01.000', 'Hi'), { strict: true }),
    ).rejects.toThrow(/WEBVTT/);
    await expect(
      parse(vtt('', 'WEBVTT', '', '00:00.000 --> 00:01.000', 'Hi'), { strict: true }),
    ).rejects.toThrow();
  });

  test('TOLERANT: still parses cues when the signature is missing in non-strict mode', async () => {
    const { cues, errors } = await parse(vtt('00:00.000 --> 00:01.000', 'Hi'));
    expect(cues).toHaveLength(1);
    expect(errors.map((e) => e.message)).toEqual(['missing WEBVTT file header']);
  });
});

describe('line terminators and whitespace', () => {
  test('CRLF, LF, and CR are all line terminators', async () => {
    const body = [
      'WEBVTT',
      '',
      '00:00.000 --> 00:01.000',
      'Line 1',
      'Line 2',
      '',
      '00:01.000 --> 00:02.000',
      'Two',
    ];
    for (const sep of ['\n', '\r\n', '\r']) {
      const { cues } = await parse(body.join(sep));
      expect(cues.map((c) => c.text)).toEqual(['Line 1\nLine 2', 'Two']);
    }
  });

  test('file without a trailing newline keeps the last cue', async () => {
    const { cues } = await parse('WEBVTT\n\n00:00.000 --> 00:01.000\nLast');
    expect(cues.map((c) => c.text)).toEqual(['Last']);
  });

  test('multiple blank lines between blocks are fine', async () => {
    const { cues } = await parse(
      vtt(
        'WEBVTT',
        '',
        '',
        '',
        '00:00.000 --> 00:01.000',
        'A',
        '',
        '',
        '00:01.000 --> 00:02.000',
        'B',
      ),
    );
    expect(cues.map((c) => c.text)).toEqual(['A', 'B']);
  });
});

describe('header metadata', () => {
  test('collects key/value lines after the signature', async () => {
    const { metadata } = await parse(
      vtt(
        'WEBVTT',
        'Kind: captions',
        'Language: en-US',
        'X-TIMESTAMP-MAP=MPEGTS:0,LOCAL:00:00:00.000',
        '',
        '00:00.000 --> 00:01.000',
        'Hi',
      ),
    );
    expect(metadata).toEqual({
      Kind: 'captions',
      Language: 'en-US',
      'X-TIMESTAMP-MAP': 'MPEGTS:0,LOCAL:00:00:00.000',
    });
  });
});

describe('cue identifiers and blocks', () => {
  test('cue identifier line is stored as the cue id', async () => {
    const { cues } = await parse(
      vtt(
        'WEBVTT',
        '',
        'intro',
        '00:00.000 --> 00:01.000',
        'Hi',
        '',
        '2',
        '00:01.000 --> 00:02.000',
        'Two',
      ),
    );
    expect(cues.map((c) => c.id)).toEqual(['intro', '2']);
  });

  test('a timing line inside cue text starts a new cue (spec: no blank line required)', async () => {
    const { cues } = await parse(
      vtt('WEBVTT', '', '00:00.000 --> 00:01.000', 'First', '00:01.000 --> 00:02.000', 'Second'),
    );
    expect(cues.map((c) => c.text)).toEqual(['First', 'Second']);
  });

  test('NOTE blocks are ignored, including multi-line notes', async () => {
    const { cues } = await parse(
      vtt(
        'WEBVTT',
        '',
        'NOTE',
        'This is a note',
        'with two lines',
        '',
        'NOTE single line',
        '',
        '00:00.000 --> 00:01.000',
        'Hi',
      ),
    );
    expect(cues.map((c) => c.text)).toEqual(['Hi']);
  });

  test('a cue with no payload is still a cue with empty text', async () => {
    const { cues } = await parse(
      vtt('WEBVTT', '', '00:00.000 --> 00:01.000', '', '00:01.000 --> 00:02.000', 'B'),
    );
    expect(cues.map((c) => c.text)).toEqual(['', 'B']);
  });

  test('TOLERANT: a cue text line containing --> that does not look like a timing line is kept as text', async () => {
    const { cues } = await parse(vtt('WEBVTT', '', '00:00.000 --> 00:01.000', 'a --> b'));
    expect(cues.map((c) => c.text)).toEqual(['a --> b']);
  });

  test('any line containing --> ends the cue when lenient is false (spec)', async () => {
    const { cues, errors } = await parse(
      vtt(
        'WEBVTT',
        '',
        '00:00.000 --> 00:01.000',
        'text0',
        'a --> b',
        '00:01.000 --> 00:02.000',
        'text1',
      ),
      { lenient: false },
    );
    expect(cues.map((c) => c.text)).toEqual(['text0', 'text1']);
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('lenient: false (spec grammar without throwing)', () => {
  test('drops invalid cues and reports them instead of throwing', async () => {
    const { cues, errors } = await parse(
      vtt('WEBVTT', '', '00:00.00 --> 00:01.000', 'short', '', '00:01.000 --> 00:02.000', 'ok'),
      { lenient: false },
    );
    expect(cues.map((c) => c.text)).toEqual(['ok']);
    expect(errors).toHaveLength(1);
  });

  test('rejects bare percentages and align:middle', async () => {
    const { cues } = await parse(
      vtt('WEBVTT', '', '00:00.000 --> 00:01.000 position:25 align:end align:middle', 'Hi'),
      { lenient: false },
    );
    expect(cues[0].position).toBe('auto');
    expect(cues[0].align).toBe('end');
  });

  test('gives up on a file without a signature', async () => {
    const { cues, errors } = await parse(vtt('00:00.000 --> 00:01.000', 'Hi'), {
      lenient: false,
    });
    expect(cues).toEqual([]);
    expect(errors).toHaveLength(1);
  });

  test('strict wins over lenient', async () => {
    await expect(
      parse(vtt('WEBVTT', '', '00:00.000 --> 00:01.000 position:25', 'Hi'), {
        strict: true,
        lenient: true,
      }),
    ).rejects.toThrow(/position/);
  });
});

describe('cue timings', () => {
  test('supports both mm:ss.ttt and hh:mm:ss.ttt forms', async () => {
    const { cues } = await parse(vtt('WEBVTT', '', '00:01.500 --> 01:00:02.250', 'Hi'));
    expect(cues[0].startTime).toBe(1.5);
    expect(cues[0].endTime).toBe(3602.25);
  });

  test('requires exactly two digits for minutes and seconds and three for milliseconds in strict mode', async () => {
    for (const timing of [
      '0:01.000 --> 00:02.000',
      '00:1.000 --> 00:02.000',
      '00:01.00 --> 00:02.000',
    ]) {
      await expect(parse(vtt('WEBVTT', '', timing, 'Hi'), { strict: true })).rejects.toThrow();
    }
  });

  test('rejects minutes or seconds above 59', async () => {
    const { cues, errors } = await parse(vtt('WEBVTT', '', '00:60.000 --> 00:61.000', 'Hi'));
    expect(cues).toHaveLength(0);
    expect(errors.length).toBeGreaterThan(0);
  });

  test('allows overlapping and unsorted cues', async () => {
    const { cues } = await parse(
      vtt('WEBVTT', '', '00:05.000 --> 00:10.000', 'B', '', '00:00.000 --> 00:07.000', 'A'),
    );
    expect(cues.map((c) => c.text)).toEqual(['B', 'A']);
  });

  test('TOLERANT: comma millisecond separator and missing arrow whitespace', async () => {
    const { cues } = await parse(vtt('WEBVTT', '', '00:00:01,000-->00:00:02,000', 'Hi'));
    expect(cues).toHaveLength(1);
    expect(cues[0].startTime).toBe(1);
  });
});

describe('cue settings', () => {
  const settings = async (line: string) =>
    (await parse(vtt('WEBVTT', '', `00:00.000 --> 00:01.000 ${line}`, 'Hi'))).cues[0];

  test('unknown settings are ignored and reported', async () => {
    const { cues, errors } = await parse(
      vtt('WEBVTT', '', '00:00.000 --> 00:01.000 foo:bar align:end', 'Hi'),
    );
    expect(cues[0].align).toBe('end');
    expect(errors.map((e) => e.message)).toEqual([
      'unknown cue setting `foo` on line 3 (value: bar)',
    ]);
  });

  test('the last occurrence of a setting wins', async () => {
    expect((await settings('align:start align:end')).align).toBe('end');
    expect((await settings('line:10% line:5')).line).toBe(5);
  });

  test('line accepts integers, negative integers, percentages, and alignment', async () => {
    let cue = await settings('line:-3');
    expect(cue.line).toBe(-3);
    expect(cue.snapToLines).toBe(true);
    cue = await settings('line:12.5%,end');
    expect(cue.line).toBe(12.5);
    expect(cue.snapToLines).toBe(false);
    expect(cue.lineAlign).toBe('end');
    cue = await settings('line:0%');
    expect(cue.line).toBe(0);
    expect(cue.snapToLines).toBe(false);
  });

  test('line rejects out-of-range percentages and bad alignments atomically', async () => {
    const { cues, errors } = await parse(
      vtt('WEBVTT', '', '00:00.000 --> 00:01.000 line:150% line:5,middle', 'Hi'),
    );
    expect(cues[0].line).toBe('auto');
    expect(cues[0].lineAlign).toBe('start');
    expect(errors).toHaveLength(2);
  });

  test('position accepts a percentage and optional alignment', async () => {
    const cue = await settings('position:25%,line-right');
    expect(cue.position).toBe(25);
    expect(cue.positionAlign).toBe('line-right');
  });

  test('percentages require a % sign in strict mode, TOLERANT: bare numbers accepted otherwise', async () => {
    expect((await settings('position:25 size:40')).position).toBe(25);
    expect((await settings('position:25 size:40')).size).toBe(40);
    await expect(
      parse(vtt('WEBVTT', '', '00:00.000 --> 00:01.000 position:25', 'Hi'), { strict: true }),
    ).rejects.toThrow(/position/);
  });

  test('size accepts percentages between 0 and 100', async () => {
    expect((await settings('size:33.3%')).size).toBe(33.3);
    expect((await settings('size:101%')).size).toBe(100);
  });

  test('align accepts the five keywords and TOLERANT: maps legacy middle to center', async () => {
    for (const align of ['start', 'center', 'end', 'left', 'right'] as const) {
      expect((await settings(`align:${align}`)).align).toBe(align);
    }
    expect((await settings('align:middle')).align).toBe('center');
  });

  test('vertical accepts rl and lr only', async () => {
    expect((await settings('vertical:rl')).vertical).toBe('rl');
    expect((await settings('vertical:lr')).vertical).toBe('lr');
    expect((await settings('vertical:tb')).vertical).toBe('');
  });

  test('settings separated by tabs or multiple spaces', async () => {
    const cue = await settings('align:start\t\tsize:50%   line:1');
    expect(cue.align).toBe('start');
    expect(cue.size).toBe(50);
    expect(cue.line).toBe(1);
  });
});

describe('regions', () => {
  test('parses region settings and links cues by id', async () => {
    const { regions, cues } = await parse(
      vtt(
        'WEBVTT',
        '',
        'REGION',
        'id:fred',
        'width:40%',
        'lines:3',
        'regionanchor:0%,100%',
        'viewportanchor:10%,90%',
        'scroll:up',
        '',
        '00:00.000 --> 00:01.000 region:fred',
        'Hi',
      ),
    );
    expect(regions).toHaveLength(1);
    expect(regions[0]).toMatchObject({
      id: 'fred',
      width: 40,
      lines: 3,
      regionAnchorX: 0,
      regionAnchorY: 100,
      viewportAnchorX: 10,
      viewportAnchorY: 90,
      scroll: 'up',
    });
    expect(cues[0].region).toBe(regions[0]);
  });

  test('region settings can share a single line with the REGION keyword', async () => {
    const { regions } = await parse(
      vtt('WEBVTT', '', 'REGION id:a width:50% lines:2', '', '00:00.000 --> 00:01.000', 'Hi'),
    );
    expect(regions[0]).toMatchObject({ id: 'a', width: 50, lines: 2 });
  });

  test('cues referencing unknown regions have no region', async () => {
    const { cues } = await parse(vtt('WEBVTT', '', '00:00.000 --> 00:01.000 region:nope', 'Hi'));
    expect(cues[0].region).toBeNull();
  });

  test('vertical, non-auto line, or size < 100 drop the region per spec', async () => {
    const base = ['WEBVTT', '', 'REGION id:r', ''];
    for (const setting of ['vertical:rl', 'line:5', 'size:50%']) {
      const { cues } = await parse(
        vtt(...base, `00:00.000 --> 00:01.000 region:r ${setting}`, 'Hi'),
      );
      expect(cues[0].region).toBeNull();
    }
  });

  test('duplicate region ids: last definition wins', async () => {
    const { regions } = await parse(
      vtt(
        'WEBVTT',
        '',
        'REGION id:r width:20%',
        '',
        'REGION id:r width:60%',
        '',
        '00:00.000 --> 00:01.000',
        'Hi',
      ),
    );
    expect(regions).toHaveLength(1);
    expect(regions[0].width).toBe(60);
  });
});
