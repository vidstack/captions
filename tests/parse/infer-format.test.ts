import { inferCaptionsFormat } from 'media-captions';

test('infers from content type', () => {
  expect(inferCaptionsFormat('text/vtt; charset=utf-8')).toBe('vtt');
  expect(inferCaptionsFormat('application/x-subrip')).toBe('srt');
  expect(inferCaptionsFormat('application/ttml+xml')).toBe('ttml');
  expect(inferCaptionsFormat('text/x-ssa')).toBe('ssa');
  expect(inferCaptionsFormat('text/scc')).toBe('scc');
});

test('falls back to the URL extension for generic content types', () => {
  expect(inferCaptionsFormat('text/plain', 'https://cdn/subs/en.srt?token=1')).toBe('srt');
  expect(inferCaptionsFormat('application/octet-stream', '/subs/en.ass')).toBe('ass');
  expect(inferCaptionsFormat('application/xml', '/subs/en.dfxp')).toBe('ttml');
  expect(inferCaptionsFormat('', '/lyrics/song.lrc#x')).toBe('lrc');
  expect(inferCaptionsFormat('', '/subs/captions.sbv')).toBe('sbv');
});

test('returns undefined when unknown', () => {
  expect(inferCaptionsFormat('text/plain', '/subs/en.txt')).toBeUndefined();
  expect(inferCaptionsFormat('')).toBeUndefined();
});
