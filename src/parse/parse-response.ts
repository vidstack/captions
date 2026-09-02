import { ParseError, ParseErrorCode } from './parse-error';
import { parseTextStream } from './parse-text';
import { TextLineTransformStream } from './text-transform';
import type { CaptionsFileFormat, ParseByteStreamOptions, ParsedCaptionsResult } from './types';

export async function parseResponse(
  response: Response | Promise<Response>,
  options?: ParseByteStreamOptions,
): Promise<ParsedCaptionsResult> {
  const res = await response;

  if (!res.ok || !res.body) {
    let error!: ParseError;

    if (__DEV__) {
      error = new ParseError({
        code: ParseErrorCode.LoadFail,
        reason: !res.ok
          ? `response is not ok (status: ${res.status})`
          : `response body is missing (status: ${res.status})`,
        line: -1,
      });
      options?.onError?.(error);
    }

    return {
      metadata: {},
      cues: [],
      regions: [],
      errors: [error],
    };
  }

  const contentType = res.headers.get('content-type') || '',
    type = inferCaptionsFormat(contentType, res.url),
    encoding = contentType.match(/charset=(.*?)(?:;|$)/)?.[1];

  return parseByteStream(res.body, { type, encoding, ...options });
}

export async function parseByteStream(
  stream: ReadableStream<Uint8Array>,
  { encoding = 'utf-8', ...options }: ParseByteStreamOptions = {},
): Promise<ParsedCaptionsResult> {
  const textStream = stream.pipeThrough(new TextLineTransformStream(encoding));
  return parseTextStream(textStream, options);
}

const MIME_FORMATS: [RegExp, CaptionsFileFormat][] = [
  [/vtt/i, 'vtt'],
  [/subrip|srt/i, 'srt'],
  [/ttml|dfxp|ttaf/i, 'ttml'],
  [/x-ssa|\bssa\b|\bass\b|substation/i, 'ssa'],
  [/scc|scenarist/i, 'scc'],
  [/lrc/i, 'lrc'],
  [/sbv/i, 'sbv'],
];

const EXTENSION_FORMATS: Record<string, CaptionsFileFormat> = {
  vtt: 'vtt',
  srt: 'srt',
  ssa: 'ssa',
  ass: 'ass',
  ttml: 'ttml',
  dfxp: 'ttml',
  xml: 'ttml',
  scc: 'scc',
  lrc: 'lrc',
  sbv: 'sbv',
};

/**
 * Infers the captions format from a response `Content-Type` header, falling back to the URL
 * file extension. Returns `undefined` when neither is recognised so the VTT parser is used.
 */
export function inferCaptionsFormat(
  contentType: string,
  url?: string,
): CaptionsFileFormat | undefined {
  const mime = contentType.split(';')[0].trim();

  if (mime && !/^(text\/plain|application\/octet-stream|application\/xml|text\/xml)$/i.test(mime)) {
    for (const [re, format] of MIME_FORMATS) if (re.test(mime)) return format;
  }

  if (url) {
    const extension = url
      .split(/[?#]/)[0]
      .match(/\.([a-z0-9]+)$/i)?.[1]
      .toLowerCase();
    if (extension && EXTENSION_FORMATS[extension]) return EXTENSION_FORMATS[extension];
  }

  return undefined;
}
