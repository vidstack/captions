/** Shareable playground state, mirrored into the URL query string. */

export type Aspect = '16:9' | '4:3' | '9:16';
export type Drive = 'direct' | 'sync';
export type View = 'stage' | 'canvas' | 'element' | 'gallery';
export type Stacking = 'auto' | 'reading-order' | 'spec';
export type LineStep = 'line-height' | 'box';
export type EdgeStyle = 'default' | 'uniform' | 'drop-shadow' | 'raised' | 'depressed' | 'none';
export type InspectorTab = 'active' | 'cues' | 'meta' | 'errors' | 'events';
/** Renderer feature presets: `all` is `CaptionsRenderer`, the rest use `createRenderer`. */
export const FEATURE_PRESETS = [
  'all',
  'core',
  'core-regions',
  'core-typesetting',
  'core-typesetting-animations',
] as const;
export type Features = (typeof FEATURE_PRESETS)[number];

export interface PlaygroundState {
  /** Sample id (see `samples/index.ts`). */
  format: string;
  /** Current media time in seconds. */
  t: number;
  rate: number;
  loop: boolean;
  /** Stage width in pixels (320-1280). */
  width: number;
  aspect: Aspect;
  drive: Drive;
  view: View;
  dir: 'ltr' | 'rtl';
  features: Features;
  stacking: Stacking;
  lineStep: LineStep;
  /** Safe-area inset in percent. */
  safeArea: number;
  announce: boolean;
  /** Retention in seconds; 0 leaves the renderer default (never evict). */
  retention: number;
  edge: EdgeStyle;
  /** `--cue-font-size` in cqh. */
  fontSize: number;
  color: string;
  bg: string;
  bgAlpha: number;
  edgeColor: string;
  font: string;
  reducedMotion: boolean;
  shadow: boolean;
  boxes: boolean;
  tab: InspectorTab;
}

export const DEFAULT_STATE: PlaygroundState = {
  format: 'vtt',
  t: 0,
  rate: 1,
  loop: true,
  width: 960,
  aspect: '16:9',
  drive: 'direct',
  view: 'stage',
  dir: 'ltr',
  features: 'all',
  stacking: 'auto',
  lineStep: 'line-height',
  safeArea: 1,
  announce: false,
  retention: 0,
  edge: 'default',
  fontSize: 5,
  color: '#ffffff',
  bg: '#000000',
  bgAlpha: 0.8,
  edgeColor: '#000000',
  font: 'sans-serif',
  reducedMotion: false,
  shadow: false,
  boxes: false,
  tab: 'active',
};

/** Keys whose change requires a new `CaptionsRenderer` (init-time options). */
export const RENDERER_INIT_KEYS: (keyof PlaygroundState)[] = [
  'features',
  'stacking',
  'lineStep',
  'retention',
  'announce',
];

export const FONT_FAMILIES = [
  { value: 'sans-serif', label: 'sans-serif (default)' },
  { value: 'system-ui, sans-serif', label: 'system-ui' },
  { value: 'Georgia, "Times New Roman", serif', label: 'serif' },
  { value: '"SF Mono", Menlo, Consolas, monospace', label: 'monospace' },
  { value: '"Comic Sans MS", "Chalkboard SE", casual, sans-serif', label: 'casual' },
  { value: '"Brush Script MT", cursive', label: 'cursive' },
  { value: 'Verdana, Geneva, sans-serif', label: 'Verdana' },
];

const ASPECTS: Aspect[] = ['16:9', '4:3', '9:16'];

function num(value: string | null, fallback: number, min: number, max: number) {
  if (value === null) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function bool(value: string | null, fallback: boolean) {
  if (value === null) return fallback;
  return value === '1' || value === 'true';
}

function oneOf<T extends string>(value: string | null, options: readonly T[], fallback: T): T {
  return value !== null && (options as readonly string[]).includes(value) ? (value as T) : fallback;
}

function color(value: string | null, fallback: string) {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
}

export function readState(search = location.search): PlaygroundState {
  const p = new URLSearchParams(search),
    d = DEFAULT_STATE;
  return {
    format: p.get('format') ?? d.format,
    t: num(p.get('t'), d.t, 0, 24 * 3600),
    rate: num(p.get('rate'), d.rate, 0.25, 4),
    loop: bool(p.get('loop'), d.loop),
    width: num(p.get('width'), d.width, 320, 1280),
    aspect: oneOf(p.get('aspect'), ASPECTS, d.aspect),
    drive: oneOf(p.get('drive'), ['direct', 'sync'], d.drive),
    view: oneOf(p.get('view'), ['stage', 'canvas', 'element', 'gallery'], d.view),
    dir: oneOf(p.get('dir'), ['ltr', 'rtl'], d.dir),
    features: oneOf(p.get('features'), FEATURE_PRESETS, d.features),
    stacking: oneOf(p.get('stacking'), ['auto', 'reading-order', 'spec'], d.stacking),
    lineStep: oneOf(p.get('lineStep'), ['line-height', 'box'], d.lineStep),
    safeArea: num(p.get('safeArea'), d.safeArea, 0, 25),
    announce: bool(p.get('announce'), d.announce),
    retention: num(p.get('retention'), d.retention, 0, 600),
    edge: oneOf(
      p.get('edge'),
      ['default', 'uniform', 'drop-shadow', 'raised', 'depressed', 'none'],
      d.edge,
    ),
    fontSize: num(p.get('fontSize'), d.fontSize, 3, 8),
    color: color(p.get('color'), d.color),
    bg: color(p.get('bg'), d.bg),
    bgAlpha: num(p.get('bgAlpha'), d.bgAlpha, 0, 1),
    edgeColor: color(p.get('edgeColor'), d.edgeColor),
    font: p.get('font') ?? d.font,
    reducedMotion: bool(p.get('reducedMotion'), d.reducedMotion),
    shadow: bool(p.get('shadow'), d.shadow),
    boxes: bool(p.get('boxes'), d.boxes),
    tab: oneOf(p.get('tab'), ['active', 'cues', 'meta', 'errors', 'events'], d.tab),
  };
}

/** Serialises only the values that differ from the defaults (plus `format` and `t`). */
export function serializeState(state: PlaygroundState): string {
  const p = new URLSearchParams();
  p.set('format', state.format);
  p.set('t', String(Math.round(state.t * 1000) / 1000));
  for (const key of Object.keys(DEFAULT_STATE) as (keyof PlaygroundState)[]) {
    if (key === 'format' || key === 't') continue;
    const value = state[key];
    if (value === DEFAULT_STATE[key]) continue;
    p.set(key, typeof value === 'boolean' ? (value ? '1' : '0') : String(value));
  }
  return p.toString();
}

export function writeState(state: PlaygroundState) {
  const query = serializeState(state),
    url = `${location.pathname}?${query}`;
  if (`${location.pathname}${location.search}` !== url) history.replaceState(null, '', url);
}

export function shareURL(state: PlaygroundState) {
  return `${location.origin}${location.pathname}?${serializeState(state)}`;
}

/** `#rrggbb` + alpha -> `rgba()`. */
export function rgba(hex: string, alpha: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
