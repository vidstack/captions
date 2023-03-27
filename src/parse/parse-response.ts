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
    type = contentType.match(/text\/(.*?)(?:;|$)/)?.[1] as CaptionsFileFormat | undefined,
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
