const COMMA = ',',
  PERCENT_SIGN = '%';

export function toNumber(text: string): number | null {
  const num = parseInt(text, 10);
  return !Number.isNaN(num) ? num : null;
}

/**
 * Parses a WebVTT percentage (e.g., `12.5%`). Decimals are preserved as the spec allows any
 * non-negative real number between 0 and 100.
 */
export function toPercentage(text: string): number | null {
  const num = parseFloat(text.replace(PERCENT_SIGN, ''));
  return !Number.isNaN(num) && num >= 0 && num <= 100 ? num : null;
}

export function toCoords(text: string): [x: number, y: number] | null {
  if (!text.includes(COMMA)) return null;
  const [x, y] = text.split(COMMA).map(toPercentage);
  return x !== null && y !== null ? [x, y] : null;
}

export function toFloat(text: string): number | null {
  const num = parseFloat(text);
  return !Number.isNaN(num) ? num : null;
}
