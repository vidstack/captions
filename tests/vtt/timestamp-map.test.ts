import { parseText, parseVTTTimestampMap, shiftVTTCues, VTTCue } from 'media-captions';

test('parses X-TIMESTAMP-MAP from HLS segments', async () => {
  const { metadata, cues } = await parseText(
    'WEBVTT\nX-TIMESTAMP-MAP=MPEGTS:900000,LOCAL:00:00:00.000\n\n00:01.000 --> 00:02.000\nhi\n',
  );
  const map = parseVTTTimestampMap(metadata);
  expect(map).toEqual({ mpegts: 900000, local: 0, offset: 10 });
  shiftVTTCues(cues, map!.offset);
  expect(cues[0].startTime).toBe(11);
  expect(cues[0].endTime).toBe(12);
});

test('handles LOCAL offsets and reversed order', () => {
  const map = parseVTTTimestampMap({ 'X-TIMESTAMP-MAP': 'LOCAL:00:00:05.000,MPEGTS:1800000' });
  expect(map).toEqual({ mpegts: 1800000, local: 5, offset: 15 });
});

test('returns null when missing or malformed', () => {
  expect(parseVTTTimestampMap({})).toBeNull();
  expect(parseVTTTimestampMap({ 'X-TIMESTAMP-MAP': 'MPEGTS:abc' })).toBeNull();
});

test('shifting never produces negative times', () => {
  const cues = [new VTTCue(1, 2, 'a')];
  shiftVTTCues(cues, -5);
  expect(cues[0].startTime).toBe(0);
  expect(cues[0].endTime).toBe(0);
});
