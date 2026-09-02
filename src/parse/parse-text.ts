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
        factory = (await import('../srt/srt-parser')).default;
        break;
      case 'ssa':
      case 'ass':
        factory = (await import('../ssa/ssa-parser')).default;
        break;
      case 'ttml':
      case 'dfxp':
      case 'xml':
        factory = (await import('../ttml/ttml-parser')).default;
        break;
      case 'scc':
        factory = (await import('../scc/scc-parser')).default;
        break;
      case 'lrc':
        factory = (await import('../lrc/lrc-parser')).default;
        break;
      case 'sbv':
        factory = (await import('../sbv/sbv-parser')).default;
        break;
      default:
        factory = (await import('../vtt/vtt-parser')).default;
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
