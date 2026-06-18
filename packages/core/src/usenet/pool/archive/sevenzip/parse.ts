import { RandomAccess } from '../random-access.js';
import { ArchiveEntry, DataFragment, AesStoredRegion } from '../types.js';
import { decodeLzma1 } from './lzma.js';
import { CODER_AES, parseAesParams, decryptAesAll } from '../crypto/aes7z.js';
import { createLogger } from '../../../../logging/logger.js';

const logger = createLogger('usenet/7z');

/**
 * 7z container parser for locating **stored (copy-coder)** inner files. The 7z
 * header is itself frequently LZMA-compressed (`kEncodedHeader`), so it is
 * decoded via {@link decodeLzma1} before parsing. Files in copy-coder folders
 * get an absolute byte range in the concatenated volume stream so they stream
 * via the same interpolation-seek path as RAR; files in compressed/encrypted
 * folders are surfaced as non-streamable.
 */

// Property IDs.
const ID_END = 0x00;
const ID_HEADER = 0x01;
const ID_MAIN_STREAMS_INFO = 0x04;
const ID_FILES_INFO = 0x05;
const ID_PACK_INFO = 0x06;
const ID_UNPACK_INFO = 0x07;
const ID_SUBSTREAMS_INFO = 0x08;
const ID_SIZE = 0x09;
const ID_CRC = 0x0a;
const ID_FOLDER = 0x0b;
const ID_CODERS_UNPACK_SIZE = 0x0c;
const ID_NUM_UNPACK_STREAM = 0x0d;
const ID_EMPTY_STREAM = 0x0e;
const ID_EMPTY_FILE = 0x0f;
const ID_NAME = 0x11;
const ID_CTIME = 0x12;
const ID_ATIME = 0x13;
const ID_MTIME = 0x14;
const ID_WIN_ATTRS = 0x15;
const ID_ENCODED_HEADER = 0x17;
const ID_DUMMY = 0x19;

const SIGNATURE = Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]);
const SIG_HEADER_SIZE = 32;
const MAX_SIG_SCAN = 1 << 20;

// Coder ids.
const CODER_COPY = Buffer.from([0x00]);
const CODER_LZMA = Buffer.from([0x03, 0x01, 0x01]);

class ByteReader {
  pos = 0;
  constructor(private buf: Buffer) {}

  get remaining(): number {
    return this.buf.length - this.pos;
  }
  readByte(): number {
    if (this.pos >= this.buf.length)
      throw new Error('7z: unexpected end of header');
    return this.buf[this.pos++];
  }
  readBytes(n: number): Buffer {
    if (this.pos + n > this.buf.length)
      throw new Error('7z: unexpected end of header');
    const b = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return b;
  }
  readUint32(): number {
    const v = this.buf.readUInt32LE(this.pos);
    this.pos += 4;
    return v;
  }
  skip(n: number): void {
    this.pos += n;
  }
  /** 7z variable-length number. */
  readNumber(): number {
    const first = this.readByte();
    let mask = 0x80;
    let value = 0;
    for (let i = 0; i < 8; i++) {
      if ((first & mask) === 0) {
        value += (first & (mask - 1)) * Math.pow(2, 8 * i);
        return value;
      }
      value += this.readByte() * Math.pow(2, 8 * i);
      mask >>= 1;
    }
    return value;
  }
}

interface Coder {
  id: Buffer;
  inStreams: number;
  outStreams: number;
  properties?: Buffer;
}
interface Folder {
  coders: Coder[];
  inCount: number;
  outCount: number;
  bindPairs: Array<{ in: number; out: number }>;
  packedStreams: number;
  packed: number[];
  /** Unpack size per coder output. */
  sizes: number[];
}
interface PackInfo {
  position: number;
  streams: number;
  sizes: number[];
}
interface StreamsInfo {
  packInfo?: PackInfo;
  folders: Folder[];
  /** Per-folder substream count (idNumUnpackStream); default 1 each. */
  numUnpackStreams: number[];
  /** Per-substream sizes (flattened). */
  subSizes: number[];
}

