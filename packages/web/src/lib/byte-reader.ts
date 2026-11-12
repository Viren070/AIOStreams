export interface ByteReader {
  /** Fewer than `length` at the end of the file, or when the source cuts a read short. */
  read(start: number, length: number): Promise<Uint8Array>;
  /** One request; it may end early. */
  stream?(start: number, length: number): AsyncIterable<Uint8Array>;
}

/** Reads of the first bytes come from `start`. */
export function withStart(reader: ByteReader, start: Uint8Array): ByteReader {
  return {
    read: (at, length) =>
      at + length <= start.length
        ? Promise.resolve(start.subarray(at, at + length))
        : reader.read(at, length),
    stream: reader.stream && ((at, length) => reader.stream!(at, length)),
  };
}

export async function* readsInTurn(
  reader: ByteReader,
  start: number,
  length: number
): AsyncGenerator<Uint8Array> {
  for (let at = start; at < start + length;) {
    const bytes = await reader.read(at, start + length - at);
    if (!bytes.length) return;
    yield bytes;
    at += bytes.length;
  }
}

export const streamOf = (reader: ByteReader, start: number, length: number) =>
  reader.stream?.(start, length) ?? readsInTurn(reader, start, length);

export class StreamCursor {
  private chunks: Uint8Array[] = [];
  private held = 0;
  private ended = false;
  private readonly source: AsyncIterator<Uint8Array>;

  constructor(chunks: AsyncIterable<Uint8Array>) {
    this.source = chunks[Symbol.asyncIterator]();
  }

  async peek(length: number): Promise<Uint8Array> {
    await this.fill(length);
    return concat(this.chunks, Math.min(length, this.held));
  }

  /** Fewer where the stream ends. */
  async take(length: number): Promise<Uint8Array> {
    await this.fill(length);
    const out = concat(this.chunks, Math.min(length, this.held));
    this.drop(out.length);
    return out;
  }

  /** False where the stream ends first. */
  async skip(length: number): Promise<boolean> {
    let left = length;
    while (left > 0) {
      if (!this.held && !(await this.pull())) return false;
      const n = Math.min(left, this.held);
      this.drop(n);
      left -= n;
    }
    return true;
  }

  async close(): Promise<void> {
    this.chunks = [];
    this.held = 0;
    await this.source.return?.();
  }

  private async fill(length: number): Promise<void> {
    while (this.held < length && (await this.pull()));
  }

  private async pull(): Promise<boolean> {
    if (this.ended) return false;
    const { done, value } = await this.source.next();
    if (done) {
      this.ended = true;
      return false;
    }
    this.chunks.push(value);
    this.held += value.length;
    return true;
  }

  private drop(length: number): void {
    let left = length;
    this.held -= length;
    while (left > 0) {
      const first = this.chunks[0];
      if (first.length > left) {
        this.chunks[0] = first.subarray(left);
        return;
      }
      this.chunks.shift();
      left -= first.length;
    }
  }
}

export function concat(parts: Uint8Array[], length: number): Uint8Array {
  const out = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    out.set(part.subarray(0, length - at), at);
    at += part.length;
    if (at >= length) break;
  }
  return out;
}

/** Exactly `length` bytes from `start`, or fewer at the end of the file. */
export async function readAll(
  reader: ByteReader,
  start: number,
  length: number
): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  let got = 0;
  while (got < length) {
    const part = await reader.read(start + got, length - got);
    if (!part.length) break;
    parts.push(part);
    got += part.length;
  }
  return parts.length === 1 ? parts[0] : concat(parts, got);
}

/** `lasting` when asking again won't help. */
export class ReadError extends Error {
  constructor(
    message: string,
    readonly lasting: boolean,
    readonly retryAfterMs = 0
  ) {
    super(message);
  }
}
