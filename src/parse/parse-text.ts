import createSRTParser from '../srt/parse';
import createVTTParser from '../vtt/parse';
import { LINE_TERMINATOR_RE } from './text-transform';
import type { CaptionsParserFactory, ParseCaptionsOptions, ParsedCaptionsResult } from './types';

export async function parseText(
  text: string,
  options?: ParseCaptionsOptions,
): Promise<ParsedCaptionsResult> {
  const stream = new ReadableStream<string>({
    start(controller) {
      const lines = text.split(LINE_TERMINATOR_RE);
      for (const line of lines) controller.enqueue(line);
      controller.close();
    },
  });

  return parseTextStream(stream, options);
}

export async function parseTextStream(
  stream: ReadableStream<string>,
  options?: ParseCaptionsOptions,
): Promise<ParsedCaptionsResult> {
  const type = options?.type ?? 'vtt';

  let factory: CaptionsParserFactory;

  if (typeof type === 'string') {
    switch (type) {
      case 'srt':
        factory = createSRTParser;
        break;
      case 'ssa':
      case 'ass':
        factory = (await import('../ass/parse')).default;
      default:
        factory = createVTTParser;
    }
  } else {
    factory = type;
  }

  let result: ParsedCaptionsResult;

  const reader = stream.getReader(),
    parser = factory(),
    errors = (__DEV__ && options?.errors !== false) || !!options?.strict || !!options?.errors;

  await parser.init({
    strict: false,
    ...options,
    errors,
    type,
    cancel() {
      reader.cancel();
      result = parser.done(true);
    },
  });

  let i = 1;
  while (true) {
    const { value, done } = await reader.read();

    if (done) {
      parser.parse('', i);
      result = parser.done(false);
      break;
    }

    parser.parse(value, i);
    i++;
  }

  return result;
}
