import { setCSSVar, setDataAttr } from '../../utils/style';
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
  if (layout.clipPath) setCSSVar(el, 'cue-clip-path', layout.clipPath);
  if (layout.fixed) setDataAttr(el, 'fixed');
}

/** Builds the `--cue-transform` value from the layout translation plus extra text transforms. */
export function buildCueTransform(layout?: CueLayout, textStyle?: CueTextStyle): string {
  const parts: string[] = [];
  if (layout?.translate?.x) parts.push(`translateX(${layout.translate.x * 100}%)`);
  if (layout?.translate?.y) parts.push(`translateY(${layout.translate.y * 100}%)`);
  if (textStyle?.transform) parts.push(textStyle.transform);
  return parts.join(' ');
}

const TEXT_STYLE_VARS: Partial<Record<keyof CueTextStyle, string>> = {
  color: 'cue-color',
  backgroundColor: 'cue-bg-color',
  textAlign: 'cue-text-align',
  whiteSpace: 'cue-white-space',
  lineHeight: 'cue-line-height',
  textStroke: 'cue-text-stroke',
  textShadow: 'cue-text-shadow',
  outline: 'cue-outline',
  paddingY: 'cue-padding-y',
};

const TEXT_STYLE_PROPS: Partial<Record<keyof CueTextStyle, string>> = {
  backgroundImage: 'background-image',
  animation: 'animation',
  fontFamily: 'font-family',
  fontSize: 'font-size',
  fontWeight: 'font-weight',
  fontStyle: 'font-style',
  textDecoration: 'text-decoration',
  letterSpacing: 'letter-spacing',
  opacity: 'opacity',
};

/** Maps `CueTextStyle` to CSS on the cue display element. */
export function applyCueTextStyle(el: HTMLElement, textStyle: CueTextStyle | undefined) {
  if (!textStyle) return;
  for (const key of Object.keys(textStyle) as (keyof CueTextStyle)[]) {
    const value = textStyle[key];
    if (value === undefined || key === 'transform' || key === 'className') continue;
    if (TEXT_STYLE_VARS[key]) setCSSVar(el, TEXT_STYLE_VARS[key]!, value);
    else if (TEXT_STYLE_PROPS[key]) el.style.setProperty(TEXT_STYLE_PROPS[key]!, value);
  }
}
