import { createHash } from 'node:crypto';

/**
 * Minimal PAR2 packet reader. Recovers real filenames for obfuscated usenet
 * postings by reading PAR2 "FileDescription" packets, which carry each file's
 * MD5-of-first-16k and name. We do NOT implement Reed-Solomon repair; this is
 * purely a filename index.
 *
 * PAR2 spec: https://github.com/Parchive/par2cmdline/blob/master/PAR2-specification
 * Packet layout (little-endian):
 *   magic(8)  = "PAR2\0PKT"
 *   length(8) = total packet length incl. this 64-byte header
 *   pktHash(16)
 *   setId(16)
 *   type(16)
 *   body(length-64)
 * FileDescription body ("PAR 2.0\0FileDesc"):
 *   fileId(16) md5(16) md5_16k(16) length(8) name(rest, \0-padded)
 */

const MAGIC = Buffer.from('PAR2\x00PKT', 'latin1');
const TYPE_FILE_DESC = Buffer.from('PAR 2.0\x00FileDesc', 'latin1');

export interface Par2FileDesc {
  /** 16-byte File ID, hex. */
  fileId: string;
  /** MD5 of the entire file, hex. */
  md5: string;
  /** MD5 of the first 16 KiB (or whole file if smaller), hex. */
  md5_16k: string;
  /** Declared file length in bytes. */
  length: number;
  /** Recovered filename. */
  filename: string;
}

export interface Par2Index {
  files: Par2FileDesc[];
  /** md5_16k (hex) → filename, for fast obfuscated-file matching. */
  byMd5_16k: Map<string, Par2FileDesc>;
  /**
   * Lowercased basename → descriptor, for matching NAMED releases without any
   * content fetch (descriptor lengths are exact file sizes, the foundation of
   * the probe-skipping archive chase).
   */
  byName: Map<string, Par2FileDesc>;
}

/** Lowercased basename (PAR2 names may carry path separators). */
export function par2NameKey(name: string): string {
  const norm = name.replace(/\\/g, '/');
  const idx = norm.lastIndexOf('/');
  return (idx === -1 ? norm : norm.slice(idx + 1)).toLowerCase();
}

/** Bytes used by PAR2 for the first-block hash. */
export const PAR2_HASH_BLOCK = 16 * 1024;

/**
 * Decode the FileDescription packets from a PAR2 file body. Tolerant of
 * truncation and duplicate packets (PAR2 repeats critical packets across
 * volumes); de-duplicates by File ID.
 */
export function decodePar2(buf: Buffer): Par2Index {
  const byId = new Map<string, Par2FileDesc>();
  let offset = 0;

  while (offset + 64 <= buf.length) {
    // Re-sync to the next magic if we are not already on one.
    if (!buf.subarray(offset, offset + 8).equals(MAGIC)) {
      const next = buf.indexOf(MAGIC, offset + 1);
      if (next === -1) break;
      offset = next;
      continue;
    }

    const length = Number(buf.readBigUInt64LE(offset + 8));
    if (length < 64 || offset + length > buf.length) break;

    const type = buf.subarray(offset + 48, offset + 64);
    if (type.equals(TYPE_FILE_DESC)) {
      const body = buf.subarray(offset + 64, offset + length);
      const desc = parseFileDesc(body);
      if (desc && !byId.has(desc.fileId)) byId.set(desc.fileId, desc);
    }

    offset += length;
  }

  const files = [...byId.values()];
  const byMd5_16k = new Map<string, Par2FileDesc>();
  const byName = new Map<string, Par2FileDesc>();
  for (const f of files) {
    byMd5_16k.set(f.md5_16k, f);
    byName.set(par2NameKey(f.filename), f);
  }
  return { files, byMd5_16k, byName };
}

function parseFileDesc(body: Buffer): Par2FileDesc | undefined {
  if (body.length < 56) return undefined;
  const fileId = body.subarray(0, 16).toString('hex');
  const md5 = body.subarray(16, 32).toString('hex');
  const md5_16k = body.subarray(32, 48).toString('hex');
  const length = Number(body.readBigUInt64LE(48));
  // Name runs to the end of the packet, \0-padded to a 4-byte boundary.
  let nameBuf = body.subarray(56);
  const nul = nameBuf.indexOf(0);
  if (nul !== -1) nameBuf = nameBuf.subarray(0, nul);
  const filename = nameBuf.toString('utf8').trim();
  if (!filename) return undefined;
  return { fileId, md5, md5_16k, length, filename };
}

/**
 * Compute the PAR2 first-block MD5 over a buffer holding (at least) the start
 * of a file. Hashes the first {@link PAR2_HASH_BLOCK} bytes; if fewer bytes are
 * available it hashes what is present (matching PAR2 for files < 16 KiB).
 */
export function par2Md5_16k(data: Buffer): string {
  const slice = data.subarray(0, PAR2_HASH_BLOCK);
  return createHash('md5').update(slice).digest('hex');
}