function findOutBindPair(f: Folder, i: number): boolean {
  return f.bindPairs.some((bp) => bp.out === i);
}
function findInBindPair(f: Folder, i: number): boolean {
  return f.bindPairs.some((bp) => bp.in === i);
}
function folderUnpackSize(f: Folder): number {
  for (let i = f.sizes.length - 1; i >= 0; i--) {
    if (!findOutBindPair(f, i)) return f.sizes[i];
  }
  return f.sizes[f.sizes.length - 1] ?? 0;
}

function readBitVector(r: ByteReader, count: number): boolean[] {
  const bits: boolean[] = [];
  let b = 0;
  let mask = 0;
  for (let i = 0; i < count; i++) {
    if (mask === 0) {
      b = r.readByte();
      mask = 0x80;
    }
    bits.push((b & mask) !== 0);
    mask >>= 1;
  }
  return bits;
}
function readOptionalBitVector(r: ByteReader, count: number): boolean[] {
  const allDefined = r.readByte();
  if (allDefined !== 0) return new Array(count).fill(true);
  return readBitVector(r, count);
}

function skipDigests(r: ByteReader, count: number): void {
  const defined = readOptionalBitVector(r, count);
  for (const d of defined) if (d) r.readUint32();
}

function readPackInfo(r: ByteReader): PackInfo {
  const position = r.readNumber();
  const streams = r.readNumber();
  const info: PackInfo = { position, streams, sizes: [] };
  let id = r.readByte();
  if (id === ID_SIZE) {
    for (let i = 0; i < streams; i++) info.sizes.push(r.readNumber());
    id = r.readByte();
  }
  if (id === ID_CRC) {
    skipDigests(r, streams);
    id = r.readByte();
  }
  if (id !== ID_END) throw new Error('7z: bad packInfo');
  return info;
}

function readCoder(r: ByteReader): Coder {
  const v = r.readByte();
  const idSize = v & 0x0f;
  const id = Buffer.from(r.readBytes(idSize));
  let inStreams = 1;
  let outStreams = 1;
  if (v & 0x10) {
    inStreams = r.readNumber();
    outStreams = r.readNumber();
  }
  let properties: Buffer | undefined;
  if (v & 0x20) {
    const size = r.readNumber();
    properties = Buffer.from(r.readBytes(size));
  }
  // v & 0x80 => more alternative methods follow (not supported here).
  return { id, inStreams, outStreams, properties };
}

function readFolder(r: ByteReader): Folder {
  const numCoders = r.readNumber();
  const coders: Coder[] = [];
  let inCount = 0;
  let outCount = 0;
  for (let i = 0; i < numCoders; i++) {
    const c = readCoder(r);
    coders.push(c);
    inCount += c.inStreams;
    outCount += c.outStreams;
  }
  const numBindPairs = outCount - 1;
  const bindPairs: Array<{ in: number; out: number }> = [];
  for (let i = 0; i < numBindPairs; i++) {
    bindPairs.push({ in: r.readNumber(), out: r.readNumber() });
  }
  const packedStreams = inCount - numBindPairs;
  const f: Folder = {
    coders,
    inCount,
    outCount,
    bindPairs,
    packedStreams,
    packed: [],
    sizes: [],
  };
  if (packedStreams === 1) {
    for (let i = 0; i < inCount; i++) {
      if (!findInBindPair(f, i)) {
        f.packed.push(i);
        break;
      }
    }
  } else {
    for (let i = 0; i < packedStreams; i++) f.packed.push(r.readNumber());
  }
  return f;
}

function readUnpackInfo(r: ByteReader): Folder[] {
  if (r.readByte() !== ID_FOLDER) throw new Error('7z: expected folder id');
  const numFolders = r.readNumber();
  const external = r.readByte();
  if (external !== 0) throw new Error('7z: external folder info unsupported');
  const folders: Folder[] = [];
  for (let i = 0; i < numFolders; i++) folders.push(readFolder(r));

  if (r.readByte() !== ID_CODERS_UNPACK_SIZE) {
    throw new Error('7z: expected coders unpack size');
  }
  for (const f of folders) {
    const total = f.coders.reduce((a, c) => a + c.outStreams, 0);
    for (let i = 0; i < total; i++) f.sizes.push(r.readNumber());
  }
  let id = r.readByte();
  if (id === ID_CRC) {
    skipDigests(r, numFolders);
    id = r.readByte();
  }
  if (id !== ID_END) throw new Error('7z: bad unpackInfo');
  return folders;
}

