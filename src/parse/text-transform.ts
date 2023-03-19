/**
 * A WebVTT line terminator consists of one of the following:
 *
 * - A U+000D CARRIAGE RETURN U+000A LINE FEED (CRLF) character pair.
 * - A single U+000A LINE FEED (LF) character.
 * - A single U+000D CARRIAGE RETURN (CR) character.
 */
export const LINE_TERMINATOR_RE = /\r?\n|\r/gm;

export class TextLineTransformStream implements TransformStream<Uint8Array, string> {
  readonly writable: WritableStream<Uint8Array>;
  readonly readable: ReadableStream<string>;

  constructor(encoding: string) {
    const transformer = new TextStreamLineIterator(encoding);

    this.writable = new WritableStream<Uint8Array>({
      write(chunk) {
        transformer.transform(chunk);
      },
      close() {
        transformer.close();
      },
    });

    this.readable = new ReadableStream<string>({
      start(controller) {
        transformer.onLine = (line) => controller.enqueue(line);
        transformer.onClose = () => controller.close();
      },
    });
  }
}

export class TextStreamLineIterator {
  private _buffer = '';
  private _decoder: TextDecoder;

  onLine!: (line: string) => void;
  onClose!: () => void;

  constructor(encoding: string) {
    this._decoder = new TextDecoder(encoding);
  }

  transform(chunk: Uint8Array) {
    this._buffer += this._decoder.decode(chunk, { stream: true });
    const lines = this._buffer.split(LINE_TERMINATOR_RE);
    this._buffer = lines.pop() || '';
    for (let i = 0; i < lines.length; i++) this.onLine(lines[i].trim());
  }

  close() {
    if (this._buffer) this.onLine(this._buffer.trim());
    this._buffer = '';
    this.onClose();
  }
}
