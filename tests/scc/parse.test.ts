import { ParseError, ParseErrorCode, parseText } from 'media-captions';

const FPS = 29.97,
  FRAME = 1 / FPS;

/** Add odd parity (bit 7) to a 7-bit CEA-608 byte. */
function parity(byte: number) {
  let bits = 0;
  for (let b = byte; b; b >>= 1) bits += b & 1;
  return bits % 2 === 0 ? byte | 0x80 : byte;
}

function hex(byte: number) {
  return parity(byte).toString(16).padStart(2, '0');
}

/** A single SCC hex word from two 7-bit bytes. */
function word(a: number, b: number) {
  return hex(a) + hex(b);
}

/**
 * A control code word transmitted twice, as required by CEA-608. Bit 3 of the first byte selects
 * the data channel (CC1 clear, CC2 set).
 */
function ctrl(a: number, b: number, channel: 1 | 2 = 1) {
  const w = word(channel === 2 ? a | 0x08 : a, b);
  return `${w} ${w}`;
}

/** Encode a string of basic characters as byte pairs (odd length padded with null). */
function text(str: string) {
  const words: string[] = [];
  for (let i = 0; i < str.length; i += 2) {
    words.push(word(str.charCodeAt(i), i + 1 < str.length ? str.charCodeAt(i + 1) : 0));
  }
  return words.join(' ');
}

const RCL = ctrl(0x14, 0x20),
  BS = ctrl(0x14, 0x21),
  RU2 = ctrl(0x14, 0x25),
  RDC = ctrl(0x14, 0x29),
  EDM = ctrl(0x14, 0x2c),
  CR = ctrl(0x14, 0x2d),
  ENM = ctrl(0x14, 0x2e),
  EOC = ctrl(0x14, 0x2f),
  TO1 = ctrl(0x17, 0x21),
  ITALICS = ctrl(0x11, 0x2e),
  RED = ctrl(0x11, 0x28),
  MUSIC_NOTE = ctrl(0x11, 0x37),
  E_ACUTE_UPPER = ctrl(0x12, 0x21);

/** Row 15 (0x14 0x60+), indent 4 = 0x60 | 0x10 | (1 << 1). */
const PAC_ROW15_INDENT4 = ctrl(0x14, 0x72),
  PAC_ROW15_COL0 = ctrl(0x14, 0x70),
  PAC_ROW14_COL0 = ctrl(0x14, 0x50),
  /** Row 15 white underline. */
  PAC_ROW15_UNDERLINE = ctrl(0x14, 0x61),
  /** Row 15 green (0x60 | (1 << 1)). */
  PAC_ROW15_GREEN = ctrl(0x14, 0x62);

function scc(lines: [string, string][], header = 'Scenarist_SCC V1.0') {
  return `${header}\n\n${lines.map(([tc, data]) => `${tc}\t${data}`).join('\n\n')}\n`;
}

function frames(timecode: string) {
  const [h, m, s, f] = timecode.split(':').map(Number);
  return ((h * 60 + m) * 60 + s) * 30 + f;
}

function seconds(timecode: string, wordOffset = 0) {
  return (frames(timecode) + wordOffset) / FPS;
}

test('sanity: parity helper produces well-known SCC words', () => {
  expect(word(0x14, 0x20)).toBe('9420');
  expect(word(0x14, 0x2e)).toBe('94ae');
  expect(word(0x14, 0x2f)).toBe('942f');
  expect(word(0x14, 0x72)).toBe('94f2');
  expect(word(0x14, 0x50)).toBe('94d0');
  expect(word(0x11, 0x2e)).toBe('91ae');
  expect(word(0x11, 0x37)).toBe('9137');
  expect(word(0x12, 0x21)).toBe('92a1');
  expect(word(0x17, 0x21)).toBe('97a1');
  expect(text('Hello')).toBe('c8e5 ecec ef80');
});

