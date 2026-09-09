const COMMA = ',',
  // Spec grammar: digits with an optional single fractional part; percentages carry `%`.
  PERCENT_RE = /^(\d+(?:\.\d+)?)%$/,
  BARE_NUMBER_RE = /^(\d+(?:\.\d+)?)$/,
  INTEGER_RE = /^\d+$/,
  SIGNED_NUMBER_RE = /^-?\d+(?:\.\d+)?$/;

/** Non-negative integer made of ASCII digits only (e.g., region `lines`). */
export function toNumber(text: string): number | null {
  return INTEGER_RE.test(text) ? parseInt(text, 10) : null;
}

/**
 * Parses a WebVTT percentage (e.g., `12.5%`) between 0 and 100. Decimals are preserved. With
 * `allowBare`, a number without `%` is also accepted (real-world tolerance outside strict mode).
 */
export function toPercentage(text: string, allowBare = true): number | null {
  const match = text.match(PERCENT_RE) ?? (allowBare ? text.match(BARE_NUMBER_RE) : null);
  if (!match) return null;
  const num = parseFloat(match[1]);
  return Number.isFinite(num) && num >= 0 && num <= 100 ? num : null;
}

export function toCoords(text: string, allowBare = true): [x: number, y: number] | null {
  if (!text.includes(COMMA)) return null;
  const [x, y, ...rest] = text.split(COMMA).map((part) => toPercentage(part, allowBare));
  return rest.length === 0 && x !== null && y !== null ? [x, y] : null;
}

/** Signed number with an optional fractional part (e.g., `line:-3`). Negative zero becomes 0. */
export function toFloat(text: string): number | null {
  if (!SIGNED_NUMBER_RE.test(text)) return null;
  const num = parseFloat(text);
  return Number.isFinite(num) ? num || 0 : null;
}
