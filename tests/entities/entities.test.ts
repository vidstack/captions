import { parseText, replaceHTMLEntities, tokenizeVTTCue, type VTTextNode } from 'media-captions';
import {
  HTML_ENTITIES_FULL,
  HTML_LEGACY_ENTITIES,
  registerFullHTMLEntities,
} from 'media-captions/entities';

// Registration is global for the process, so every "before" assertion lives in the first describe
// block and the table is only registered in the second one's `beforeAll`.

async function cueText(text: string) {
  const { cues } = await parseText(`WEBVTT\n\n00:00.000 --> 00:01.000\n${text}`);
  return (tokenizeVTTCue(cues[0])[0] as VTTextNode).data;
}

describe('before registerFullHTMLEntities()', () => {
  test('table shape matches the WHATWG entities.json', () => {
    expect(Object.keys(HTML_ENTITIES_FULL)).toHaveLength(2125); // 2,231 references, 106 legacy duplicates
    expect(HTML_LEGACY_ENTITIES).toHaveLength(106);
    for (const name of [...Object.keys(HTML_ENTITIES_FULL), ...HTML_LEGACY_ENTITIES]) {
      expect(name).toMatch(/^[a-zA-Z][a-zA-Z0-9]*$/);
    }
    for (const name of HTML_LEGACY_ENTITIES) expect(HTML_ENTITIES_FULL).toHaveProperty(name);
    expect(HTML_LEGACY_ENTITIES).toContain('not');
    expect(HTML_LEGACY_ENTITIES).not.toContain('notin');
  });

  test('names outside the built-in Latin-1 subset stay literal', async () => {
    expect(replaceHTMLEntities('&ClockwiseContourIntegral;')).toBe('&ClockwiseContourIntegral;');
    expect(replaceHTMLEntities('&nsubE;')).toBe('&nsubE;');
    expect(await cueText('a &ClockwiseContourIntegral; b')).toBe('a &ClockwiseContourIntegral; b');
  });

  test('built-in subset still decodes', () => {
    expect(replaceHTMLEntities('&amp; &lt; &nbsp;')).toBe('& < \u{a0}');
  });
});

describe('after registerFullHTMLEntities()', () => {
  beforeAll(() => {
    registerFullHTMLEntities();
    // Idempotent: a second call is a no-op.
    registerFullHTMLEntities();
  });

  test('decodes names from the full table', async () => {
    expect(replaceHTMLEntities('&ClockwiseContourIntegral;')).toBe('\u{2232}');
    expect(await cueText('a &ClockwiseContourIntegral; b')).toBe('a \u{2232} b');
  });

  test('decodes multi code point references', () => {
    const decoded = replaceHTMLEntities('&nsubE;');
    expect(decoded).toBe('\u{2ac5}\u{338}');
    expect([...decoded]).toHaveLength(2);
  });

  test('legacy (no semicolon) handling matches HTML', () => {
    // `not` is a legacy reference so `&not` decodes on its own and as a prefix of `&notin`.
    expect(replaceHTMLEntities('&not')).toBe('\u{ac}');
    expect(replaceHTMLEntities('&notin')).toBe('\u{ac}in');
    expect(replaceHTMLEntities('&notit;')).toBe('\u{ac}it;');
    // `notin` itself is not legacy: only the terminated form maps to U+2209.
    expect(replaceHTMLEntities('&notin;')).toBe('\u{2209}');
    // Full-table names that are not legacy stay literal without the `;`.
    expect(replaceHTMLEntities('&ClockwiseContourIntegral')).toBe('&ClockwiseContourIntegral');
    // Legacy names that only ship in the full table now decode without `;`.
    expect(replaceHTMLEntities('&Aacute &eth')).toBe('\u{c1} \u{f0}');
  });

  test('built-in and escaped entries still decode', () => {
    expect(replaceHTMLEntities('&amp;')).toBe('&');
    expect(replaceHTMLEntities('&amp')).toBe('&');
    expect(replaceHTMLEntities('&apos;&bsol;&Tab;&NewLine;')).toBe("'\\\t\n");
    expect(replaceHTMLEntities('&#38;&#x26;')).toBe('&&');
  });
});
