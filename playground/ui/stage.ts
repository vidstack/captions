import { clear, h } from './dom';
import type { Aspect } from './state';

const ASPECT_RATIO: Record<Aspect, string> = {
  '16:9': '16 / 9',
  '4:3': '4 / 3',
  '9:16': '9 / 16',
};

export interface StageOptions {
  label?: string;
  mini?: boolean;
  /** Create the captions overlay element (false when a `<media-captions>` element is mounted). */
  overlay?: boolean;
}

/**
 * A mock 16:9 (or 4:3 / 9:16) video surface: a moving pattern background so motion is visible,
 * a captions overlay, and a debug layer that outlines cue boxes.
 */
export class Stage {
  readonly el: HTMLDivElement;
  readonly bg: HTMLDivElement;
  readonly orb: HTMLDivElement;
  readonly overlay: HTMLDivElement | null;
  readonly boxes: HTMLDivElement;
  readonly label: HTMLDivElement;

  private _boxEls: HTMLDivElement[] = [];

  constructor({ label = '', mini = false, overlay = true }: StageOptions = {}) {
    this.bg = h('div', { class: 'stage-bg' });
    this.orb = h('div', { class: 'stage-orb' });
    this.boxes = h('div', { class: 'stage-boxes', hidden: true });
    this.label = h('div', { class: 'stage-label' }, label);
    this.overlay = overlay ? h('div', { class: 'stage-overlay' }) : null;
    this.el = h(
      'div',
      { class: 'stage' + (mini ? ' mini' : '') },
      this.bg,
      this.orb,
      this.overlay,
      this.boxes,
      this.label,
    );
    if (!label) this.label.hidden = true;
  }

  setSize(width: number, aspect: Aspect) {
    this.el.style.setProperty('--stage-width', `${width}px`);
    this.el.style.aspectRatio = ASPECT_RATIO[aspect];
  }

  /** Moves the background pattern so playback, scrubbing, and pausing are visible. */
  setTime(time: number) {
    const x = (time * 48) % 96,
      y = (time * 24) % 96;
    this.bg.style.backgroundPosition = `${x}px ${y}px, 0 0, 0 0`;
    const angle = time * 0.6,
      ox = 50 + Math.cos(angle) * 30,
      oy = 50 + Math.sin(angle * 0.8) * 26;
    this.orb.style.left = `${ox}%`;
    this.orb.style.top = `${oy}%`;
  }

  /** Mounts an extra node (e.g., a `<media-captions>` element) above the background. */
  mount(node: Node) {
    this.boxes.before(node);
  }

  /**
   * Outlines every cue display (and region) found under `root` with its bounding box, relative
   * to the stage. Pass `null` to hide the layer.
   */
  drawBoxes(root: ParentNode | null) {
    if (!root) {
      if (!this.boxes.hidden) {
        this.boxes.hidden = true;
        clear(this.boxes);
        this._boxEls = [];
      }
      return;
    }

    this.boxes.hidden = false;
    const stageRect = this.el.getBoundingClientRect(),
      targets = [
        ...root.querySelectorAll<HTMLElement>('[data-part="region"]'),
        ...root.querySelectorAll<HTMLElement>('[data-part="cue-display"]'),
      ];

    while (this._boxEls.length < targets.length) {
      const box = h('div', { class: 'stage-box' }, h('span'));
      this.boxes.append(box);
      this._boxEls.push(box);
    }
    while (this._boxEls.length > targets.length) {
      this._boxEls.pop()!.remove();
    }

    targets.forEach((target, i) => {
      const rect = target.getBoundingClientRect(),
        box = this._boxEls[i],
        region = target.dataset.part === 'region';
      box.className = 'stage-box' + (region ? ' region' : '');
      box.style.left = `${rect.left - stageRect.left}px`;
      box.style.top = `${rect.top - stageRect.top}px`;
      box.style.width = `${rect.width}px`;
      box.style.height = `${rect.height}px`;
      const id = target.querySelector<HTMLElement>('[data-part="cue"]')?.dataset.id ?? target.id;
      box.firstElementChild!.textContent = `${region ? 'region' : 'cue'}${id ? ' #' + id : ''} ${Math.round(rect.width)}×${Math.round(rect.height)}`;
    });
  }
}
