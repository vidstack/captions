import { renderVTTCueString, VTTCue } from 'media-captions';

test('voices', () => {
  const cue = new VTTCue(
    0,
    100,
    '<b.foo.bar><v John>This is the way, right?</v></b>, <v.baz Jane>Sure.</v>',
  );
  expect(renderVTTCueString(cue)).toMatchInlineSnapshot(
    '"<b class=\\"foo bar\\"><span title=\\"John\\" data-voice=\\"true\\">This is the way, right?</span></b>, <span class=\\"baz\\" title=\\"Jane\\" data-voice=\\"true\\">Sure.</span>"',
  );
});

test('timestamp', () => {
  const cue = new VTTCue(0, 100, '<01:10>Go this way!');
  expect(renderVTTCueString(cue, 0)).toMatchInlineSnapshot(
    '"<span data-timed=\\"true\\" data-future=\\"true\\">Go this way!</span>"',
  );
  expect(renderVTTCueString(cue, 85)).toMatchInlineSnapshot(
    '"<span data-timed=\\"true\\" data-past=\\"true\\">Go this way!</span>"',
  );
});

test('color', () => {
  const cue = new VTTCue(0, 100, '<c.lime.bg_white>Go this way!');
  expect(renderVTTCueString(cue)).toMatchInlineSnapshot(
    '"<span data-color=\\"lime\\" data-bg-color=\\"white\\">Go this way!</span>"',
  );
});