test('GOOD: pop-on caption', async () => {
  const onCue = vi.fn();

  const { cues, errors } = await parseText(
    scc([
      ['00:00:01:00', `${RCL} ${ENM} ${PAC_ROW15_INDENT4} ${text('Hello world.')}`],
      ['00:00:01:15', EOC],
      ['00:00:03:00', EDM],
    ]),
    { type: 'scc', onCue },
  );

  expect(errors).toHaveLength(0);
  expect(cues).toHaveLength(1);
  expect(onCue).toHaveBeenCalledTimes(1);

  const cue = cues[0];
  expect(cue.text).toBe('Hello world.');
  expect(cue.startTime).toBeCloseTo(seconds('00:00:01:15'), 10);
  expect(Math.abs(cue.startTime - 1.5)).toBeLessThan(FRAME);
  expect(cue.endTime).toBeCloseTo(seconds('00:00:03:00'), 10);
  expect(Math.abs(cue.endTime - 3)).toBeLessThan(FRAME);

  expect(cue.snapToLines).toBe(false);
  expect(cue.line).toBeCloseTo((14 / 15) * 100, 10);
  expect(cue.lineAlign).toBe('start');
  expect(cue.position).toBe(12.5);
  expect(cue.positionAlign).toBe('line-left');
  expect(cue.size).toBe(87.5);
  expect(cue.align).toBe('left');
});

test('GOOD: pop-on caption with EOC mid-line is offset by frame count', async () => {
  const load = `${RCL} ${ENM} ${PAC_ROW15_COL0} ${text('Hi')}`,
    { cues } = await parseText(scc([['00:00:01:00', `${load} ${EOC}`]]), { type: 'scc' });

  expect(cues).toHaveLength(1);
  // RCL RCL ENM ENM PAC PAC "Hi" = 7 words, so EOC lands on frame offset 7.
  expect(cues[0].startTime).toBeCloseTo(seconds('00:00:01:00', 7), 10);
  expect(cues[0].text).toBe('Hi');
});

test('GOOD: two-row pop-on with italic mid-row code', async () => {
  const { cues, errors } = await parseText(
    scc([
      [
        '00:00:01:00',
        `${RCL} ${ENM} ${PAC_ROW14_COL0} ${text('Hello')} ${ITALICS} ${text('there')} ` +
          `${PAC_ROW15_INDENT4} ${text('friend')}`,
      ],
      ['00:00:01:15', EOC],
      ['00:00:03:00', EDM],
    ]),
    { type: 'scc' },
  );

  expect(errors).toHaveLength(0);
  expect(cues).toHaveLength(1);

  const cue = cues[0];
  expect(cue.text).toBe('Hello <i>there</i>\nfriend');
  expect(cue.line).toBeCloseTo((13 / 15) * 100, 10);
  expect(cue.position).toBe(0);
  expect(cue.size).toBe(100);
  expect(cue.startTime).toBeCloseTo(seconds('00:00:01:15'), 10);
  expect(cue.endTime).toBeCloseTo(seconds('00:00:03:00'), 10);
});

test('GOOD: PAC and mid-row colours and underline', async () => {
  const { cues } = await parseText(
    scc([
      [
        '00:00:01:00',
        `${RCL} ${ENM} ${PAC_ROW14_COL0} ${text('Go')} ${RED} ${text('stop')} ` +
          `${PAC_ROW15_GREEN} ${text('green')} ${PAC_ROW15_UNDERLINE}`,
      ],
      ['00:00:01:15', EOC],
      ['00:00:03:00', EDM],
    ]),
    { type: 'scc' },
  );

  expect(cues).toHaveLength(1);
  expect(cues[0].text).toBe('Go <c.red>stop</c>\n<c.lime>green</c>');
});

test('GOOD: underlined PAC text wraps in <u>', async () => {
  const { cues } = await parseText(
    scc([
      ['00:00:01:00', `${RCL} ${ENM} ${PAC_ROW15_UNDERLINE} ${text('under')}`],
      ['00:00:01:15', EOC],
      ['00:00:03:00', EDM],
    ]),
    { type: 'scc' },
  );

  expect(cues).toHaveLength(1);
  expect(cues[0].text).toBe('<u>under</u>');
});

