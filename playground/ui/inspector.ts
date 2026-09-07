import type { ParseError, ParsedCaptionsResult, VTTCue, VTTRegion } from '../../src';
import { button, clear, fmtTime, h, preview, toJSON } from './dom';
import type { InspectorTab } from './state';

export interface InspectorOptions {
  tab: InspectorTab;
  onSeek(time: number): void;
  onTab(tab: InspectorTab): void;
}

const TABS: { id: InspectorTab; label: string }[] = [
  { id: 'active', label: 'Active cues' },
  { id: 'cues', label: 'All cues' },
  { id: 'meta', label: 'Metadata' },
  { id: 'errors', label: 'Errors' },
  { id: 'events', label: 'Events' },
];

const ERROR_CODES = [
  'LoadFail',
  'BadSignature',
  'BadTimestamp',
  'BadSettingValue',
  'BadFormat',
  'UnknownSetting',
];

const MAX_EVENTS = 500;

/** Active cue JSON, the cue table, parse metadata, errors, and an events log. */
export class Inspector {
  readonly el: HTMLElement;

  private _panes: Record<InspectorTab, HTMLDivElement>;
  private _tabButtons = new Map<InspectorTab, HTMLButtonElement>();
  private _badges = new Map<InspectorTab, HTMLSpanElement>();
  private _tab: InspectorTab;
  private _onSeek: (time: number) => void;

  private _activeKey = '';
  private _activeCount = h('span', { class: 'dim' });
  private _cueRows = new Map<VTTCue, HTMLTableRowElement>();
  private _cueTable: HTMLTableSectionElement;
  private _parseErrors: HTMLDivElement;
  private _runtimeErrors: HTMLDivElement;
  private _events: HTMLDivElement;
  private _eventCount = 0;
  private _errorCount = 0;
  private _watched = new Map<VTTCue, () => void>();

  constructor({ tab, onSeek, onTab }: InspectorOptions) {
    this._tab = tab;
    this._onSeek = onSeek;

    this._cueTable = h('tbody');
    this._parseErrors = h('div', { class: 'error-list' });
    this._runtimeErrors = h('div', { class: 'error-list' });
    this._events = h('div', { class: 'events mono' });

    this._panes = {
      active: h('div', { class: 'pane' }),
      cues: h(
        'div',
        { class: 'pane' },
        h(
          'table',
          { class: 'cue-table mono' },
          h(
            'thead',
            null,
            h(
              'tr',
              null,
              h('th', null, '#'),
              h('th', null, 'start'),
              h('th', null, 'end'),
              h('th', null, 'id'),
              h('th', null, 'text'),
            ),
          ),
          this._cueTable,
        ),
      ),
      meta: h('div', { class: 'pane' }),
      errors: h(
        'div',
        { class: 'pane' },
        h('h3', null, 'Parse errors'),
        this._parseErrors,
        h(
          'h3',
          null,
          'Runtime errors ',
          button('Clear', () => this.clearRuntimeErrors(), { class: 'small' }),
        ),
        this._runtimeErrors,
      ),
      events: h(
        'div',
        { class: 'pane' },
        h(
          'div',
          { class: 'pane-tools' },
          h('span', { class: 'dim' }, 'cue enter/exit, element cuechange, track add/update/remove'),
          h('span', { class: 'spacer' }),
          button('Clear', () => this.clearEvents(), { class: 'small' }),
        ),
        this._events,
      ),
    };

    const tabs = h('div', { class: 'tabs', role: 'tablist' });
    for (const { id, label } of TABS) {
      const badge = h('span', { class: 'badge', hidden: true }),
        btn = h(
          'button',
          {
            type: 'button',
            role: 'tab',
            class: 'tab',
            onclick: () => {
              this.setTab(id);
              onTab(id);
            },
          },
          label,
          badge,
        );
      this._tabButtons.set(id, btn);
      this._badges.set(id, badge);
      tabs.append(btn);
    }

    this.el = h(
      'section',
      { class: 'panel inspector' },
      h('div', { class: 'panel-head' }, h('h2', null, 'Inspector'), this._activeCount),
      tabs,
      ...Object.values(this._panes),
    );

    this.setTab(tab);
  }

  setTab(tab: InspectorTab) {
    this._tab = tab;
    for (const [id, btn] of this._tabButtons) {
      btn.setAttribute('aria-selected', String(id === tab));
      this._panes[id].hidden = id !== tab;
    }
  }

