import { RandomAccess } from '../random-access.js';
import {
  BlockResult,
  ParsedFile,
  VolumeCtx,
  MAX_HEADER,
  uvarint,
} from './types.js';
import { readWindow } from './scan.js';
import {
  Rar5CryptInfo,
  RarEncryptedError,
  RarBadPasswordError,
  deriveRar5Keys,
  passwordMatches,
  decryptCbc,
} from '../crypto/rar-kdf.js';

// ---- RAR5 constants -----------------------------------------
const B5_MAIN = 1;
const B5_FILE = 2;
const B5_CRYPT = 4;
const B5_END = 5;
const ARC5_HAS_VOLUME_NUMBER = 0x0002;
const B5_HAS_EXTRA = 0x01;
const B5_HAS_DATA = 0x02;
const B5_DATA_NOT_FIRST = 0x08;
const B5_DATA_NOT_LAST = 0x10;
const F5_IS_DIR = 0x0001;
const F5_HAS_MTIME = 0x0002;
const F5_HAS_CRC32 = 0x0004;
const F5_COMP_SOLID = 0x00000040;
const F5_EXTRA_CRYPT = 1;
const ENC5_CHECK_PRESENT = 0x0001;

/**
 * Parse a RAR5 encryption record body. Two shapes share this:
 *  - the **crypt block header** (htype 4): `version, flags, kdfCount, salt(16),
 *    [check(12)]` (no IV; block IVs are the 16 bytes prefixing each encrypted
 *    block).
 *  - a **file** extra type-1 record: `version, flags, kdfCount, salt(16),
 *    iv(16), [check(12)]`: the iv seeds the file's data CBC stream.
 * `hasIv` selects the shape. Returns undefined when malformed/unsupported.
 */
function parseCryptRecord(
  buf: Buffer,
  start: number,
  end: number,
  hasIv: boolean
): Rar5CryptInfo | undefined {
  let p = start;
  const [ver, vn] = uvarint(buf, p);
  if (ver !== 0) return undefined;
  p += vn;
  const [flags, fn] = uvarint(buf, p);
  p += fn;
  if (p + 1 + 16 + (hasIv ? 16 : 0) > end) return undefined;
  const kdfLog2 = buf[p];
  p += 1;
  const salt = Buffer.from(buf.subarray(p, p + 16));
  p += 16;
  let iv = Buffer.alloc(0);
  if (hasIv) {
    iv = Buffer.from(buf.subarray(p, p + 16));
    p += 16;
  }
  let check: Buffer | undefined;
  if (flags & ENC5_CHECK_PRESENT) {
    if (p + 12 > end) return undefined;
    check = Buffer.from(buf.subarray(p, p + 12));
  }
  return { kdfLog2, salt, iv, check };
}

export function parseRar5File(
  buf: Buffer,
  start: number,
  bodyEnd: number,
  headerEnd: number,
  ctx: { flags: number; dataSize: number }
): ParsedFile | undefined {
  let p = start;
  const [fileFlags, n1] = uvarint(buf, p);
  p += n1;
  const isDir = (fileFlags & F5_IS_DIR) > 0;
  const [unpSize, n2] = uvarint(buf, p);
  p += n2;
  const [, n3] = uvarint(buf, p); // attributes
  p += n3;
  if (fileFlags & F5_HAS_MTIME) p += 4;
  if (fileFlags & F5_HAS_CRC32) p += 4;
  const [compFlags, n4] = uvarint(buf, p);
  p += n4;
  const solid = (compFlags & F5_COMP_SOLID) > 0;
  const method = (compFlags >> 7) & 7; // 0 == stored
  const [, n5] = uvarint(buf, p); // host OS
  p += n5;
  const [nlen, n6] = uvarint(buf, p);
  p += n6;
  if (p + nlen > bodyEnd) return undefined;
  const name = buf.subarray(p, p + nlen).toString('utf8');

  // Encryption record (extra field type 1) lives in the extra area; parse it
  // in full so the entry carries the salt/iv/kdf needed to decrypt its data.
  let encrypted = false;
  let crypt: Rar5CryptInfo | undefined;
  let ep = bodyEnd;
  while (ep < headerEnd) {
    const [recSize, rn] = uvarint(buf, ep);
    if (recSize <= 0) break;
    const recStart = ep + rn;
    const recEnd = recStart + recSize;
    const [recType, tn] = uvarint(buf, recStart);
    if (recType === F5_EXTRA_CRYPT) {
      encrypted = true;
      // File records carry an iv after the salt.
      crypt = parseCryptRecord(
        buf,
        recStart + tn,
        Math.min(recEnd, headerEnd),
        true
      );
    }
    ep = recEnd;
  }

  return {
    name,
    unpSize,
    packedSize: ctx.dataSize,
    isDir,
    stored: method === 0,
    solid,
    encrypted,
    crypt: crypt ? { v: 5, ...crypt } : undefined,
    first: (ctx.flags & B5_DATA_NOT_FIRST) === 0,
    last: (ctx.flags & B5_DATA_NOT_LAST) === 0,
  };
}

/**
 * Parse one block from a plaintext header buffer whose byte 0 is the block's
 * CRC32. `dataOff` is where the block's data area begins (caller-supplied so
 * the encrypted path can account for the IV + ciphertext length). A crypt
 * header (htype 4) is returned via {@link HeaderCrypt} so the walk can set the
 * volume's block key.
 */