test('GOOD: roll-up captions with carriage returns', async () => {
  const { cues, errors } = await parseText(
    scc([
      ['00:00:01:00', `${RU2} ${PAC_ROW15_COL0} ${text('HELLO')}`],
      ['00:00:02:00', `${CR} ${text('WORLD')}`],
      ['00:00:03:00', `${CR} ${text('AGAIN')}`],
      ['00:00:04:00', EDM],
    ]),
    { type: 'scc' },
  );

  expect(errors).toHaveLength(0);
  expect(cues).toHaveLength(3);

  // RU2 RU2 PAC PAC = 4 words before the first character.
  expect(cues[0].text).toBe('HELLO');
  expect(cues[0].startTime).toBeCloseTo(seconds('00:00:01:00', 4), 10);
  expect(cues[0].endTime).toBeCloseTo(seconds('00:00:02:00'), 10);
  expect(cues[0].line).toBeCloseTo((14 / 15) * 100, 10);

  expect(cues[1].text).toBe('HELLO\nWORLD');
  expect(cues[1].startTime).toBeCloseTo(seconds('00:00:02:00'), 10);
  expect(cues[1].endTime).toBeCloseTo(seconds('00:00:03:00'), 10);
  expect(cues[1].line).toBeCloseTo((13 / 15) * 100, 10);

  expect(cues[2].text).toBe('WORLD\nAGAIN');
  expect(cues[2].startTime).toBeCloseTo(seconds('00:00:03:00'), 10);
  expect(cues[2].endTime).toBeCloseTo(seconds('00:00:04:00'), 10);
});

test('GOOD: paint-on captions update the displayed memory directly', async () => {
  const { cues } = await parseText(
    scc([
      ['00:00:01:00', `${RDC} ${PAC_ROW15_COL0} ${text('One')}`],
      ['00:00:02:00', text(' two')],
      ['00:00:03:00', EDM],
    ]),
    { type: 'scc' },
  );

  expect(cues).toHaveLength(2);
  expect(cues[0].text).toBe('One');
  expect(cues[0].startTime).toBeCloseTo(seconds('00:00:01:00', 4), 10);
  expect(cues[0].endTime).toBeCloseTo(seconds('00:00:02:00'), 10);
  expect(cues[1].text).toBe('One two');
  expect(cues[1].startTime).toBeCloseTo(seconds('00:00:02:00'), 10);
  expect(cues[1].endTime).toBeCloseTo(seconds('00:00:03:00'), 10);
});

test('GOOD: special, accented and extended characters', async () => {
  const { cues, errors } = await parseText(
    scc([
      [
        '00:00:01:00',
        // "♪ caf" + é (0x5c) + " CAF" + placeholder "E" replaced by extended É + " A&B <C"
        `${RCL} ${ENM} ${PAC_ROW15_COL0} ${MUSIC_NOTE} ${text(' caf\x5c CAFE')} ` +
          `${E_ACUTE_UPPER} ${text(' A&B <C')}`,
      ],
      ['00:00:01:15', EOC],
      ['00:00:03:00', EDM],
    ]),
    { type: 'scc' },
  );

  expect(errors).toHaveLength(0);
  expect(cues).toHaveLength(1);
  expect(cues[0].text).toBe('♪ café CAFÉ A&amp;B &lt;C');
});

test('GOOD: drop-frame timecodes', async () => {
  const { cues, errors } = await parseText(
    scc([
      ['00:09:59;28', `${RCL} ${ENM} ${PAC_ROW15_COL0} ${text('Drop')}`],
      ['00:10:00;00', EOC],
      ['01:00:00;00', EDM],
    ]),
    { type: 'scc' },
  );

  expect(errors).toHaveLength(0);
  expect(cues).toHaveLength(1);
  // 10 minutes drop-frame = 17982 frames = exactly 600s at 29.97.
  expect(cues[0].startTime).toBeCloseTo(600, 10);
  expect(cues[0].endTime).toBeCloseTo(3600, 10);
});

