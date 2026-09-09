import { setCSSVar, setDataAttr } from '../../utils/style';
import {
  fontWeightToCSS,
  lengthToCSS,
  outlineToCSS,
  shadowToCSS,
  strokeToCSS,
  textDecorationToCSS,
  transformOriginToCSS,
  transformToCSS,
} from '../style-css';
import type { CueLayout, CueTextStyle } from '../vtt-cue';

const SIDES = ['top', 'right', 'bottom', 'left'] as const;

/** Maps `CueLayout` to the `--cue-*` custom properties the stylesheet consumes. */
export function applyCueLayout(el: HTMLElement, layout: CueLayout | undefined) {
  if (!layout) return;
  for (const side of SIDES) {
    if (layout[side] !== undefined) setCSSVar(el, `cue-${side}`, layout[side] + '%');
  }
  if (layout.width !== undefined) {
    setCSSVar(
      el,
      'cue-width',
      typeof layout.width === 'number' ? layout.width + '%' : layout.width,
    );
  }
  if (layout.maxWidth !== undefined) setCSSVar(el, 'cue-max-width', layout.maxWidth + '%');
  if (layout.height !== undefined) setCSSVar(el, 'cue-height', layout.height + '%');
  if (layout.fixed) setDataAttr(el, 'fixed');
  // `layout.clip` is resolved against the final box in the write phase (typesetting feature).
}

/** Builds the `--cue-transform` value from the layout translation plus the text transform. */
export function buildCueTransform(layout?: CueLayout, textStyle?: CueTextStyle): string {
  const parts: string[] = [];
  if (layout?.translate?.x) parts.push(`translateX(${layout.translate.x * 100}%)`);
  if (layout?.translate?.y) parts.push(`translateY(${layout.translate.y * 100}%)`);
  const transform = transformToCSS(textStyle?.transform);
  if (transform) parts.push(transform);
  return parts.join(' ');
}

/**
 * Maps `CueTextStyle` to CSS on the cue display element: stylesheet variables where the
 * stylesheet consumes them (so user styles can still override), properties otherwise.
 */
export function applyCueTextStyle(
  el: HTMLElement,
  text: CueTextStyle | undefined,
  layout?: CueLayout,
) {
  if (!text) return;
  const prop = (name: string, value: string | undefined) => {
    if (value !== undefined) el.style.setProperty(name, value);
  };

  if (text.color !== undefined) setCSSVar(el, 'cue-color', text.color);
  if (text.backgroundColor !== undefined) setCSSVar(el, 'cue-bg-color', text.backgroundColor);
  if (text.textAlign !== undefined) setCSSVar(el, 'cue-text-align', text.textAlign);
  if (text.wrap !== undefined)
    setCSSVar(el, 'cue-white-space', text.wrap === 'nowrap' ? 'pre' : 'pre-wrap');
  if (text.lineHeight !== undefined) {
    setCSSVar(
      el,
      'cue-line-height',
      text.lineHeight === 'normal' ? 'normal' : lengthToCSS(text.lineHeight),
    );
  }
  if (text.stroke !== undefined) setCSSVar(el, 'cue-text-stroke', strokeToCSS(text.stroke));
  if (text.shadow !== undefined) setCSSVar(el, 'cue-text-shadow', shadowToCSS(text.shadow));
  if (text.outline !== undefined) setCSSVar(el, 'cue-outline', outlineToCSS(text.outline));
  if (text.padding?.x !== undefined) setCSSVar(el, 'cue-padding-x', lengthToCSS(text.padding.x));
  if (text.padding?.y !== undefined) setCSSVar(el, 'cue-padding-y', lengthToCSS(text.padding.y));
  // A variable so the text box (the target of transform animations) shares the pivot.
  const origin = transformOriginToCSS(text.transform, layout);
  if (origin) setCSSVar(el, 'cue-transform-origin', origin);

  prop('font-family', text.fontFamily);
  if (text.fontSize !== undefined) prop('font-size', lengthToCSS(text.fontSize));
  prop('font-weight', fontWeightToCSS(text.fontWeight));
  if (text.italic !== undefined) prop('font-style', text.italic ? 'italic' : 'normal');
  prop('text-decoration', textDecorationToCSS(text.underline, text.strike));
  if (text.letterSpacing !== undefined) prop('letter-spacing', lengthToCSS(text.letterSpacing));
  if (text.opacity !== undefined) prop('opacity', String(text.opacity));
  if (text.image) {
    prop('background-image', `url(${JSON.stringify(text.image.url)})`);
    if (text.image.fit)
      prop('background-size', text.image.fit === 'fill' ? '100% 100%' : text.image.fit);
  }
}
