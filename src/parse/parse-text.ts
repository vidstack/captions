import SRTParser from '../srt/parse';
import WebVTTParser from '../vtt/parse';
import { LINE_TERMINATOR_RE } from './text-transform';
import type {
  CaptionsParserConstructor,
  ParseCaptionsOptions,
  ParsedCaptionsResult,
} from './types';

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

  let ParserCtor: CaptionsParserConstructor;

  if (typeof type === 'string') {
    switch (type) {
      case 'srt':
        ParserCtor = SRTParser;
        break;
      case 'ssa':
      case 'ass':
        ParserCtor = (await import('../ass/parse')).default;
      default:
        ParserCtor = WebVTTParser;
    }
  } else {
    ParserCtor = type;
  }

  let result: ParsedCaptionsResult;

  const reader = stream.getReader(),
    parser = new ParserCtor({
      ...options,
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
