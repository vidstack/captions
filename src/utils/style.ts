export function setCSSVar(el: HTMLElement, name: string, value: string | number) {
  el.style.setProperty(`--${name}`, value + '');
}

export function setDataAttr(el: Element, name: string, value: string | true | number = true) {
  el.setAttribute(`data-${name}`, value === true ? '' : value + '');
}

export function setPartAttr(el: Element, name: string) {
  el.setAttribute('part', name);
}

export function getLineHeight(el: Element) {
  return parseFloat(getComputedStyle(el).lineHeight) || 0;
}

export function getPaddingY(el: Element) {
  const style = getComputedStyle(el);
  return parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) || 0;
}
