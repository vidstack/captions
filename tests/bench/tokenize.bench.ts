// @vitest-environment jsdom
import {
  renderVTTCueString,
  renderVTTTokensDOM,
  renderVTTTokensString,
  tokenizeVTTCue,
  VTTCue,
} from 'media-captions';
import { bench, describe } from 'vitest';

import { createRandom, keep, sentence, timestamp } from './inputs';

const OPTIONS = { time: 500, iterations: 20 };

const random = createRandom(7);

/** Nested voice, class, colour, ruby, lang, bold/italic/underline tags plus entities. */
const HEAVY_MARKUP = Array.from(
  { length: 6 },
  (_, i) =>
    `<v Speaker ${i}><c.yellow.bg_black><b><i>${sentence(random, 3)}</i></b> &amp; <u>${sentence(random, 2)}</u></c></v>` +
    `<ruby>漢<rt>kan</rt>字<rt>ji</rt></ruby> <lang en-GB><c.#ff8800.shadow>${sentence(random, 3)}</c></lang>` +
    `<c.s-key${i}>${sentence(random, 2)}</c> &lt;not a tag&gt; &#169; &hellip;`,
).join('\n');

const PLAIN_TEXT = sentence(random, 20);

/** 500 characters with 50 timestamp tags, like a karaoke or word-timed lyric line. */
const TIMESTAMPED = (() => {
  let text = '';
  for (let i = 0; i < 50; i++) text += `<${timestamp(i * 0.25)}>word${i} `;
  // Pad the trailing text so the cue text is exactly 500 characters.
  return text + 'x'.repeat(Math.max(0, 500 - text.length));
})();

const SPANS = Object.fromEntries(
  Array.from({ length: 6 }, (_, i) => [
    `key${i}`,
    { color: '#ffffff', backgroundColor: '#000000', fontWeight: 'bold', className: 'pen' },
  ]),
);

function cue(text: string) {
  const c = new VTTCue(0, 10, text);
  c.spans = SPANS;
  return c;
}

/**
 * `tokenizeVTTCue` caches tokens per cue and re-uses them while `text`/`spans` are unchanged.
 * To measure the tokenizer itself, each call flips the cue text between two variants that differ
 * in their last character, so every call is a cache miss (plus one string comparison).
 */
function alternating(text: string) {
  const c = cue(text),
    variants = [text + 'a', text + 'b'];
  let i = 0;
  return () => {
    c.text = variants[(i ^= 1)];
    return c;
  };
}

const TEXTS = {
  'heavy markup': HEAVY_MARKUP,
  'plain text': PLAIN_TEXT,
  '500 chars / 50 timestamps': TIMESTAMPED,
};

describe('tokenizeVTTCue (cache miss: text changes every call)', () => {
  for (const [name, text] of Object.entries(TEXTS)) {
    const next = alternating(text);
    bench(
      `${name} (${text.length} chars)`,
      () => {
        keep(tokenizeVTTCue(next()));
      },
      OPTIONS,
    );
  }
});

describe('tokenizeVTTCue (cache hit: same cue, unchanged text)', () => {
  const c = cue(HEAVY_MARKUP);
  bench(
    'heavy markup',
    () => {
      keep(tokenizeVTTCue(c));
    },
    OPTIONS,
  );
});

describe('renderVTTCueString (tokenize miss + string render)', () => {
  for (const [name, text] of Object.entries(TEXTS)) {
    const next = alternating(text);
    bench(
      name,
      () => {
        keep(renderVTTCueString(next(), 5));
      },
      OPTIONS,
    );
  }
});

describe('renderVTTTokensString (pre-tokenized)', () => {
  for (const [name, text] of Object.entries(TEXTS)) {
    const tokens = tokenizeVTTCue(cue(text));
    bench(
      name,
      () => {
        keep(renderVTTTokensString(tokens, 5));
      },
      OPTIONS,
    );
  }
});

describe('renderVTTTokensDOM (jsdom, pre-tokenized)', () => {
  for (const [name, text] of Object.entries(TEXTS)) {
    const tokens = tokenizeVTTCue(cue(text));
    bench(
      name,
      () => {
        keep(renderVTTTokensDOM(tokens, 5));
      },
      OPTIONS,
    );
  }
});