test('GOOD: doubled control codes are deduped', async () => {
  const { cues } = await parseText(
    scc([
      // "Helloo" + one (doubled) backspace = "Hello". Tab offset 1 (doubled) moves one column.
      ['00:00:01:00', `${RCL} ${ENM} ${PAC_ROW15_INDENT4} ${TO1} ${text('Helloo')} ${BS}`],
      ['00:00:01:15', EOC],
      ['00:00:03:00', EDM],
    ]),
    { type: 'scc' },
  );

  expect(cues).toHaveLength(1);
  expect(cues[0].text).toBe('Hello');
  expect(cues[0].position).toBe((5 / 32) * 100);
});

test('GOOD: identical displayed content does not split the cue', async () => {
  const load = `${RCL} ${ENM} ${PAC_ROW15_COL0} ${text('Same')}`;

  const { cues } = await parseText(
    scc([
      ['00:00:01:00', load],
      ['00:00:01:15', EOC],
      ['00:00:02:00', load],
      ['00:00:02:15', EOC],
      ['00:00:04:00', EDM],
    ]),
    { type: 'scc' },
  );

  expect(cues).toHaveLength(1);
  expect(cues[0].text).toBe('Same');
  expect(cues[0].startTime).toBeCloseTo(seconds('00:00:01:15'), 10);
  expect(cues[0].endTime).toBeCloseTo(seconds('00:00:04:00'), 10);
});

test('GOOD: channel 2 data and filler are ignored', async () => {
  const CC2_RCL = ctrl(0x1c, 0x20),
    CC2_PAC = ctrl(0x1c, 0x70),
    CC2_EOC = ctrl(0x1c, 0x2f);

  const { cues } = await parseText(
    scc([
      ['00:00:01:00', `${CC2_RCL} ${CC2_PAC} ${text('Nope')} ${CC2_EOC}`],
      ['00:00:02:00', `8080 8080 ${RCL} ${ENM} ${PAC_ROW15_COL0} ${text('Yes')} 8080`],
      ['00:00:02:15', EOC],
      ['00:00:03:00', EDM],
    ]),
    { type: 'scc' },
  );

  expect(cues).toHaveLength(1);
  expect(cues[0].text).toBe('Yes');
});

test('GOOD: channel 2 decodes CC2 and ignores CC1', async () => {
  const CC2_RCL = ctrl(0x14, 0x20, 2),
    CC2_ENM = ctrl(0x14, 0x2e, 2),
    CC2_PAC = ctrl(0x14, 0x70, 2),
    CC2_EOC = ctrl(0x14, 0x2f, 2),
    CC2_EDM = ctrl(0x14, 0x2c, 2);

  const { cues, errors } = await parseText(
    scc([
      ['00:00:01:00', `${RCL} ${ENM} ${PAC_ROW15_COL0} ${text('Nope')} ${EOC}`],
      ['00:00:02:00', `8080 ${CC2_RCL} ${CC2_ENM} ${CC2_PAC} ${text('Yes')} 8080`],
      ['00:00:02:15', CC2_EOC],
      ['00:00:03:00', `${EDM} ${CC2_EDM}`],
    ]),
    { type: 'scc', channel: 2 },
  );

  expect(errors).toHaveLength(0);
  expect(cues).toHaveLength(1);
  expect(cues[0].text).toBe('Yes');
  expect(cues[0].startTime).toBeCloseTo(seconds('00:00:02:15'), 10);
  expect(cues[0].endTime).toBeCloseTo(seconds('00:00:03:00', 2), 10);
});

