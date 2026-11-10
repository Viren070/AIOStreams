import { readAll, ReadError, type ByteReader } from '@/lib/byte-reader';
import { fontNames } from '@/lib/subtitles/font-names';
import {
  attachedFiles,
  isFont,
  type Attachment,
  type MkvFile,
} from '@/lib/subtitles/matroska/file';

const TRIES = 5;

const inMemory = (bytes: Uint8Array): ByteReader => ({
  read: async (start, length) => bytes.subarray(start, start + length),
});

/** One read walks the attachments front to back, keeping the fonts asked for so far and noting the rest by name, so a family asked for later costs one read. */
export class AttachedFonts {
  private readonly wanted = new Set<string>();
  private readonly passed: { font: Attachment; names: string[] }[] = [];
  private reading = false;

  constructor(
    private readonly file: MkvFile,
    private readonly onFont: (font: Uint8Array) => void
  ) {}

  want(families: Iterable<string>): void {
    const fresh = [...families].filter((family) => !this.wanted.has(family));
    if (!fresh.length) return;
    for (const family of fresh) this.wanted.add(family);
    for (const entry of [...this.passed]) {
      if (!entry.names.some((name) => this.wanted.has(name))) continue;
      this.passed.splice(this.passed.indexOf(entry), 1);
      void this.readFont(entry);
    }
    if (this.reading) return;
    this.reading = true;
    void this.readThrough();
  }

  private async readFont(entry: { font: Attachment; names: string[] }) {
    const { font } = entry;
    const bytes = await readAll(this.file.reader, font.at, font.size).catch(
      () => null
    );
    if (bytes?.length === font.size) return this.onFont(bytes);
    // Asked for again by the next line that names it.
    for (const name of entry.names) this.wanted.delete(name);
    this.passed.push(entry);
  }

  private async readThrough(): Promise<void> {
    const at = this.file.attachmentsAt;
    if (at === undefined) return;
    let from: number | undefined;
    for (let tries = 0; tries < TRIES; tries++) {
      try {
        for await (const file of attachedFiles(this.file.reader, at, from)) {
          from = file.next;
          tries = 0;
          if (!isFont(file)) continue;
          const { name, mime, size, bytes } = file;
          const font = { name, mime, at: file.at, size };
          const names = await fontNames(inMemory(bytes), {
            at: 0,
            size: bytes.length,
          });
          if (names.some((name) => this.wanted.has(name))) this.onFont(bytes);
          else this.passed.push({ font, names });
        }
        return;
      } catch (error) {
        if (error instanceof ReadError && error.lasting) return;
      }
    }
  }
}