  /** Metadata, regions, styles, and fonts from a parse result (or the live track). */
  setResult(result: Partial<ParsedCaptionsResult> | null, note?: string) {
    const pane = this._panes.meta;
    clear(pane);
    if (!result) {
      pane.append(h('p', { class: 'dim' }, note ?? 'No track loaded.'));
      return;
    }

    const section = (title: string, body: Node) => pane.append(h('h3', null, title), body);

    if (note) pane.append(h('p', { class: 'dim' }, note));
    section('metadata', h('pre', { class: 'mono' }, toJSON(result.metadata ?? {})));

    const regions = result.regions ?? [];
    section(
      `regions (${regions.length})`,
      regions.length
        ? h('pre', { class: 'mono' }, toJSON(regions.map(regionToJSON)))
        : h('p', { class: 'dim' }, 'none'),
    );

    const styles = result.styles ?? [];
    section(
      `styles (${styles.length} STYLE block${styles.length === 1 ? '' : 's'})`,
      styles.length
        ? h('pre', { class: 'mono' }, styles.join('\n\n'))
        : h('p', { class: 'dim' }, 'none'),
    );

    const fonts = result.fonts ?? [];
    section(
      `fonts (${fonts.length})`,
      fonts.length
        ? h(
            'ul',
            null,
            ...fonts.map((f) => h('li', { class: 'mono' }, `${f.name} (${f.data.length} bytes)`)),
          )
        : h('p', { class: 'dim' }, 'none'),
    );
  }

