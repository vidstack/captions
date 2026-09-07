import type { CaptionsFileFormat } from '../../src';
import type { Sample } from '../samples';
import { button, clear, h, select } from './dom';

export interface SourcesOptions {
  samples: Sample[];
  onSelect(id: string): void;
  onApply(text: string, type: CaptionsFileFormat): void;
  onFile(file: File): void;
}

const TYPES: CaptionsFileFormat[] = [
  'vtt',
  'srt',
  'ssa',
  'ass',
  'ttml',
  'dfxp',
  'xml',
  'scc',
  'lrc',
  'sbv',
  'smi',
  'sami',
  'sub',
  'microdvd',
];

/** Format dropdown, editable source text, Apply, and a local file picker. */
export class SourcesPanel {
  readonly el: HTMLElement;

  private _select: HTMLSelectElement;
  private _type: HTMLSelectElement;
  private _text: HTMLTextAreaElement;
  private _desc: HTMLParagraphElement;
  private _status: HTMLDivElement;
  private _file: HTMLInputElement;
  private _apply: HTMLButtonElement;
  private _reset: HTMLButtonElement;
  private _liveLog: string[] = [];
  private _sample: Sample | null = null;
  private _onApply: SourcesOptions['onApply'];

  constructor({ samples, onSelect, onApply, onFile }: SourcesOptions) {
    this._onApply = onApply;

    this._select = select(
      [
        ...samples.map((s) => ({ value: s.id, label: s.name })),
        { value: '__file', label: '(local file)' },
      ],
      samples[0].id,
      (id) => id !== '__file' && onSelect(id),
      { 'aria-label': 'Sample' },
    );
    this._select.querySelector('option[value="__file"]')!.setAttribute('hidden', '');

    this._type = select(TYPES, 'vtt', () => {}, { 'aria-label': 'Parser type', title: 'type' });

    this._text = h('textarea', {
      class: 'source mono',
      spellcheck: 'false',
      wrap: 'off',
      'aria-label': 'Captions source',
    });
    this._text.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        this.apply();
      }
    });

    this._desc = h('p', { class: 'desc' });
    this._status = h('div', { class: 'status' });

    this._file = h('input', {
      type: 'file',
      hidden: true,
      accept: '.vtt,.srt,.ssa,.ass,.ttml,.dfxp,.xml,.scc,.lrc,.sbv,.smi,.sami,.sub,text/*',
    });
    this._file.addEventListener('change', () => {
      const file = this._file.files?.[0];
      if (file) onFile(file);
      this._file.value = '';
    });

    this._apply = button('Apply', () => this.apply(), {
      class: 'primary',
      title: 'Re-parse the text (⌘/Ctrl+Enter)',
    });
    this._reset = button('Reset', () => this.resetText(), { title: 'Restore the built-in sample' });

    this.el = h(
      'section',
      { class: 'panel sources' },
      h(
        'div',
        { class: 'panel-head' },
        h('h2', null, 'Source'),
        h('span', { class: 'spacer' }),
        h('label', { class: 'inline' }, 'Sample ', this._select),
        h('label', { class: 'inline' }, 'type ', this._type),
      ),
      this._desc,
      this._text,
      h(
        'div',
        { class: 'panel-foot' },
        this._apply,
        this._reset,
        button('Open file…', () => this._file.click()),
        button('Download', () => this.download()),
        this._file,
        h('span', { class: 'spacer' }),
        this._status,
      ),
    );
  }

  get text() {
    return this._text.value;
  }

  get type() {
    return this._type.value as CaptionsFileFormat;
  }

  setSample(sample: Sample) {
    this._sample = sample;
    this._select.value = sample.id;
    this._desc.textContent = sample.description;
    this._liveLog = [];
    if (sample.kind === 'text') {
      this._type.value = sample.type;
      this._type.disabled = false;
      this._text.value = sample.text;
      this._text.readOnly = false;
      this._apply.disabled = false;
      this._reset.disabled = false;
    } else {
      this._type.disabled = true;
      this._text.readOnly = true;
      this._text.value = '';
      this._apply.disabled = true;
      this._reset.disabled = true;
    }
  }

  /** Shows a loaded file: the dropdown reads "(local file)" and the text is editable. */
  setFile(name: string, text: string, type: CaptionsFileFormat) {
    this._sample = null;
    const option = this._select.querySelector<HTMLOptionElement>('option[value="__file"]')!;
    option.textContent = `(file) ${name}`;
    option.removeAttribute('hidden');
    this._select.value = '__file';
    this._desc.textContent = `Local file ${name} (${text.length.toLocaleString()} chars), parsed as "${type}".`;
    this._type.disabled = false;
    this._type.value = type;
    this._text.readOnly = false;
    this._text.value = text;
    this._apply.disabled = false;
    this._reset.disabled = true;
  }

  apply() {
    if (this._text.readOnly) return;
    this._onApply(this._text.value, this.type);
  }

  resetText() {
    if (this._sample?.kind === 'text') {
      this._text.value = this._sample.text;
      this.apply();
    }
  }

  setStatus(message: string, kind: 'ok' | 'error' | 'info' = 'info') {
    this._status.textContent = message;
    this._status.className = `status ${kind}`;
  }

  /** Live mode: the text area shows a rolling hex dump of the packets fed so far. */
  appendLiveLog(line: string) {
    this._liveLog.push(line);
    if (this._liveLog.length > 400) this._liveLog.splice(0, this._liveLog.length - 400);
  }

  flushLiveLog(header: string) {
    if (!this._text.readOnly) return;
    const atBottom = this._text.scrollTop + this._text.clientHeight >= this._text.scrollHeight - 8;
    this._text.value = `${header}\n\n${this._liveLog.join('\n')}`;
    if (atBottom) this._text.scrollTop = this._text.scrollHeight;
  }

  clearLiveLog() {
    this._liveLog = [];
  }

  download() {
    const sample = this._sample,
      name = sample?.kind === 'text' ? `sample.${sample.extension}` : `captions.${this.type}`,
      blob = new Blob([this._text.value], { type: 'text/plain;charset=utf-8' }),
      url = URL.createObjectURL(blob),
      a = h('a', { href: url, download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  focusText() {
    this._text.focus();
  }

  destroy() {
    clear(this.el);
  }
}
