import { CaptionsRenderer, parseText, VTTCue, VTTRegion } from '../src';

type Scenario = (
  mount: (label?: string, small?: boolean) => CaptionsRenderer,
) => Promise<void> | void;

const root = document.getElementById('root')!,
  timeInput = document.getElementById('current-time') as HTMLInputElement,
  renderers: CaptionsRenderer[] = [];

function mount(label?: string, small = false) {
  const viewport = document.createElement('div');
  viewport.className = 'viewport' + (small ? ' small' : '');
  if (label) {
    const tag = document.createElement('div');
    tag.className = 'label';
    tag.textContent = label;
    viewport.append(tag);
  }
  const overlay = document.createElement('div');
  viewport.append(overlay);
  root.append(viewport);
  const renderer = new CaptionsRenderer(overlay);
  renderers.push(renderer);
  return renderer;
}

function cue(start: number, end: number, text: string, settings: Partial<VTTCue> = {}) {
  const cue = new VTTCue(start, end, text);
  Object.assign(cue, settings);
  return cue;
}

const scenarios: Record<string, Scenario> = {
  cues(mount) {
    const renderer = mount();
    renderer.changeTrack({
      cues: [
        cue(0, 10, 'line:0 (snap to first line)', { line: 0 }),
        cue(0, 10, 'line:50% position:10% size:35% align:start', {
          snapToLines: false,
          line: 50,
          position: 10,
          size: 35,
          align: 'start',
        }),
        cue(0, 10, 'position:90% size:35% align:end', {
          position: 90,
          size: 35,
          align: 'end',
          line: -4,
        }),
        cue(
          0,
          10,
          '<v Narrator>Default cue with <b>bold</b>, <i>italic</i>, and <c.yellow>colour</c>',
        ),
        cue(0, 10, 'Karaoke <00:00:01.000>timed <00:00:02.000>text <00:00:04.000>updates', {
          line: -6,
        }),
      ],
    });
  },

  regions(mount) {
    const renderer = mount();
    const top = new VTTRegion();
    Object.assign(top, {
      id: 'top',
      width: 45,
      lines: 2,
      regionAnchorX: 0,
      regionAnchorY: 0,
      viewportAnchorX: 5,
      viewportAnchorY: 8,
    });
    const bottom = new VTTRegion();
    Object.assign(bottom, {
      id: 'bottom',
      width: 60,
      lines: 3,
      regionAnchorX: 100,
      regionAnchorY: 100,
      viewportAnchorX: 95,
      viewportAnchorY: 92,
      scroll: 'up',
    });
    const cues = [
      cue(0, 10, 'REGION top: width 45%, anchored top-left'),
      cue(0, 10, 'Second line in the top region'),
      cue(0, 10, 'REGION bottom: width 60%, 3 lines, scroll:up'),
      cue(1, 10, 'Roll-up captions push older lines'),
      cue(2, 10, 'upwards as new cues arrive'),
    ];
    cues[0].region = cues[1].region = top;
    cues[2].region = cues[3].region = cues[4].region = bottom;
    renderer.changeTrack({ regions: [top, bottom], cues });
  },

  'region-scroll'(mount) {
    const renderer = mount();
    const region = new VTTRegion();
    Object.assign(region, { id: 'rollup', width: 70, lines: 3, viewportAnchorX: 15, scroll: 'up' });
    region.regionAnchorX = 0;
    const lines = [
      'Roll-up caption line one',
      'Roll-up caption line two',
      'Roll-up caption line three',
      'Line four scrolls the first line out',
      'Line five keeps rolling',
    ];
    const cues = lines.map((text, i) => cue(i * 0.8, 20, text));
    for (const c of cues) c.region = region;
    renderer.changeTrack({ regions: [region], cues });
  },

  async ssa(mount) {
    const renderer = mount();
    const ass = `[Script Info]
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,52,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,3,2,2,40,40,40,1
Style: Sign,Arial,40,&H0000FFFF,&H000000FF,&H00203040,&H00000000,-1,0,0,0,100,100,0,0,3,4,0,8,40,40,30,1
Style: Note,Arial,34,&H00FFD0A0,&H000000FF,&H00000000,&H00000000,0,-1,0,0,100,100,1,0,1,2,0,7,40,40,120,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:10.00,Default,Rin,0,0,0,,Outlined dialogue with {\\i1}italics{\\i0} and {\\c&H00A5FF&}colour{\\r} tags
Dialogue: 1,0:00:00.00,0:00:10.00,Sign,,0,0,0,,BorderStyle 3 opaque box, top centre
Dialogue: 0,0:00:00.00,0:00:10.00,Note,,0,0,0,,Top-left italic note with letter spacing
Dialogue: 0,0:00:00.00,0:00:10.00,Default,,0,0,0,,{\\pos(640,400)\\an5}\\pos(640,400) centred anchor
Dialogue: 0,0:00:00.00,0:00:10.00,Default,,0,0,0,,{\\an1}{\\k60}Ka{\\k60}ra{\\k60}o{\\k60}ke
`;
    const result = await parseText(ass, { type: 'ass' });
    renderer.changeTrack(result);
  },

  'edge-styles'(mount) {
    root.classList.add('grid');
    for (const style of ['uniform', 'drop-shadow', 'raised', 'depressed'] as const) {
      const renderer = mount(`data-edge-style="${style}"`, true);
      renderer.overlay.setAttribute('data-edge-style', style);
      renderer.overlay.style.setProperty('--cue-bg-color', 'transparent');
      renderer.changeTrack({ cues: [cue(0, 10, `${style} edge style`)] });
    }
  },

  collisions(mount) {
    const renderer = mount();
    renderer.changeTrack({
      cues: [
        cue(0, 10, 'Three cues share the same line setting'),
        cue(0.5, 10, 'so collision avoidance stacks them'),
        cue(1, 10, 'without overlap, in cue order'),
        cue(0, 10, 'line:1 top cue', { line: 1 }),
        cue(0.5, 10, 'another line:1 cue pushed down', { line: 1 }),
      ],
    });
  },
};

const params = new URLSearchParams(location.search),
  name = params.get('scenario') ?? 'cues',
  scenario = scenarios[name] ?? scenarios.cues;

document.getElementById('links')!.innerHTML = Object.keys(scenarios)
  .map((key) => `<a href="?scenario=${key}">${key}</a>`)
  .join(' · ');

function setTime(time: number) {
  for (const renderer of renderers) renderer.currentTime = time;
}

await scenario(mount);
setTime(Number(params.get('time') ?? timeInput.value));
timeInput.addEventListener('change', () => setTime(timeInput.valueAsNumber));

// Signal to screenshot tooling that cues are rendered.
requestAnimationFrame(() =>
  requestAnimationFrame(() => document.body.setAttribute('data-ready', '')),
);