function readSubStreamsInfo(
  r: ByteReader,
  folders: Folder[]
): {
  numUnpackStreams: number[];
  subSizes: number[];
} {
  let id = r.readByte();
  const numUnpackStreams = new Array(folders.length).fill(1);
  if (id === ID_NUM_UNPACK_STREAM) {
    for (let i = 0; i < folders.length; i++)
      numUnpackStreams[i] = r.readNumber();
    id = r.readByte();
  }

  const subSizes: number[] = [];
  // Sizes: for each folder, (n-1) explicit sizes then the remainder.
  for (let i = 0; i < folders.length; i++) {
    const n = numUnpackStreams[i];
    if (n === 0) continue;
    let sum = 0;
    if (id === ID_SIZE) {
      for (let j = 1; j < n; j++) {
        const s = r.readNumber();
        subSizes.push(s);
        sum += s;
      }
    } else {
      // No explicit sizes: each folder has exactly one stream of folder size.
      for (let j = 1; j < n; j++) subSizes.push(0);
    }
    subSizes.push(folderUnpackSize(folders[i]) - sum);
  }
  if (id === ID_SIZE) id = r.readByte();

  let totalStreams = 0;
  for (const n of numUnpackStreams) totalStreams += n;
  if (id === ID_CRC) {
    // Digests are only present for streams without a folder-level CRC; we don't
    // verify, so skip them generically.
    skipDigests(r, totalStreams);
    id = r.readByte();
  }
  if (id !== ID_END) throw new Error('7z: bad subStreamsInfo');
  return { numUnpackStreams, subSizes };
}

function readStreamsInfo(r: ByteReader): StreamsInfo {
  const si: StreamsInfo = { folders: [], numUnpackStreams: [], subSizes: [] };
  let id = r.readByte();
  if (id === ID_PACK_INFO) {
    si.packInfo = readPackInfo(r);
    id = r.readByte();
  }
  if (id === ID_UNPACK_INFO) {
    si.folders = readUnpackInfo(r);
    id = r.readByte();
  }
  if (id === ID_SUBSTREAMS_INFO) {
    const sub = readSubStreamsInfo(r, si.folders);
    si.numUnpackStreams = sub.numUnpackStreams;
    si.subSizes = sub.subSizes;
    id = r.readByte();
  } else {
    si.numUnpackStreams = si.folders.map(() => 1);
    si.subSizes = si.folders.map((f) => folderUnpackSize(f));
  }
  if (id !== ID_END) throw new Error('7z: bad streamsInfo');
  return si;
}

interface RawFile {
  name: string;
  isEmptyStream: boolean;
  isEmptyFile: boolean;
  isDir: boolean;
  attributes?: number;
}

function readFilesInfo(r: ByteReader): RawFile[] {
  const numFiles = r.readNumber();
  const files: RawFile[] = Array.from({ length: numFiles }, () => ({
    name: '',
    isEmptyStream: false,
    isEmptyFile: false,
    isDir: false,
  }));
  let emptyStreamCount = 0;
  let emptyStreams: boolean[] = new Array(numFiles).fill(false);

  for (;;) {
    const property = r.readByte();
    if (property === ID_END) break;
    const size = r.readNumber();
    const end = r.pos + size;
    switch (property) {
      case ID_EMPTY_STREAM: {
        emptyStreams = readBitVector(r, numFiles);
        emptyStreamCount = 0;
        for (let i = 0; i < numFiles; i++) {
          files[i].isEmptyStream = emptyStreams[i];
          if (emptyStreams[i]) emptyStreamCount++;
        }
        break;
      }
      case ID_EMPTY_FILE: {
        const emptyFiles = readBitVector(r, emptyStreamCount);
        let j = 0;
        for (let i = 0; i < numFiles; i++) {
          if (files[i].isEmptyStream) {
            files[i].isEmptyFile = emptyFiles[j++];
          }
        }
        break;
      }
      case ID_NAME: {
        const external = r.readByte();
        if (external !== 0) throw new Error('7z: external names unsupported');
        const nameBytes = r.readBytes(end - r.pos);
        const names = nameBytes.toString('utf16le').split('\u0000');
        for (let i = 0; i < numFiles && i < names.length; i++) {
          files[i].name = names[i].replace(/\\/g, '/');
        }
        break;
      }
      case ID_WIN_ATTRS: {
        const defined = readOptionalBitVector(r, numFiles);
        const external = r.readByte();
        if (external === 0) {
          for (let i = 0; i < numFiles; i++) {
            if (defined[i]) files[i].attributes = r.readUint32();
          }
        }
        break;
      }
      case ID_CTIME:
      case ID_ATIME:
      case ID_MTIME:
      case ID_DUMMY:
      default:
        // Skip any property we don't need (times, dummy, anti, etc.).
        break;
    }
    r.pos = end; // robust: always continue at the declared property end
  }

  // A file with an empty stream and not an empty file is a directory.
  for (const f of files) {
    if (f.isEmptyStream && !f.isEmptyFile) f.isDir = true;
  }
  return files;
}

