/**
 * Deterministic generators for the benchmark inputs. Everything is seeded so every run measures
 * the same bytes; nothing here touches the filesystem.
 */

/**
 * Stores a benchmark result so the call is observable and the engine can not treat it as dead
 * code. Bench functions must return `void`, so results are parked here instead of returned.
 */
export const sink: { value: unknown } = { value: undefined };

export function keep(value: unknown) {
  sink.value = value;
}

/** mulberry32: small, fast, deterministic. */
export function createRandom(seed = 0x9e3779b9) {
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = [
  'the',
  'quick',
  'brown',
  'fox',
  'jumps',
  'over',
  'lazy',
  'dog',
  'while',
  'captions',
  'render',
  'smoothly',
  'across',
  'every',
  'player',
  'and',
  'browser',
  'tonight',
  'without',
  'delay',
];

export function sentence(random: () => number, words = 8) {
  const out: string[] = [];
  for (let i = 0; i < words; i++) out.push(WORDS[Math.floor(random() * WORDS.length)]);
  out[0] = out[0][0].toUpperCase() + out[0].slice(1);
  return out.join(' ') + '.';
}

function pad(n: number | string, width = 2) {
  return String(n).padStart(width, '0');
}

/** Splits seconds into whole h/m/s plus a fraction rounded to `scale` units (no `.1000` overflow). */
function splitTime(seconds: number, scale: number) {
  const total = Math.round(seconds * scale),
    whole = Math.floor(total / scale);
  return {
    h: Math.floor(whole / 3600),
    m: Math.floor((whole % 3600) / 60),
    s: whole % 60,
    fraction: total - whole * scale,
  };
}

/** `HH:MM:SS.mmm` (VTT) or `HH:MM:SS,mmm` (SRT). */
export function timestamp(seconds: number, separator = '.') {
  const { h, m, s, fraction } = splitTime(seconds, 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)}${separator}${pad(fraction, 3)}`;
}

/** `H:MM:SS.cc` as used by SSA/ASS. */
function assTimestamp(seconds: number) {
  const { h, m, s, fraction } = splitTime(seconds, 100);
  return `${h}:${pad(m)}:${pad(s)}.${pad(fraction)}`;
}

const VTT_SETTINGS = [
  'line:-2 align:start position:20% size:60%',
  'line:0 align:center',
  'align:end position:90% size:40%',
  'line:85% align:center position:50%',
  'vertical:rl line:-1',
  'region:top',
  '',
];

export function generateVTT(cues: number) {
  const random = createRandom(1);
  const out = [
    'WEBVTT',
    '',
    'REGION',
    'id:top',
    'width:80%',
    'lines:3',
    'regionanchor:50%,0%',
    'viewportanchor:50%,10%',
    'scroll:up',
    '',
    'STYLE',
    '::cue(.yellow) { color: yellow; }',
    '',
  ];
  for (let i = 0; i < cues; i++) {
    const start = i * 2 + random(),
      end = start + 1.5 + random();
    out.push(String(i + 1));
    out.push(
      `${timestamp(start)} --> ${timestamp(end)} ${VTT_SETTINGS[i % VTT_SETTINGS.length]}`.trimEnd(),
    );
    out.push(
      `<v Speaker ${i % 4}><c.yellow>${sentence(random, 5)}</c> <i>${sentence(random, 3)}</i>`,
    );
    out.push(
      `<b>${sentence(random, 2)}</b> &amp; <u>${sentence(random, 4)}</u> <${timestamp(start + 0.5)}>late`,
    );
    out.push('');
  }
  return out.join('\n');
}

export function generateSRT(cues: number) {
  const random = createRandom(2);
  const out: string[] = [];
  for (let i = 0; i < cues; i++) {
    const start = i * 2 + random(),
      end = start + 1.5 + random();
    out.push(String(i + 1));
    out.push(`${timestamp(start, ',')} --> ${timestamp(end, ',')}`);
    out.push(`<i>${sentence(random, 6)}</i>`);
    out.push(`<font color="#ffcc00"><b>${sentence(random, 4)}</b></font>`);
    out.push('');
  }
  return out.join('\n');
}

const ASS_TAGS = [
  '{\\an8\\pos(640,100)}',
  '{\\fad(200,200)\\b1}',
  '{\\i1\\c&H00FFFF&}',
  '{\\an2\\fs48\\bord2\\shad1}',
  '{\\move(100,600,1180,600)}',
  '{\\t(0,500,\\fscx120\\fscy120)}',
  '{\\k20}ka{\\k30}ra{\\k25}o{\\k40}ke',
  '{\\blur2\\3c&H000000&\\alpha&H40&}',
  '{\\frz15\\fax0.2}',
  '{\\clip(0,0,640,720)}',
];

export function generateASS(lines: number, styles = 20) {
  const random = createRandom(3);
  const out = [
    '[Script Info]',
    'Title: Benchmark',
    'ScriptType: v4.00+',
    'PlayResX: 1280',
    'PlayResY: 720',
    'WrapStyle: 0',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
  ];
  for (let i = 0; i < styles; i++) {
    const colour = `&H00${pad(
      Math.floor(random() * 0xffffff)
        .toString(16)
        .toUpperCase(),
      6,
    )}`;
    out.push(
      `Style: S${i},Arial,${24 + (i % 6) * 4},${colour},&H000000FF,&H00000000,&H80000000,${i % 2 ? -1 : 0},${i % 3 ? -1 : 0},0,0,100,100,0,0,1,2,2,${(i % 9) + 1},10,10,${10 + i},1`,
    );
  }
  out.push('', '[Events]');
  out.push('Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text');
  for (let i = 0; i < lines; i++) {
    const start = i * 1.5 + random(),
      end = start + 1 + random() * 2;
    const tags = ASS_TAGS[i % ASS_TAGS.length],
      inner = ASS_TAGS[(i * 7) % ASS_TAGS.length];
    out.push(
      `Dialogue: ${i % 3},${assTimestamp(start)},${assTimestamp(end)},S${i % styles},Actor${i % 5},0,0,0,,${tags}${sentence(random, 5)} ${inner}${sentence(random, 3)}\\N{\\i1}${sentence(random, 4)}{\\i0}`,
    );
  }
  return out.join('\n');
}

export function generateTTML(paragraphs: number) {
  const random = createRandom(4);
  const out = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling"',
    '    xmlns:ttp="http://www.w3.org/ns/ttml#parameter" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"',
    '    xml:lang="en" ttp:timeBase="media" ttp:frameRate="30">',
    '  <head>',
    '    <metadata><ttm:title>Benchmark</ttm:title></metadata>',
    '    <styling>',
    '      <style xml:id="base" tts:fontFamily="proportionalSansSerif" tts:color="white" tts:textAlign="center" tts:fontSize="80%"/>',
    '      <style xml:id="italic" style="base" tts:fontStyle="italic"/>',
    '      <style xml:id="yellow" style="base" tts:color="#FFFF00" tts:fontWeight="bold"/>',
    '      <style xml:id="bg" tts:backgroundColor="#00000080"/>',
    '    </styling>',
    '    <layout>',
    '      <region xml:id="top" tts:origin="10% 10%" tts:extent="80% 20%" tts:displayAlign="before"/>',
    '      <region xml:id="bottom" tts:origin="10% 70%" tts:extent="80% 20%" tts:displayAlign="after"/>',
    '    </layout>',
    '  </head>',
    '  <body style="base">',
    '    <div>',
  ];
  for (let i = 0; i < paragraphs; i++) {
    const start = i * 2 + random(),
      end = start + 1.5 + random();
    out.push(
      `      <p xml:id="p${i}" begin="${timestamp(start)}" end="${timestamp(end)}" region="${i % 2 ? 'top' : 'bottom'}" style="${i % 3 ? 'base' : 'yellow'}">`,
    );
    out.push(
      `        ${sentence(random, 4)} <span style="italic">${sentence(random, 2)}</span> <span tts:color="cyan" tts:backgroundColor="black">${sentence(random, 3)}</span><br/>`,
    );
    out.push(`        <span style="bg">${sentence(random, 5)}</span> &amp; more`);
    out.push('      </p>');
  }
  out.push('    </div>', '  </body>', '</tt>');
  return out.join('\n');
}

/** Add odd parity (bit 7) to a 7-bit CEA-608 byte. */
export function parity(byte: number) {
  let bits = 0;
  for (let b = byte; b; b >>= 1) bits += b & 1;
  return bits % 2 === 0 ? byte | 0x80 : byte;
}

function sccWord(a: number, b: number) {
  return parity(a).toString(16).padStart(2, '0') + parity(b).toString(16).padStart(2, '0');
}

function sccCtrl(a: number, b: number) {
  const w = sccWord(a, b);
  return `${w} ${w}`;
}

function sccText(str: string) {
  const words: string[] = [];
  for (let i = 0; i < str.length; i += 2) {
    words.push(sccWord(str.charCodeAt(i), i + 1 < str.length ? str.charCodeAt(i + 1) : 0));
  }
  return words.join(' ');
}

function sccTimecode(frame: number) {
  const f = frame % 30,
    totalSeconds = Math.floor(frame / 30),
    s = totalSeconds % 60,
    m = Math.floor(totalSeconds / 60) % 60,
    h = Math.floor(totalSeconds / 3600);
  return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`;
}

