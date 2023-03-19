import { parseText } from 'media-captions';

test('GOOD: cue blocks', async () => {
  const { errors, cues } = await parseText(
    [
      'WEBVTT',
      '',
      // Multiline
      '1',
      '00:00 --> 00:02',
      '- Text A1',
      '- Text A2',
      '- Text A3',
      '',
      // Factional digits (extended + short)
      '2',
      '00:00:02.100 --> 00:04.500',
      'Text B1',
      '<b>Text B2</b>',
      '',
      // Multiple spaces
      '3',
      '00:04.500\t   -->   \t00:08',
      'Text C',
      '',
      // Settings
      '00:00:08\t   -->   \t00:00:10 line:50%,end vertical:rl',
      'Text D',
    ].join('\n'),
  );

  expect(errors).toBeNull();
  expect(cues).toHaveLength(4);

  expect(cues[0].id).toBe('1');
  expect(cues[0].startTime).toBe(0);
  expect(cues[0].endTime).toBe(2);
  expect(cues[0].text).toBe('- Text A1\n- Text A2\n- Text A3');

  expect(cues[1].id).toBe('2');
  expect(cues[1].startTime).toBe(2.1);
  expect(cues[1].endTime).toBe(4.5);
  expect(cues[1].text).toBe('Text B1\n<b>Text B2</b>');

  expect(cues[2].id).toBe('3');
  expect(cues[2].startTime).toBe(4.5);
  expect(cues[2].endTime).toBe(8);
  expect(cues[2].text).toBe('Text C');

  expect(cues[3].id).toBe('');
  expect(cues[3].startTime).toBe(8);
  expect(cues[3].endTime).toBe(10);
  expect(cues[3].text).toBe('Text D');
});
