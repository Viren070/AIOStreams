/**
 * Streaming parsers for large local data files.
 *
 * - `streamJsonArray` walks a top-level JSON array element-by-element using
 *   `stream-json` v3, so we never buffer the full payload (Manami / AnimeApi
 *   are tens to hundreds of MB).
 * - `streamJsonLines` parses a JSONL/NDJSON file one record per line.
 */
import { createReadStream } from 'fs';
import readline from 'readline';
import { streamArray } from 'stream-json/streamers/stream-array.js';
/**
 * Iterate over each element of a top-level JSON array stored at `filePath`.
 * The file must start with `[` (after optional whitespace) and contain a flat
 * sequence of JSON values.
 */
export async function* streamJsonArray<T = unknown>(
  filePath: string
): AsyncGenerator<T, void, void> {
  const fileStream = createReadStream(filePath, { encoding: 'utf8' });
  const pipeline = fileStream.pipe(streamArray.withParserAsStream());
  try {
    for await (const chunk of pipeline as AsyncIterable<{
      key: number;
      value: T;
    }>) {
      yield chunk.value;
    }
  } finally {
    fileStream.destroy();
  }
}

/**
 * Iterate over each non-empty JSON line of a JSONL/NDJSON file.
 */
export async function* streamJsonLines<T = unknown>(
  filePath: string
): AsyncGenerator<T, void, void> {
  const fileStream = createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });
  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      yield JSON.parse(trimmed) as T;
    }
  } finally {
    rl.close();
    fileStream.destroy();
  }
}
