import { CueTrack, VTTCue } from 'media-captions';

import { createFixture, cue, cueDisplays, nextFrame, type Fixture } from './helpers';

let fixture: Fixture;

beforeEach(() => {
  fixture = createFixture();
});

afterEach(() => {
  fixture.destroy();
});

test('open-ended cues work on top of the native VTTCue', () => {
  expect(typeof (globalThis as any).VTTCue).toBe('function');
  const live = new VTTCue(1, Infinity, 'live');
  expect(live.endTime).toBe(Infinity);
  expect(live instanceof (globalThis as any).VTTCue).toBe(true);

  live.endTime = 5;
  expect(live.endTime).toBe(5);
  live.endTime = Infinity;
  expect(live.endTime).toBe(Infinity);

  // Native text tracks accept the cue (they see a finite sentinel internally).
  const video = document.createElement('video'),
    track = video.addTextTrack('metadata');
  track.addCue(live as unknown as TextTrackCue);
  expect(track.cues?.length).toBe(1);

  const json = JSON.parse(JSON.stringify(live));
  expect(json.endTime).toBeNull();
  expect(VTTCue.from(json).endTime).toBe(Infinity);
});

test('a live track renders open-ended cues and updates them in place', async () => {
  const track = new CueTrack();
  fixture.renderer.changeTrack({ cues: track });

  const live = cue(0, Infinity, 'On air');
  track.add(live);
  fixture.renderer.currentTime = 100;
  await nextFrame();
  expect(cueDisplays(fixture.overlay).map((el) => el.textContent)).toEqual(['On air']);

  live.endTime = 50;
  track.update(live);
  await nextFrame();
  expect(cueDisplays(fixture.overlay)).toHaveLength(0);
});