function parseRar5Plain(buf: Buffer, dataOff: number): BlockResult | undefined {
  let p = 4; // skip CRC32
  const [size, sizeLen] = uvarint(buf, p);
  if (size <= 0 || size > MAX_HEADER) return undefined;
  p += sizeLen;
  const headerStart = p;
  const headerEnd = headerStart + size;
  if (headerEnd > buf.length) return undefined;

  p = headerStart;
  const [htype, n1] = uvarint(buf, p);
  p += n1;
  const [flags, n2] = uvarint(buf, p);
  p += n2;
  let extraSize = 0;
  if (flags & B5_HAS_EXTRA) {
    const [v, n] = uvarint(buf, p);
    extraSize = v;
    p += n;
  }
  let dataSize = 0;
  if (flags & B5_HAS_DATA) {
    const [v, n] = uvarint(buf, p);
    dataSize = v;
    p += n;
  }
  const next = dataOff + dataSize;

  if (htype === B5_CRYPT) {
    // The crypt block's body IS the encryption record (no extra area, no iv;
    // block IVs prefix each encrypted block).
    const crypt = parseCryptRecord(buf, p, headerEnd - extraSize, false);
    return {
      kind: 'other',
      next,
      headerCrypt: crypt ? { v: 5, crypt } : undefined,
    };
  }
  if (htype === B5_END) return { kind: 'end', next };
  if (htype === B5_MAIN) {
    const [aflags, an] = uvarint(buf, p);
    let archiveVolumeNumber: number | undefined;
    if (aflags & ARC5_HAS_VOLUME_NUMBER) {
      const [vol] = uvarint(buf, p + an);
      archiveVolumeNumber = vol;
    }
    return { kind: 'other', next, archiveVolumeNumber };
  }
  if (htype !== B5_FILE) return { kind: 'other', next };

  const bodyEnd = headerEnd - extraSize;
  const file = parseRar5File(buf, p, bodyEnd, headerEnd, { flags, dataSize });
  if (!file) return { kind: 'other', next };
  return { kind: 'file', next, dataOff, file };
}

export async function parseRar5Block(
  ra: RandomAccess,
  ctx: VolumeCtx,
  abs: number
): Promise<BlockResult | undefined> {
  if (ctx.blockKey) {
    return parseRar5EncryptedBlock(ra, ctx, abs);
  }
  let win = await readWindow(ra, ctx, abs, 8192);
  if (win.length < 7) return undefined;

  // Peek the header size so a header larger than the initial window is fully
  // read (the plaintext parser needs the whole header body).
  let p = 4;
  const [size, sizeLen] = uvarint(win, p);
  if (size <= 0 || size > MAX_HEADER) return undefined;
  const headerEnd = 4 + sizeLen + size;
  if (headerEnd > win.length) {
    win = await readWindow(ra, ctx, abs, headerEnd + 32);
    if (win.length < headerEnd) return undefined;
  }
  const dataOff = abs + headerEnd;
  return parseRar5Plain(win, dataOff);
}

/**
 * Parse an AES-256-CBC encrypted RAR5 block header. Layout:
 * `[IV 16][ciphertext( CRC32 + sizeUvarint + headerBody ), padded to 16][data]`.
 * Decrypt the first cipher block to learn the header size, decrypt the rest,
 * then parse the plaintext with {@link parseRar5Plain}. The data area is left
 * untouched (skipped during the walk; decrypted on demand when streamed).
 */
async function parseRar5EncryptedBlock(
  ra: RandomAccess,
  ctx: VolumeCtx,
  abs: number
): Promise<BlockResult | undefined> {
  const key = ctx.blockKey!;
  // Read IV + a generous ciphertext window (encrypted headers are small).
  const win = await readWindow(ra, ctx, abs, 16 + 8192);
  if (win.length < 32) return undefined;
  const iv = win.subarray(0, 16);
  const cipher = win.subarray(16);
  // First plaintext block reveals CRC + header size.
  const first = decryptCbc(key, iv, cipher.subarray(0, 16));
  if (first.length < 7) return undefined;
  const [size, sizeLen] = uvarint(first, 4);
  if (size <= 0 || size > MAX_HEADER) return undefined;
  const plainHeaderLen = 4 + sizeLen + size;
  const encLen = Math.ceil(plainHeaderLen / 16) * 16;
  if (encLen > cipher.length) return undefined;
  const plain = decryptCbc(key, iv, cipher.subarray(0, encLen));
  if (plain.length < plainHeaderLen) return undefined;
  // The data area follows the IV + encrypted header (its own encryption is
  // handled by the file's key when streamed, not here).
  const dataOffBase = abs + 16 + encLen;
  // parseRar5Plain computes `next = dataOff + dataSize`; pass the post-header
  // absolute offset so data is accounted for from the right place.
  return parseRar5Plain(plain, dataOffBase);
}

/**
 * Derive the block key from a parsed crypt header and validate the password.
 * Throws {@link RarEncryptedError}/{@link RarBadPasswordError} on failure.
 */
export function blockKeyFromCrypt(
  crypt: Rar5CryptInfo,
  password: string | undefined
): Buffer {
  if (!password) throw new RarEncryptedError();
  const keys = deriveRar5Keys(password, crypt.salt, crypt.kdfLog2);
  if (!passwordMatches(keys, crypt.check)) throw new RarBadPasswordError();
  return keys.key;
}

export { B5_CRYPT };
