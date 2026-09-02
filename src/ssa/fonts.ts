import type { EmbeddedFont } from '../parse/types';

/**
 * Decodes the UUEncode variant used by SSA/ASS `[Fonts]` and `[Graphics]` sections. Every
 * 3 bytes are encoded as 4 characters in the range `!` (33) to `` ` `` (96).
 */
export function decodeUUEncodedFont(text: string): Uint8Array {
  const clean = text.replace(/\s+/g, ''),
    bytes: number[] = [];

  for (let i = 0; i < clean.length; i += 4) {
    const chunk = clean.slice(i, i + 4),
      values = Array.from(chunk, (char) => char.charCodeAt(0) - 33);

    if (values.length >= 2) bytes.push(((values[0] & 0x3f) << 2) | ((values[1] & 0x3f) >> 4));
    if (values.length >= 3) bytes.push(((values[1] & 0x0f) << 4) | ((values[2] & 0x3f) >> 2));
    if (values.length >= 4) bytes.push(((values[2] & 0x03) << 6) | (values[3] & 0x3f));
  }

  return new Uint8Array(bytes);
}

/**
 * Loads fonts embedded in a captions file (currently SSA/ASS `[Fonts]` sections) using the
 * `FontFace` API so cues styled with those font families render correctly. Returns the loaded
 * `FontFace` objects so they can be removed from `document.fonts` later.
 */
export async function loadEmbeddedFonts(fonts: EmbeddedFont[]): Promise<FontFace[]> {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined') return [];

  const loaded: FontFace[] = [];

  for (const font of fonts) {
    const family = font.name.replace(/\.(ttf|otf|woff2?)$/i, '').replace(/_[BI0-9]+$/, '');
    const data = new Uint8Array(font.data);

    try {
      const face = new FontFace(family, data.buffer as ArrayBuffer);
      await face.load();
      document.fonts.add(face);
      loaded.push(face);
    } catch {
      // Ignore fonts the browser can not decode.
    }
  }

  return loaded;
}
