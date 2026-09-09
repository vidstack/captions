const RULE_RE = /(?<![^{}])([^{}]+)\{([^{}]*)\}/g,
  CUE_SELECTOR_RE = /::cue(?:\(([^)]*)\))?/g,
  REGION_SELECTOR_RE = /::cue-region(?:\(([^)]*)\))?/g,
  URL_RE = /url\s*\(|expression\s*\(|@import/i,
  ALLOWED_PROPERTY_RE =
    /^(?:color|background(?:-color|-image|-clip|-origin)?|text-decoration(?:-\w+)?|text-shadow|text-transform|text-combine-upright|outline(?:-\w+)?|font(?:-\w+)?|line-height|letter-spacing|word-spacing|white-space|ruby-position|opacity|visibility|padding(?:-\w+)?|border(?:-\w+)?|border-radius|box-shadow|-webkit-text-stroke(?:-\w+)?|paint-order|text-wrap(?:-\w+)?|writing-mode)$/i;

/**
 * Converts WebVTT `STYLE` block CSS into CSS that targets the overlay DOM produced by
 * `CaptionsRenderer`, scoped to the given overlay selector.
 *
 * - `::cue` selects the cue element, `::cue(sel)` selects matching nodes inside a cue.
 * - `::cue(v[voice="Bob"])`, `::cue(c)`, `::cue(:past)` and friends are mapped to the rendered
 *   markup (`data-part`, `title`, `data-past`).
 * - `::cue-region` and `::cue-region(#id)` select region elements.
 * - Declarations are limited to the presentational properties the WebVTT spec allows (plus a few
 *   harmless extras), and anything loading external resources (`url()`, `@import`) is dropped, so
 *   styles from untrusted files can not exfiltrate or restyle the page.
 *
 * Returns an empty string when nothing survives.
 */
export function transformVTTStyle(css: string, scope: string): string {
  let result = '',
    match: RegExpExecArray | null;

  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  RULE_RE.lastIndex = 0;

  while ((match = RULE_RE.exec(source))) {
    const selectors = match[1].trim(),
      declarations = sanitizeDeclarations(match[2]);

    if (!selectors || selectors.startsWith('@') || !declarations) continue;

    const rewritten = selectors
      .split(',')
      .map((selector) => rewriteSelector(selector.trim(), scope))
      .filter(Boolean)
      .join(',\n');

    if (rewritten) result += `${rewritten} {\n${declarations}\n}\n`;
  }

  return result.trim();
}

function rewriteSelector(selector: string, scope: string): string | null {
  if (!/::cue(-region)?/.test(selector)) return null;

  const rewritten = selector
    .replace(REGION_SELECTOR_RE, (_, inner) => `[data-part="region"]${rewriteInner(inner, true)}`)
    .replace(CUE_SELECTOR_RE, (_, inner) => `[data-part="cue"]${rewriteInner(inner, false)}`);

  // Anything left that looks like it tries to escape the cue (e.g., `html ::cue`) is still safe
  // because every selector is prefixed with the overlay scope.
  return `${scope} ${rewritten}`;
}

function rewriteInner(inner: string | undefined, isRegion: boolean): string {
  if (!inner) return '';

  const value = inner.trim();
  if (!value) return '';

  // `#id` matches the cue/region itself.
  if (value.startsWith('#')) return `[data-id="${escapeAttr(value.slice(1))}"]`;

  if (isRegion) return '';

  // Everything else matches nodes inside the cue.
  const mapped = value
    .replace(
      /\bv\[voice=("|')?([^"'\]]*)\1?\]/g,
      (_, __, voice) => `[data-part="voice"][title="${escapeAttr(voice)}"]`,
    )
    .replace(/(^|[\s>+~,])v(?=$|[\s.:[>+~,])/g, '$1[data-part="voice"]')
    .replace(/(^|[\s>+~,])c(?=$|[\s.:[>+~,])/g, '$1span')
    .replace(/:past\b/g, '[data-part="timed"][data-past]')
    .replace(/:future\b/g, '[data-part="timed"][data-future]');

  return ` ${mapped}`;
}

function sanitizeDeclarations(block: string): string {
  return block
    .split(';')
    .map((declaration) => declaration.trim())
    .filter((declaration) => {
      const index = declaration.indexOf(':');
      if (index <= 0) return false;
      const property = declaration.slice(0, index).trim(),
        value = declaration.slice(index + 1);
      return ALLOWED_PROPERTY_RE.test(property) && !URL_RE.test(value);
    })
    .map((declaration) => `  ${declaration};`)
    .join('\n');
}

function escapeAttr(value: string) {
  return value.replace(/["\\]/g, '\\$&');
}
