import { parseResponse } from 'media-captions';

it('should parse response', async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const lines = [
        '00:00:12,720 --> ',
        '00:00:15,120\n',
        "This is 327, I'm going in\n",
        '\n',
        '00:00:15,300 --> 00:00:16,080\n',
        'Good luck',
        ', Agent\n',
        '\n',
      ];

      const encoder = new TextEncoder();
      for (const line of lines) {
        controller.enqueue(encoder.encode(line));
      }

      controller.close();
    },
  });

  const { cues, errors } = await parseResponse(
    new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/srt',
      },
    }),
  );

  expect(cues).toHaveLength(2);
  expect(errors).toHaveLength(0);

  expect(cues[0].startTime).toBe(12.72);
  expect(cues[0].endTime).toBe(15.12);
  expect(cues[0].text).toBe("This is 327, I'm going in");

  expect(cues[1].startTime).toBe(15.3);
  expect(cues[1].endTime).toBe(16.08);
  expect(cues[1].text).toBe('Good luck, Agent');
});
