/** Tiny DOM helpers so the playground needs no framework. */

export type Child = Node | string | number | null | undefined | false;

export type Props = Record<string, unknown> & {
  class?: string;
  style?: Partial<CSSStyleDeclaration> | string;
};

const PROPERTY_KEYS = new Set([
  'value',
  'checked',
  'selected',
  'disabled',
  'readOnly',
  'textContent',
  'htmlFor',
  'innerText',
  'hidden',
  'indeterminate',
  'multiple',
  'min',
  'max',
  'step',
]);

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);

  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') {
        el.className = String(value);
      } else if (key === 'style') {
        if (typeof value === 'string') el.style.cssText = value;
        else Object.assign(el.style, value);
      } else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
      } else if (key === 'dataset') {
        Object.assign(el.dataset, value);
      } else if (PROPERTY_KEYS.has(key)) {
        (el as unknown as Record<string, unknown>)[key] = value;
      } else if (value === true) {
        el.setAttribute(key, '');
      } else {
        el.setAttribute(key, String(value));
      }
    }
  }

  append(el, children);
  return el;
}

export function append(parent: Node, children: Child[]) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function clear(el: Element) {
  el.textContent = '';
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** Formats seconds as `m:ss.mmm` (or `h:mm:ss.mmm`). */
export function fmtTime(seconds: number, precision = 3) {
  if (!Number.isFinite(seconds)) return seconds > 0 ? '∞' : '-∞';
  const sign = seconds < 0 ? '-' : '',
    abs = Math.abs(seconds),
    hours = Math.floor(abs / 3600),
    m = Math.floor((abs % 3600) / 60),
    s = abs % 60,
    sec = s.toFixed(precision).padStart(precision ? 3 + precision : 2, '0');
  return hours ? `${sign}${hours}:${String(m).padStart(2, '0')}:${sec}` : `${sign}${m}:${sec}`;
}

/** Truncates a string for previews. */
export function preview(text: string, max = 80) {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat;
}

/** `JSON.stringify` that keeps `Infinity` and drops nothing. */
export function toJSON(value: unknown) {
  return JSON.stringify(
    value,
    (_, v: unknown) => (typeof v === 'number' && !Number.isFinite(v) ? String(v) : v),
    2,
  );
}

export function select<T extends string>(
  options: readonly (T | { value: T; label: string })[],
  value: T,
  onChange: (value: T) => void,
  attrs: Props = {},
) {
  const el = h('select', attrs);
  for (const option of options) {
    const v = typeof option === 'string' ? option : option.value,
      label = typeof option === 'string' ? option : option.label;
    el.append(h('option', { value: v, selected: v === value }, label));
  }
  el.addEventListener('change', () => onChange(el.value as T));
  return el;
}

export function labelled(text: string, control: Node, hint?: string) {
  return h(
    'label',
    { class: 'field', title: hint },
    h('span', { class: 'field-label' }, text),
    control,
  );
}

export function button(label: string, onClick: (event: MouseEvent) => void, attrs: Props = {}) {
  return h('button', { type: 'button', ...attrs, onclick: onClick }, label);
}

export function throttle<T extends unknown[]>(fn: (...args: T) => void, ms: number) {
  let last = 0,
    pending: T | null = null,
    timer = 0;
  return (...args: T) => {
    const now = performance.now();
    if (now - last >= ms) {
      last = now;
      fn(...args);
    } else {
      pending = args;
      if (!timer) {
        timer = window.setTimeout(
          () => {
            timer = 0;
            last = performance.now();
            if (pending) fn(...pending);
            pending = null;
          },
          ms - (now - last),
        );
      }
    }
  };
}