/**
 * Pop-on captions: every odd line loads a two-row caption (RCL, ENM, PAC row 14, text, PAC row
 * 15, text, EOC) and every even line clears it (EDM), like a real Scenarist export.
 */
export function generateSCC(lines: number) {
  const random = createRandom(5);
  const out = ['Scenarist_SCC V1.0', ''];
  let frame = 30;
  for (let i = 0; i < lines; i++) {
    if (i % 2 === 0) {
      const words = [
        sccCtrl(0x14, 0x20), // RCL
        sccCtrl(0x14, 0x2e), // ENM
        sccCtrl(0x14, 0x50), // PAC row 14, column 0
        sccCtrl(0x11, 0x2e), // italics
        sccText(sentence(random, 4).slice(0, 30)),
        sccCtrl(0x14, 0x70), // PAC row 15, column 0
        sccText(sentence(random, 4).slice(0, 30)),
        sccCtrl(0x14, 0x2f), // EOC
      ];
      out.push(`${sccTimecode(frame)}\t${words.join(' ')}`);
      frame += 45;
    } else {
      out.push(`${sccTimecode(frame)}\t${sccCtrl(0x14, 0x2c)}`); // EDM
      frame += 15;
    }
    out.push('');
  }
  return out.join('\n');
}

function lrcTimestamp(seconds: number) {
  const { h, m, s, fraction } = splitTime(seconds, 100);
  return `${pad(h * 60 + m)}:${pad(s)}.${pad(fraction)}`;
}

/** Lines alternate between plain lyrics and enhanced lyrics with per-word timestamps. */
export function generateLRC(lines: number) {
  const random = createRandom(6);
  const out = ['[ti:Benchmark]', '[ar:Generator]', '[al:Synthetic]', '[offset:0]', ''];
  for (let i = 0; i < lines; i++) {
    const start = i * 3 + random();
    if (i % 2 === 0) {
      out.push(`[${lrcTimestamp(start)}]${sentence(random, 7)}`);
    } else {
      const words = sentence(random, 6).split(' ');
      out.push(
        `[${lrcTimestamp(start)}]` +
          words.map((word, j) => `<${lrcTimestamp(start + j * 0.4)}>${word}`).join(' '),
      );
    }
  }
  return out.join('\n');
}

/** Splits a string into a stream of UTF-8 byte chunks of the given size. */
export function toByteChunks(text: string, chunkSize: number): Uint8Array[] {
  const bytes = new TextEncoder().encode(text),
    chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(bytes.subarray(offset, offset + chunkSize));
  }
  return chunks;
}

export function chunkStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(chunks[i++]);
      else controller.close();
    },
  });
}