test('GOOD: CC2 stream decodes identically to the same CC1 stream', async () => {
  /** Exercises every control code family: misc, PAC, mid-row, special/extended, tab, background. */
  function stream(channel: 1 | 2) {
    const c = (a: number, b: number) => ctrl(a, b, channel);
    return scc([
      [
        '00:00:01:00',
        `${c(0x14, 0x20)} ${c(0x14, 0x2e)} ${c(0x14, 0x50)} ${text('Go')} ${c(0x11, 0x28)} ` +
          `${text('stop')} ${c(0x11, 0x37)} ${c(0x10, 0x24)} ${text(' CAFE')} ${c(0x12, 0x21)} ` +
          `${c(0x14, 0x72)} ${c(0x17, 0x21)} ${text('Helloo')} ${c(0x14, 0x21)}`,
      ],
      ['00:00:01:15', c(0x14, 0x2f)],
      ['00:00:03:00', c(0x14, 0x2c)],
      ['00:00:04:00', `${c(0x14, 0x25)} ${c(0x14, 0x70)} ${text('ROLL')}`],
      ['00:00:05:00', `${c(0x14, 0x2d)} ${text('UP')}`],
      ['00:00:06:00', `${c(0x14, 0x29)} ${c(0x14, 0x70)} ${text('Paint')}`],
      ['00:00:07:00', c(0x14, 0x2c)],
    ]);
  }

  const summarize = (result: Awaited<ReturnType<typeof parseText>>) =>
    result.cues.map((cue) => ({
      text: cue.text,
      startTime: cue.startTime,
      endTime: cue.endTime,
      line: cue.line,
      position: cue.position,
      size: cue.size,
    }));

  const cc1 = await parseText(stream(1), { type: 'scc', channel: 1 }),
    cc2 = await parseText(stream(2), { type: 'scc', channel: 2 });

  expect(cc1.errors).toHaveLength(0);
  expect(cc2.errors).toHaveLength(0);
  expect(cc1.cues.length).toBeGreaterThanOrEqual(4);
  expect(cc1.cues[0].text).toBe('Go <c.red>stop♪</c><c.red.bg_blue> CAFÉ</c>\nHello');
  expect(summarize(cc2)).toEqual(summarize(cc1));

  // The default channel decodes nothing from a CC2-only stream, and vice versa.
  expect((await parseText(stream(2), { type: 'scc' })).cues).toHaveLength(0);
  expect((await parseText(stream(1), { type: 'scc', channel: 2 })).cues).toHaveLength(0);
});

test('GOOD: text mode on one channel does not affect the other', async () => {
  const TR = ctrl(0x14, 0x2a),
    CC2_TR = ctrl(0x14, 0x2a, 2),
    CC2_RCL = ctrl(0x14, 0x20, 2),
    CC2_ENM = ctrl(0x14, 0x2e, 2),
    CC2_PAC = ctrl(0x14, 0x70, 2),
    CC2_EOC = ctrl(0x14, 0x2f, 2);

  const content = scc([
    // CC1 caption while CC2 is in text mode.
    ['00:00:01:00', `${CC2_TR} ${text('cc2 text')}`],
    ['00:00:02:00', `${RCL} ${ENM} ${PAC_ROW15_COL0} ${text('One')} ${EOC}`],
    // CC2 caption while CC1 is in text mode.
    ['00:00:03:00', `${TR} ${text('cc1 text')}`],
    ['00:00:04:00', `${CC2_RCL} ${CC2_ENM} ${CC2_PAC} ${text('Two')} ${CC2_EOC}`],
    ['00:00:05:00', `${EDM} ${ctrl(0x14, 0x2c, 2)}`],
  ]);

  const cc1 = await parseText(content, { type: 'scc' }),
    cc2 = await parseText(content, { type: 'scc', channel: 2 });

  expect(cc1.cues.map((cue) => cue.text)).toEqual(['One']);
  expect(cc2.cues.map((cue) => cue.text)).toEqual(['Two']);
});

test('GOOD: tabs, runs of spaces and trailing whitespace between fields', async () => {
  const content =
    'Scenarist_SCC V1.0   \n\n' +
    `00:00:01:00\t\t${RCL}  ${ENM} \t ${PAC_ROW15_COL0}   ${text('Tabs')}   \n\n` +
    `00:00:01:15    ${EOC}\t\n\n` +
    `00:00:03:00 ${EDM}  \n`;

  const { cues, errors } = await parseText(content, { type: 'scc', errors: true });

  expect(errors).toHaveLength(0);
  expect(cues).toHaveLength(1);
  expect(cues[0].text).toBe('Tabs');
  expect(cues[0].startTime).toBeCloseTo(seconds('00:00:01:15'), 10);
  expect(cues[0].endTime).toBeCloseTo(seconds('00:00:03:00'), 10);
});

