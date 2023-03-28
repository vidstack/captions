import { renderVTTCueString, VTTCue } from 'media-captions';

test('voices', () => {
  const cue = new VTTCue(
    0,
    100,
    '<b.foo.bar><v John>This is the way, right?</v></b>, <v.baz Jane>Sure.</v>',
  );
  expect(renderVTTCueString(cue)).toMatchInlineSnapshot(
    '"<b class=\\"foo bar\\"><span title=\\"John\\" part=\\"voice\\">This is the way, right?</span></b>, <span class=\\"baz\\" title=\\"Jane\\" part=\\"voice\\">Sure.</span>"',
  );
});

test('timestamp', () => {
  const cue = new VTTCue(0, 100, '<01:10>Go this way!');
  expect(renderVTTCueString(cue, 0)).toMatchInlineSnapshot(
    '"<span part=\\"timed\\" data-time=\\"70\\" data-future=\\"\\">Go this way!</span>"',
  );
  expect(renderVTTCueString(cue, 85)).toMatchInlineSnapshot(
    '"<span part=\\"timed\\" data-time=\\"70\\" data-past=\\"\\">Go this way!</span>"',
  );
});

test('color', () => {
  const cue = new VTTCue(0, 100, '<c.lime.bg_white>Go this way!');
  expect(renderVTTCueString(cue)).toMatchInlineSnapshot(
    '"<span style=\\"color: lime;background-color: white;\\">Go this way!</span>"',
  );
});