interface Parsed7z {
  streamsInfo: StreamsInfo;
  files: RawFile[];
}

function readHeader(r: ByteReader): Parsed7z {
  let id = r.readByte();
  let streamsInfo: StreamsInfo = {
    folders: [],
    numUnpackStreams: [],
    subSizes: [],
  };
  let files: RawFile[] = [];
  if (id === ID_MAIN_STREAMS_INFO) {
    streamsInfo = readStreamsInfo(r);
    id = r.readByte();
  }
  if (id === ID_FILES_INFO) {
    files = readFilesInfo(r);
    id = r.readByte();
  }
  return { streamsInfo, files };
}

/** Absolute (within the streams region) start of folder `idx`'s packed data. */
function folderPackOffset(si: StreamsInfo, idx: number): number {
  let offset = si.packInfo!.position;
  let k = 0;
  for (let i = 0; i < idx; i++) {
    for (let j = 0; j < si.folders[i].packedStreams; j++) {
      offset += si.packInfo!.sizes[k + j];
    }
    k += si.folders[i].packedStreams;
  }
  return offset;
}

function isCopyFolder(f: Folder): boolean {
  return f.coders.length === 1 && f.coders[0].id.equals(CODER_COPY);
}

/**
 * Parse a 7z archive (possibly multi-volume via the concatenated
 * {@link RandomAccess}) and return its inner files as {@link ArchiveEntry}s.
 */
export async function parse7z(
  ra: RandomAccess,
  password = ''
): Promise<ArchiveEntry[]> {
  const total = ra.size();
  const head = await ra.readAt(0, Math.min(total, 64 * 1024));
  let sigOff = head.indexOf(SIGNATURE);
  if (sigOff < 0) {
    // Scan further for an SFX prefix (rare for usenet).
    const scan = await ra.readAt(0, Math.min(total, MAX_SIG_SCAN));
    sigOff = scan.indexOf(SIGNATURE);
    if (sigOff < 0) throw new Error('7z: signature not found');
  }

  const startHeader = await ra.readAt(sigOff, SIG_HEADER_SIZE);
  // signatureHeader: sig(6) major(1) minor(1) startCRC(4) then startHeader:
  // nextHeaderOffset(8) nextHeaderSize(8) nextHeaderCRC(4).
  const nextHeaderOffset = Number(startHeader.readBigUInt64LE(12));
  const nextHeaderSize = Number(startHeader.readBigUInt64LE(20));
  const baseStart = sigOff + SIG_HEADER_SIZE;
  const headerPos = baseStart + nextHeaderOffset;

  let headerBuf = await ra.readAt(headerPos, nextHeaderSize);
  let r = new ByteReader(headerBuf);
  let id = r.readByte();

  if (id === ID_ENCODED_HEADER) {
    // Header is itself an encoded (compressed and/or encrypted) stream; decode
    // it via the coder graph, then re-parse.
    const si = readStreamsInfo(r);
    describeFolders('encoded-header', si.folders);
    if (si.folders.length !== 1)
      throw new Error('7z: expected one header folder');
    const decoded = await decodeFolder(ra, si, 0, baseStart, password);
    headerBuf = decoded;
    r = new ByteReader(headerBuf);
    id = r.readByte();
  }
  if (id !== ID_HEADER) throw new Error('7z: unexpected header id ' + id);

  const parsed = readHeader(r);
  describeFolders('content', parsed.streamsInfo.folders);
  const entries = buildEntries(parsed, baseStart);
  logger.debug(
    {
      files: entries.length,
      streamable: entries.filter((e) => e.stored).length,
      sample: entries.slice(0, 5).map((e) => ({
        name: e.name,
        size: e.size,
        stored: e.stored,
      })),
    },
    '7z parse complete'
  );
  return entries;
}