  /** Rebuilds the all-cues table. */
  setCues(cues: readonly VTTCue[]) {
    clear(this._cueTable);
    this._cueRows.clear();
    const sorted = [...cues].sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime);
    sorted.forEach((cue, i) => {
      const row = h(
        'tr',
        {
          tabindex: 0,
          title: 'Click to seek to this cue',
          onclick: () => this._onSeek(cue.startTime + 0.0005),
          onkeydown: (event: Event) => {
            if ((event as KeyboardEvent).key === 'Enter') this._onSeek(cue.startTime + 0.0005);
          },
        },
        h('td', { class: 'dim' }, String(i + 1)),
        h('td', null, fmtTime(cue.startTime)),
        h('td', null, fmtTime(cue.endTime)),
        h('td', { class: 'dim' }, cue.id || ''),
        h(
          'td',
          { class: 'text' },
          preview(cue.text, 90) ||
            h('i', { class: 'dim' }, cue.textStyle?.backgroundImage ? '(image)' : '(empty)'),
        ),
      );
      this._cueRows.set(cue, row);
      this._cueTable.append(row);
    });
    this._setBadge('cues', sorted.length);
  }

  /** Refreshes the times/text of existing rows (live cues update in place). */
  refreshCueRow(cue: VTTCue) {
    const row = this._cueRows.get(cue);
    if (!row) return;
    const cells = row.children;
    cells[1].textContent = fmtTime(cue.startTime);
    cells[2].textContent = fmtTime(cue.endTime);
    cells[4].textContent = preview(cue.text, 90) || '(empty)';
  }

  setParseErrors(errors: readonly ParseError[]) {
    clear(this._parseErrors);
    if (!errors.length) {
      this._parseErrors.append(h('p', { class: 'dim' }, 'No parse errors.'));
    }
    for (const error of errors) {
      this._parseErrors.append(
        h(
          'div',
          { class: 'error' },
          h(
            'span',
            { class: 'code mono' },
            `${ERROR_CODES[error.code] ?? 'Error'} (${error.code})`,
          ),
          error.line ? h('span', { class: 'dim mono' }, ` line ${error.line}`) : null,
          h('div', null, error.message),
        ),
      );
    }
    this._errorCount = errors.length + this._runtimeErrors.childElementCount;
    this._setBadge('errors', this._errorCount, true);
  }

  addRuntimeError(message: string, detail?: string) {
    this._runtimeErrors.append(
      h(
        'div',
        { class: 'error runtime' },
        h('span', { class: 'code mono' }, new Date().toLocaleTimeString()),
        h('div', null, message),
        detail ? h('pre', { class: 'mono dim' }, detail) : null,
      ),
    );
    this._errorCount++;
    this._setBadge('errors', this._errorCount, true);
  }

  clearRuntimeErrors() {
    clear(this._runtimeErrors);
    this._errorCount = this._parseErrors.querySelectorAll('.error').length;
    this._setBadge('errors', this._errorCount, true);
  }

  log(type: string, detail: string, time?: number) {
    const atBottom =
      this._events.scrollTop + this._events.clientHeight >= this._events.scrollHeight - 12;
    this._events.append(
      h(
        'div',
        { class: `event ${type.replace(/[^a-z]/gi, '-')}` },
        h('span', { class: 'dim' }, time === undefined ? '' : fmtTime(time)),
        h('span', { class: 'type' }, type),
        h('span', null, detail),
      ),
    );
    this._eventCount++;
    while (this._events.childElementCount > MAX_EVENTS) this._events.firstElementChild!.remove();
    if (atBottom) this._events.scrollTop = this._events.scrollHeight;
    this._setBadge('events', this._eventCount);
  }

  clearEvents() {
    clear(this._events);
    this._eventCount = 0;
    this._setBadge('events', 0);
  }

  /** Logs `enter`/`exit` for a cue until `unwatchAll()`. */
  watchCue(cue: VTTCue, getTime: () => number) {
    if (this._watched.has(cue)) return;
    const onEnter = () =>
        this.log('enter', preview(cue.text, 60) || `#${cue.id || '?'}`, getTime()),
      onExit = () => this.log('exit', preview(cue.text, 60) || `#${cue.id || '?'}`, getTime());
    cue.addEventListener('enter', onEnter);
    cue.addEventListener('exit', onExit);
    this._watched.set(cue, () => {
      cue.removeEventListener('enter', onEnter);
      cue.removeEventListener('exit', onExit);
    });
  }

  unwatchCue(cue: VTTCue) {
    this._watched.get(cue)?.();
    this._watched.delete(cue);
  }

  unwatchAll() {
    for (const stop of this._watched.values()) stop();
    this._watched.clear();
  }

  /** Per-frame: refreshes the active cue JSON when the set (or its content) changes. */
  update(active: readonly VTTCue[], time: number) {
    this._activeCount.textContent = `${active.length} active @ ${fmtTime(time)}`;
    for (const cue of active) this._cueRows.get(cue)?.classList.add('active');
    for (const [cue, row] of this._cueRows) {
      if (!active.includes(cue)) row.classList.remove('active');
    }
    this._setBadge('active', active.length);

    if (this._tab !== 'active') return;

    const json = active.map((cue) => toJSON(cue.toJSON())),
      key = json.join(' ');
    if (key === this._activeKey) return;
    this._activeKey = key;

    const pane = this._panes.active,
      open = new Set(
        [...pane.querySelectorAll<HTMLDetailsElement>('details')]
          .filter((d) => d.open)
          .map((d) => d.dataset.key),
      );
    clear(pane);
    if (!active.length) {
      pane.append(h('p', { class: 'dim' }, 'No active cues at this time.'));
      return;
    }
    active.forEach((cue, i) => {
      const entryKey = `${cue.id}|${cue.startTime}|${i}`;
      pane.append(
        h(
          'details',
          {
            class: 'cue-json',
            open: open.size ? open.has(entryKey) : i === 0,
            'data-key': entryKey,
          },
          h(
            'summary',
            { class: 'mono' },
            h('span', { class: 'dim' }, `${i + 1}. `),
            `${fmtTime(cue.startTime)} → ${fmtTime(cue.endTime)}`,
            cue.id ? h('span', { class: 'dim' }, ` #${cue.id}`) : null,
            ' ',
            h('span', { class: 'summary-text' }, preview(cue.text, 60)),
          ),
          h('pre', { class: 'mono' }, json[i]),
        ),
      );
    });
  }

  private _setBadge(tab: InspectorTab, count: number, alert = false) {
    const badge = this._badges.get(tab)!;
    badge.textContent = String(count);
    badge.hidden = count === 0;
    badge.classList.toggle('alert', alert && count > 0);
  }
}

function regionToJSON(region: VTTRegion) {
  return {
    id: region.id,
    width: region.width,
    lines: region.lines,
    regionAnchorX: region.regionAnchorX,
    regionAnchorY: region.regionAnchorY,
    viewportAnchorX: region.viewportAnchorX,
    viewportAnchorY: region.viewportAnchorY,
    scroll: region.scroll,
  };
}
