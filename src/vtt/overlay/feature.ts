import type { VTTCue } from '../vtt-cue';
import type { Box } from './box';
import type { LayoutInput } from './layout';
import type { CaptionsRendererCore, CaptionsRendererTrack } from './renderer-core';

/**
 * Parts of the cue model a feature knows how to render. In development the core warns when a
 * cue (or track) uses one that no installed feature handles, so a missing feature is a console
 * message rather than silently dropped styling.
 */
export type RendererCapability = 'regions' | 'typesetting' | 'animations' | 'styles';

/** What a feature sees of the renderer. */
export interface RendererContext {
  readonly renderer: CaptionsRendererCore;
  readonly overlay: HTMLElement;
  /** The overlay's box in pixels, refreshed on resize. */
  readonly overlayBox: Box;
}

/** The two elements rendered per cue: the positioned box and the text box inside it. */
export interface CueElements {
  display: HTMLElement;
  cue: HTMLElement;
}

/** An element the layout pass positions: a cue's display box, or a container holding cues. */
export interface LayoutTarget {
  el: HTMLElement;
  /** The cue being placed (for containers, the first active cue inside it). */
  cue: VTTCue;
  /** True when `el` is a container supplied by a feature's `containerFor` (e.g., a region). */
  container: boolean;
}

/**
 * A renderer feature plugs into the core's phases. The core owns the track, cue elements, WebVTT
 * line positioning, collision avoidance, and timed text; features add everything else (regions,
 * SSA/TTML typesetting, animations, announcements, `STYLE` blocks) and are only bundled when
 * imported.
 *
 * Hooks run in phase order, not array order, so features can not be wired incorrectly: `setup`
 * once; `changeTrack` per track; `createCue`/`disposeCue` per cue element; `containerFor`,
 * `beforeMeasure`, `measureContainer`, `writeContainer`, `writeCue` inside the layout pass; and
 * `update` after every render with the active, entered, and exited cues.
 */
export interface RendererFeature {
  /** Unique name. A later feature with the same name replaces an earlier one. */
  readonly name: string;
  /** Cue model parts this feature renders (see {@link RendererCapability}). */
  readonly capabilities?: readonly RendererCapability[];

  /** The renderer was created (overlay attributes are set). */
  setup?(ctx: RendererContext): void;
  /** A new track is being rendered (called after `reset`, before cues are attached). */
  changeTrack?(ctx: RendererContext, track: CaptionsRendererTrack): void;
  /** The renderer was reset: drop per-track state. The overlay is emptied by the core. */
  reset?(ctx: RendererContext): void;
  /** The overlay was resized: drop cached measurements. */
  resize?(ctx: RendererContext): void;
  /** The renderer was destroyed. */
  destroy?(ctx: RendererContext): void;

  /** A cue's elements were created and filled with its text (before they are inserted). */
  createCue?(ctx: RendererContext, cue: VTTCue, els: CueElements): void;
  /** A cue's elements were dropped (removed, updated, or the track was cleared). */
  disposeCue?(ctx: RendererContext, cue: VTTCue): void;

  /**
   * The element a cue is rendered into instead of the overlay (e.g., its region). Return
   * `undefined` to leave the decision to the next feature, `null` for "the overlay".
   */
  containerFor?(ctx: RendererContext, cue: VTTCue): HTMLElement | null | undefined;
  /** Runs before boxes are measured; the place for dependent writes such as region heights. */
  beforeMeasure?(ctx: RendererContext, targets: readonly LayoutTarget[]): void;
  /** Measures a container target supplied by this feature. */
  measureContainer?(ctx: RendererContext, target: LayoutTarget): LayoutInput | undefined;
  /** Writes the laid out box of a container target supplied by this feature. */
  writeContainer?(ctx: RendererContext, target: LayoutTarget, box: Box): boolean | void;
  /** Runs after the core wrote a cue's final box (in overlay pixels). */
  writeCue?(ctx: RendererContext, cue: VTTCue, display: HTMLElement, box: Box): void;

  /** Runs after every render. */
  update?(
    ctx: RendererContext,
    active: readonly VTTCue[],
    entered: readonly VTTCue[],
    exited: readonly VTTCue[],
  ): void;
}
