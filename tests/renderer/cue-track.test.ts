import { CueTrack, VTTCue } from 'media-captions';

const cue = (start: number, end: number, text = `${start}-${end}`) => new VTTCue(start, end, text);

test('keeps cues sorted by start then end with stable insertion', () => {
  const track = new CueTrack([cue(5, 6), cue(1, 3), cue(1, 2)]);
  track.add(cue(1, 3, 'later-equal'));
  expect(track.cues.map((c) => c.text)).toEqual(['1-2', '1-3', 'later-equal', '5-6']);
});

test('finds active cues including long ones that started earlier', () => {
  const track = new CueTrack([cue(0, 100), cue(50, 51), cue(60, 61), cue(70, 80)]);
  expect(track.activeAt(60.5).map((c) => c.text)).toEqual(['0-100', '60-61']);
  expect(track.activeAt(75).map((c) => c.text)).toEqual(['0-100', '70-80']);
  expect(track.activeAt(200)).toEqual([]);
  expect(track.activeAt(-1)).toEqual([]);
});

test('open-ended cues are active until updated', () => {
  const live = cue(10, Infinity, 'live'),
    track = new CueTrack([cue(0, 5)]),
    events: string[] = [];
  track.on((c, type) => events.push(`${type}:${c?.text ?? '*'}`));

  track.add(live);
  expect(live.endTime).toBe(Infinity);
  expect(track.activeAt(1000)).toEqual([live]);

  live.endTime = 12;
  track.update(live);
  expect(track.activeAt(11)).toEqual([live]);
  expect(track.activeAt(13)).toEqual([]);
  expect(events).toEqual(['add:live', 'update:live']);
});

test('update re-sorts when the start time changes', () => {
  const moved = cue(9, 10, 'moved'),
    track = new CueTrack([cue(0, 1), moved, cue(20, 21)]);
  moved.startTime = 25;
  moved.endTime = 26;
  track.update(moved);
  expect(track.cues.map((c) => c.text)).toEqual(['0-1', '20-21', 'moved']);
  expect(track.activeAt(25.5)).toEqual([moved]);
  expect(track.activeAt(9.5)).toEqual([]);
});

test('remove, clear, and has', () => {
  const a = cue(0, 1),
    b = cue(2, 3),
    track = new CueTrack([a, b]);
  expect(track.has(a)).toBe(true);
  expect(track.remove(a)).toBe(true);
  expect(track.remove(a)).toBe(false);
  expect(track.activeAt(0.5)).toEqual([]);
  track.clear();
  expect(track.size).toBe(0);
});

test('evicts cues past the retention window', () => {
  const track = new CueTrack([cue(0, 1), cue(2, 3), cue(4, 5), cue(6, Infinity)], { retention: 2 }),
    removed: string[] = [];
  track.on((c, type) => type === 'remove' && removed.push(c!.text));
  expect(track.evict(6)).toBe(2);
  expect(removed).toEqual(['2-3', '0-1']);
  expect(track.cues.map((c) => c.text)).toEqual(['4-5', '6-Infinity']);
  expect(track.activeAt(100).map((c) => c.text)).toEqual(['6-Infinity']);
});

test('caps the number of cues by dropping the earliest ending', () => {
  const track = new CueTrack(undefined, { maxCues: 2 });
  track.addAll([cue(0, 10), cue(1, 2), cue(3, 4)]);
  expect(track.cues.map((c) => c.text)).toEqual(['0-10', '3-4']);
});

test('adding an existing cue updates it instead of duplicating', () => {
  const a = cue(0, 1),
    track = new CueTrack([a]);
  a.endTime = 5;
  track.add(a);
  expect(track.size).toBe(1);
  expect(track.activeAt(4)).toEqual([a]);
});