/** Index of the first packed stream belonging to folder `idx`. */
function folderPackStreamStart(si: StreamsInfo, idx: number): number {
  let start = 0;
  for (let i = 0; i < idx; i++) start += si.folders[i].packedStreams;
  return start;
}

/** Whether a coder id is the 7z AES-256 decryptor. */
function isAesCoder(c: Coder): boolean {
  return c.id.equals(CODER_AES);
}

/** Run one coder over its (already-gathered) input buffers. */
function runCoder(
  coder: Coder,
  inputs: Buffer[],
  outSize: number,
  password: string
): Buffer {
  if (coder.id.equals(CODER_COPY)) return inputs[0].subarray(0, outSize);
  if (coder.id.equals(CODER_LZMA)) {
    if (!coder.properties) throw new Error('7z: LZMA missing properties');
    return decodeLzma1(coder.properties, inputs[0], outSize);
  }
  if (isAesCoder(coder)) {
    if (!password) {
      throw new Error('7z: encrypted (password required)');
    }
    if (!coder.properties) throw new Error('7z: AES missing properties');
    return decryptAesAll(
      parseAesParams(coder.properties),
      password,
      inputs[0],
      outSize
    );
  }
  throw new Error('7z: unsupported coder ' + coder.id.toString('hex'));
}

/**
 * Decode a folder into its (single) unbound output buffer by walking the coder
 * graph: packed streams feed unbound coder inputs, bind pairs connect a coder
 * output to the next coder input, and each coder is run in order. Supports copy / LZMA / AES
 * chains, which covers LZMA→AES encoded headers. Whole-buffer decode, intended
 * for the (small) header; large content folders stream via their own path.
 */
async function decodeFolder(
  ra: RandomAccess,
  si: StreamsInfo,
  folderIdx: number,
  baseStart: number,
  password: string
): Promise<Buffer> {
  const f = si.folders[folderIdx];
  const inBufs: (Buffer | null)[] = new Array(f.inCount).fill(null);
  const outBufs: (Buffer | null)[] = new Array(f.outCount).fill(null);

  // Feed packed (encrypted/compressed) streams into their target inputs.
  const packBase = baseStart + folderPackOffset(si, folderIdx);
  const packStreamStart = folderPackStreamStart(si, folderIdx);
  let packOff = 0;
  for (let i = 0; i < f.packed.length; i++) {
    const size = si.packInfo!.sizes[packStreamStart + i];
    inBufs[f.packed[i]] = await ra.readAt(packBase + packOff, size);
    packOff += size;
  }

  let inBase = 0;
  let outBase = 0;
  for (const c of f.coders) {
    if (c.outStreams !== 1) {
      throw new Error('7z: coder with multiple outputs unsupported');
    }
    const inputs: Buffer[] = [];
    for (let j = inBase; j < inBase + c.inStreams; j++) {
      if (!inBufs[j]) {
        const bp = f.bindPairs.find((b) => b.in === j);
        if (!bp || !outBufs[bp.out]) throw new Error('7z: unbound coder input');
        inBufs[j] = outBufs[bp.out];
      }
      inputs.push(inBufs[j]!);
    }
    outBufs[outBase] = runCoder(c, inputs, f.sizes[outBase], password);
    inBase += c.inStreams;
    outBase += c.outStreams;
  }

  // The folder output is the single out-stream not consumed by a bind pair.
  for (let i = 0; i < f.outCount; i++) {
    if (!findOutBindPair(f, i)) return outBufs[i]!;
  }
  return outBufs[f.outCount - 1]!;
}