test('GOOD: open cue is flushed at end of file', async () => {
  const { cues } = await parseText(
    scc([
      ['00:00:01:00', `${RCL} ${ENM} ${PAC_ROW15_COL0} ${text('Open')}`],
      ['00:00:01:15', EOC],
      ['00:00:05:00', `${RCL} ${ENM}`],
    ]),
    { type: 'scc' },
  );

  expect(cues).toHaveLength(1);
  expect(cues[0].text).toBe('Open');
  expect(cues[0].endTime).toBeGreaterThan(cues[0].startTime);
});

test('BAD: malformed hex word is reported and skipped', async () => {
  const onError = vi.fn();

  const { cues, errors } = await parseText(
    scc([
      ['00:00:01:00', `${RCL} zz20 ${ENM} ${PAC_ROW15_COL0} ${text('Ok')}`],
      ['00:00:01:15', EOC],
      ['00:00:03:00', EDM],
    ]),
    { type: 'scc', errors: true, onError },
  );

  expect(errors).toHaveLength(1);
  expect(errors[0]).toBeInstanceOf(ParseError);
  expect(errors[0].code).toBe(ParseErrorCode.BadFormat);
  expect(errors[0].line).toBe(3);
  expect(onError).toHaveBeenCalledTimes(1);

  expect(cues).toHaveLength(1);
  expect(cues[0].text).toBe('Ok');
});

test('BAD: malformed hex word throws in strict mode', async () => {
  await expect(
    parseText(scc([['00:00:01:00', `${RCL} zz20 ${ENM}`]]), { type: 'scc', strict: true }),
  ).rejects.toBeInstanceOf(ParseError);
});

test('BAD: invalid timecode is reported', async () => {
  const { errors, cues } = await parseText(
    scc([
      ['00:00:01:30', `${RCL} ${ENM} ${PAC_ROW15_COL0} ${text('Bad')} ${EOC}`],
      ['not a timecode', `${RCL}`],
      ['00:00:02:00', `${RCL} ${ENM} ${PAC_ROW15_COL0} ${text('Good')} ${EOC}`],
      ['00:00:03:00', EDM],
    ]),
    { type: 'scc', errors: true },
  );

  expect(errors).toHaveLength(2);
  expect(errors[0].code).toBe(ParseErrorCode.BadTimestamp);
  expect(errors[0].line).toBe(3);
  expect(errors[1].code).toBe(ParseErrorCode.BadTimestamp);
  expect(errors[1].line).toBe(5);
  expect(cues).toHaveLength(1);
  expect(cues[0].text).toBe('Good');
});

test('BAD: missing header is reported', async () => {
  const content = scc(
    [['00:00:01:00', `${RCL} ${ENM} ${PAC_ROW15_COL0} ${text('Hi')} ${EOC}`]],
    '',
  );

  const { errors, cues } = await parseText(content, { type: 'scc', errors: true });
  expect(errors).toHaveLength(1);
  expect(errors[0].code).toBe(ParseErrorCode.BadSignature);
  // Still decodes the caption data.
  expect(cues).toHaveLength(1);
  expect(cues[0].text).toBe('Hi');

  await expect(parseText(content, { type: 'scc', strict: true })).rejects.toBeInstanceOf(
    ParseError,
  );
});

test('GOOD: errors are not collected when disabled', async () => {
  const { errors, cues } = await parseText(
    scc([['00:00:01:00', `${RCL} zz20 ${ENM} ${PAC_ROW15_COL0} ${text('Ok')} ${EOC}`]], ''),
    { type: 'scc', errors: false },
  );

  expect(errors).toHaveLength(0);
  expect(cues).toHaveLength(1);
});
