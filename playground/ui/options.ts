import { h, labelled, select } from './dom';
import {
  FONT_FAMILIES,
  type Aspect,
  type Drive,
  type EdgeStyle,
  type LineStep,
  type PlaygroundState,
  type Stacking,
} from './state';

export interface OptionsPanelOptions {
  state: PlaygroundState;
  onChange(patch: Partial<PlaygroundState>): void;
}

/** Live controls for the renderer, overlay styling, the stage, and the driving mode. */
export class OptionsPanel {
  readonly el: HTMLElement;

  private _inputs = new Map<keyof PlaygroundState, HTMLInputElement | HTMLSelectElement>();
  private _outputs = new Map<keyof PlaygroundState, HTMLElement>();
  private _announcement: HTMLDivElement;
  private _reducedMotionNote: HTMLSpanElement;

  constructor({ state, onChange }: OptionsPanelOptions) {
    const s = state,
      emit = onChange;

    const range = (
      key: keyof PlaygroundState,
      min: number,
      max: number,
      step: number,
      format: (v: number) => string,
    ) => {
      const input = h('input', { type: 'range', min, max, step, value: s[key] as number }),
        output = h('output', { class: 'mono' }, format(s[key] as number));
      input.addEventListener('input', () => {
        output.textContent = format(input.valueAsNumber);
        emit({ [key]: input.valueAsNumber });
      });
      this._inputs.set(key, input);
      this._outputs.set(key, output);
      return h('span', { class: 'range' }, input, output);
    };

    const check = (key: keyof PlaygroundState, label: string, hint?: string) => {
      const input = h('input', { type: 'checkbox', checked: s[key] as boolean });
      input.addEventListener('change', () => emit({ [key]: input.checked }));
      this._inputs.set(key, input);
      return h('label', { class: 'check', title: hint }, input, ' ', label);
    };

    const color = (key: keyof PlaygroundState) => {
      const input = h('input', { type: 'color', value: s[key] as string });
      input.addEventListener('input', () => emit({ [key]: input.value }));
      this._inputs.set(key, input);
      return input;
    };

    const sel = <K extends keyof PlaygroundState>(
      key: K,
      options: readonly (PlaygroundState[K] & string)[] | { value: string; label: string }[],
    ) => {
      const el = select(options as never, s[key] as string, (value) =>
        emit({ [key]: value } as Partial<PlaygroundState>),
      );
      this._inputs.set(key, el);
      return el;
    };

    this._announcement = h(
      'div',
      { class: 'sr-box mono', 'aria-hidden': 'true' },
      '(nothing announced yet)',
    );
    this._reducedMotionNote = h('span', { class: 'hint' });

    this.el = h(
      'section',
      { class: 'panel options' },
      h('div', { class: 'panel-head' }, h('h2', null, 'Renderer options')),
      h(
        'div',
        { class: 'panel-body' },
        h('h3', null, 'Stage'),
        labelled(
          'Width',
          range('width', 320, 1280, 10, (v) => `${v}px`),
        ),
        labelled('Aspect', sel<'aspect'>('aspect', ['16:9', '4:3', '9:16'] satisfies Aspect[])),
        labelled(
          'Driving',
          sel<'drive'>('drive', [
            { value: 'direct' satisfies Drive, label: 'renderer.currentTime each frame' },
            { value: 'sync' satisfies Drive, label: 'syncCaptionsRenderer(fakeMedia)' },
          ]),
          'How media time reaches the renderer',
        ),
        check('boxes', 'Show layout boxes', 'Outline every cue display and region per frame'),

        h(
          'h3',
          null,
          'CaptionsRenderer init',
          h('span', { class: 'hint' }, ' (recreates the renderer)'),
        ),
        labelled(
          'stacking',
          sel<'stacking'>('stacking', [
            { value: 'auto' satisfies Stacking, label: 'auto (track metadata)' },
            { value: 'reading-order' satisfies Stacking, label: 'reading-order' },
            { value: 'spec' satisfies Stacking, label: 'spec' },
          ]),
        ),
        labelled(
          'lineStep',
          sel<'lineStep'>('lineStep', ['line-height', 'box'] satisfies LineStep[]),
        ),
        labelled(
          'retention',
          range('retention', 0, 120, 5, (v) => (v ? `${v}s` : 'unset')),
          'Seconds to keep ended cues before eviction (live)',
        ),
        check('announce', 'announce (aria-live region)', 'Mirror cue text to a hidden live region'),
        h(
          'div',
          { class: 'field-block' },
          h('span', { class: 'field-label' }, 'Screen reader'),
          this._announcement,
        ),

        h('h3', null, 'CaptionsRenderer props'),
        labelled('dir', sel<'dir'>('dir', ['ltr', 'rtl'])),
        labelled(
          'safeArea',
          range('safeArea', 0, 25, 0.5, (v) => `${v}%`),
          '--overlay-padding',
        ),
        h(
          'div',
          { class: 'field-block' },
          check('reducedMotion', 'Reduced motion', 'data-reduced-motion + renderer.reducedMotion'),
          this._reducedMotionNote,
        ),

        h('h3', null, 'Overlay styling'),
        labelled(
          'Edge style',
          sel<'edge'>('edge', [
            'default',
            'uniform',
            'drop-shadow',
            'raised',
            'depressed',
            'none',
          ] satisfies EdgeStyle[]),
          'data-edge-style',
        ),
        labelled(
          'Text size',
          range('fontSize', 3, 8, 0.5, (v) => `${v}cqh`),
          '--cue-font-size',
        ),
        labelled('Text colour', color('color'), '--cue-color'),
        labelled(
          'Background',
          h(
            'span',
            { class: 'range' },
            color('bg'),
            range('bgAlpha', 0, 1, 0.05, (v) => v.toFixed(2)),
          ),
          '--cue-bg-color',
        ),
        labelled('Edge colour', color('edgeColor'), '--cue-edge-color'),
        labelled('Font family', sel<'font'>('font', FONT_FAMILIES)),

        h('h3', null, '<media-captions>'),
        check('shadow', 'Render in shadow DOM (element view)', 'Recreates the element'),
      ),
    );
  }

  /** Reflects external state changes into the controls (e.g., after URL navigation). */
  sync(state: PlaygroundState) {
    for (const [key, input] of this._inputs) {
      const value = state[key];
      if (input instanceof HTMLInputElement && input.type === 'checkbox') {
        input.checked = Boolean(value);
      } else if (String(input.value) !== String(value)) {
        input.value = String(value);
      }
      const output = this._outputs.get(key);
      if (output && input instanceof HTMLInputElement) {
        output.dispatchEvent(new Event('sync'));
      }
    }
    // Range outputs.
    const fmt: Partial<Record<keyof PlaygroundState, (v: number) => string>> = {
      width: (v) => `${v}px`,
      retention: (v) => (v ? `${v}s` : 'unset'),
      safeArea: (v) => `${v}%`,
      fontSize: (v) => `${v}cqh`,
      bgAlpha: (v) => v.toFixed(2),
    };
    for (const [key, output] of this._outputs) {
      output.textContent = fmt[key]?.(state[key] as number) ?? String(state[key]);
    }
  }

  setAnnouncement(text: string) {
    this._announcement.textContent = text || '(empty)';
    this._announcement.classList.remove('flash');
    void this._announcement.offsetWidth;
    this._announcement.classList.add('flash');
  }

  setReducedMotionSupport(supported: boolean) {
    this._reducedMotionNote.textContent = supported
      ? 'renderer.reducedMotion detected'
      : 'renderer.reducedMotion not found; attribute only';
  }
}