/** Log a folder's coder chain for diagnostics (ids, props, bind pairs). */
function describeFolders(label: string, folders: Folder[]): void {
  logger.debug(
    {
      where: label,
      folders: folders.map((f) => ({
        coders: f.coders.map((c) => ({
          id: c.id.toString('hex'),
          inStreams: c.inStreams,
          outStreams: c.outStreams,
          propsLen: c.properties?.length ?? 0,
          aes: isAesCoder(c),
        })),
        bindPairs: f.bindPairs,
        packedStreams: f.packedStreams,
      })),
    },
    '7z folder coder chains'
  );
}

/**
 * Classify a folder for streaming. A `store+encrypt` folder (AES then Copy, no
 * compression coder) is recoverable by AES-CBC decryption; still streamable.
 * Anything with a compression coder (LZMA/PPMd/...) is not.
 */
function classifyFolder(f: Folder): {
  copy: boolean;
  aesStore: boolean;
  aesCoder?: Coder;
} {
  if (isCopyFolder(f)) return { copy: true, aesStore: false };
  const aesCoder = f.coders.find((c) => c.id.equals(CODER_AES));
  if (!aesCoder) return { copy: false, aesStore: false };
  // Every non-AES coder must be a copy/identity for the output to be stored.
  const compressed = f.coders.some(
    (c) => !c.id.equals(CODER_AES) && !c.id.equals(CODER_COPY)
  );
  return { copy: false, aesStore: !compressed, aesCoder };
}

function buildEntries(parsed: Parsed7z, baseStart: number): ArchiveEntry[] {
  const { streamsInfo: si, files } = parsed;
  const entries: ArchiveEntry[] = [];

  // Walk files, mapping each non-empty stream to a folder + offset: substreams are consumed folder by folder in order.
  let folderIdx = 0;
  let streamInFolder = 0;
  let offsetInFolder = 0;
  let subIdx = 0;

  for (const file of files) {
    if (file.isEmptyStream) {
      // Directory or empty file: no data.
      entries.push(makeEntry(file.name, 0, file.isDir, true, false, []));
      continue;
    }

    // Advance to a folder that still has substreams.
    while (
      folderIdx < si.folders.length &&
      streamInFolder >= (si.numUnpackStreams[folderIdx] ?? 1)
    ) {
      folderIdx++;
      streamInFolder = 0;
      offsetInFolder = 0;
    }
    if (folderIdx >= si.folders.length) break;

    const folder = si.folders[folderIdx];
    const size = si.subSizes[subIdx] ?? 0;
    const { copy, aesStore, aesCoder } = classifyFolder(folder);
    const encrypted = !!aesCoder;

    let fragments: DataFragment[] = [];
    let stored = false;
    let aes: AesStoredRegion | undefined;
    if (copy) {
      const abs = baseStart + folderPackOffset(si, folderIdx) + offsetInFolder;
      fragments = [{ offset: abs, length: size }];
      stored = true;
    } else if (aesStore && aesCoder?.properties) {
      // store+encrypt: stream by decrypting the folder's packed region.
      let params;
      try {
        params = parseAesParams(aesCoder.properties);
      } catch (err) {
        throw new Error(
          `7z: invalid AES coder properties (folder ${folderIdx})`,
          {
            cause: err,
          }
        );
      }
      const packStart = folderPackStreamStart(si, folderIdx);
      let packSize = 0;
      for (let i = 0; i < folder.packedStreams; i++) {
        packSize += si.packInfo!.sizes[packStart + i];
      }
      aes = {
        packOffset: baseStart + folderPackOffset(si, folderIdx),
        packSize,
        salt: params.salt,
        iv: params.iv,
        cycles: params.cycles,
        plainOffset: offsetInFolder,
      };
      stored = true; // streamable with the password (encrypted flag stays true)
    }
    entries.push(
      makeEntry(file.name, size, false, stored, encrypted, fragments, aes)
    );

    offsetInFolder += size;
    streamInFolder++;
    subIdx++;
  }
  return entries;
}

function makeEntry(
  name: string,
  size: number,
  isDir: boolean,
  stored: boolean,
  encrypted: boolean,
  fragments: DataFragment[],
  aes?: AesStoredRegion
): ArchiveEntry {
  return {
    name,
    size,
    packedSize: fragments.reduce((a, f) => a + f.length, 0),
    isDir,
    stored,
    solid: false,
    encrypted,
    fragments,
    aes,
  };
}
