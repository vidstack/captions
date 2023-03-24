import { CaptionsOverlayRenderer, VTTCue, VTTRegion } from '../src';

const overlay = document.getElementById('overlay')!;
const renderer = new CaptionsOverlayRenderer(overlay);

const cues = [
  new VTTCue(0, 10, 'Cue A...'),
  new VTTCue(10, 20, 'Cue B...'),
  new VTTCue(20, 30, 'Cue C...'),
];

const region = new VTTRegion();
cues[1].region = region;

renderer.setup([region], cues);

const input = document.getElementById('current-time')! as HTMLInputElement;
input.addEventListener('change', () => {
  renderer.currentTime = input.valueAsNumber;
});
