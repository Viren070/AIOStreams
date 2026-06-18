import { crc32 } from 'node:zlib';
import { RandomAccess } from '../random-access.js';
import { BlockResult, ParsedFile, VolumeCtx } from './types.js';
import { readWindow } from './scan.js';
import {
  RarBadPasswordError,
  decryptCbc,
  deriveRar4KeyIv,
} from '../crypto/rar-kdf.js';

// ---- RAR4 constants ---------------------------------------------------------
const B15_ARC = 0x73;
const B15_FILE = 0x74;
const B15_END = 0x7b;
const B15_HAS_DATA = 0x8000;
const ARC15_ENCRYPTED = 0x0080;
const F15_SPLIT_BEFORE = 0x0001;
const F15_SPLIT_AFTER = 0x0002;
const F15_ENCRYPTED = 0x0004;
const F15_SOLID = 0x0010;
const F15_WINDOW_MASK = 0x00e0;
const F15_LARGE_DATA = 0x0100;
const F15_SALT = 0x0400;
const SALT15_SIZE = 8;

const ceil16 = (n: number): number => Math.ceil(n / 16) * 16;

export function parseRar4File(
  buf: Buffer,
  headerSize: number,
  flags: number,
  dataSize: number
): ParsedFile | undefined {
  // Body begins after HEAD(7) + ADD_SIZE/PACK_SIZE(4).
  let p = 11;
  if (p + 21 > headerSize) return undefined;
  let unpSize = buf.readUInt32LE(p);
  p += 4; // UNP_SIZE (low 32)
  p += 1; // HOST_OS
  p += 4; // FILE_CRC
  p += 4; // FTIME
  p += 1; // UNP_VER
  const method = buf[p] - 0x30; // 0 == stored
  p += 1;
  const nameSize = buf.readUInt16LE(p);
  p += 2;
  p += 4; // ATTR
  if (flags & F15_LARGE_DATA) {
    if (p + 8 > headerSize) return undefined;
    p += 4; // HIGH_PACK_SIZE (already folded into dataSize)
    unpSize += buf.readUInt32LE(p) * 2 ** 32;
    p += 4;
  }
  if (p + nameSize > headerSize) return undefined;
  const nameBytes = buf.subarray(p, p + nameSize);
  // Non-unicode path or UTF-8 up to the first NUL; '\' -> '/'.
  const nul = nameBytes.indexOf(0);
  const name = nameBytes
    .subarray(0, nul === -1 ? nameBytes.length : nul)
    .toString('utf8')
    .replace(/\\/g, '/');
  p += nameSize;

  // Encryption salt sits right after the name (before ext-time). The key/IV
  // are derived from the FIRST block's salt; the data is one continuous
  // AES-128-CBC stream across volumes. Encrypted without a salt = pre-3.0
  // legacy crypto; flagged encrypted but not decryptable here.
  let crypt: ParsedFile['crypt'];
  if (flags & F15_ENCRYPTED && flags & F15_SALT) {
    if (p + SALT15_SIZE > headerSize) return undefined;
    crypt = { v: 4, salt: Buffer.from(buf.subarray(p, p + SALT15_SIZE)) };
  }

  const isDir = (flags & F15_WINDOW_MASK) === F15_WINDOW_MASK;
  return {
    name,
    unpSize,
    packedSize: dataSize,
    isDir,
    stored: method === 0 && !isDir,
    solid: (flags & F15_SOLID) > 0,
    encrypted: (flags & F15_ENCRYPTED) > 0,
    crypt,
    first: (flags & F15_SPLIT_BEFORE) === 0,
    last: (flags & F15_SPLIT_AFTER) === 0,
  };
}

/**
 * Parse one block from a plaintext header buffer whose byte 0 is the block's
 * CRC16. `dataOff` is where the block's data area begins (caller-supplied so
 * the encrypted path can account for the salt + ciphertext padding). The main
 * header's encrypted flag (`-hp`) is reported via `headerCrypt` so the walk
 * switches to the encrypted block path.
 */
function parseRar4Plain(buf: Buffer, dataOff: number): BlockResult | undefined {
  // CRC(2) TYPE(1) FLAGS(2) SIZE(2) [ADD_SIZE(4) if HAS_DATA] ...
  const htype = buf[2];
  const flags = buf.readUInt16LE(3);
  const size = buf.readUInt16LE(5);
  if (size < 7 || size > buf.length) return undefined;

  let dataSize = 0;
  if (flags & B15_HAS_DATA) {
    if (size < 11) return undefined;
    dataSize = buf.readUInt32LE(7);
  }
  // 64-bit data size for large file/service blocks. The HIGH_PACK_SIZE dword
  // sits at offset 32 (7-byte block header + low PACK_SIZE(4) + UNP_SIZE(4) +
  // HostOS(1) + CRC(4) + MTime(4) + Ver(1) + Method(1) + NameSize(2) +
  // ATTR(4) = 32). Reading offset 28 here folds the file ATTR (commonly 0x20)
  // into the size as 0x20<<32 ≈ 137 GB, corrupting fragment lengths.
  if ((htype === B15_FILE || htype === 0x7a) && flags & F15_LARGE_DATA) {
    if (size >= 7 + 29) {
      dataSize += buf.readUInt32LE(7 + 25) * 2 ** 32;
    }
  }
  const next = dataOff + dataSize;

  if (htype === B15_END) return { kind: 'end', next };
  if (htype === B15_ARC && flags & ARC15_ENCRYPTED) {
    // -hp: every header after the (plaintext) main header is encrypted.
    return { kind: 'other', next, headerCrypt: { v: 4 } };
  }
  if (htype !== B15_FILE) return { kind: 'other', next };

  const file = parseRar4File(buf, size, flags, dataSize);
  if (!file) return { kind: 'other', next };
  return { kind: 'file', next, dataOff, file };
}

export async function parseRar4Block(
  ra: RandomAccess,
  ctx: VolumeCtx,
  abs: number
): Promise<BlockResult | undefined> {
  if (ctx.rar4Encrypted) {
    return parseRar4EncryptedBlock(ra, ctx, abs);
  }
  let win = await readWindow(ra, ctx, abs, 8192);
  if (win.length < 7) return undefined;
  const size = win.readUInt16LE(5);
  if (size < 7) return undefined;
  if (size > win.length) {
    win = await readWindow(ra, ctx, abs, size + 32);
    if (win.length < size) return undefined;
  }
  return parseRar4Plain(win, abs + size);
}

/**
 * Parse an AES-128-CBC encrypted RAR4 block header (`-hp`). Layout:
 * `[salt 8][ciphertext( 7-byte prefix + body ), padded to 16][data]`; each
 * header carries its own salt and a fresh per-salt key/IV. Decrypts the first
 * cipher block to learn the header size, decrypts the rest, CRC16-verifies,
 * then parses with {@link parseRar4Plain}.
 *
 * RAR4 has no password-check value, so the first decrypted header's CRC is the
 * password check: garbage size / CRC mismatch before any header has verified
 * throws {@link RarBadPasswordError}; after verification the same evidence is
 * corruption and ends the parse.
 */
async function parseRar4EncryptedBlock(
  ra: RandomAccess,
  ctx: VolumeCtx,
  abs: number
): Promise<BlockResult | undefined> {
  let win = await readWindow(ra, ctx, abs, SALT15_SIZE + 8192);
  if (win.length < SALT15_SIZE + 16) return undefined;
  const salt = Buffer.from(win.subarray(0, SALT15_SIZE));
  const { key, iv } = deriveRar4KeyIv(ctx.password!, salt);

  const badPassword = (): undefined => {
    if (!ctx.rar4Verified) throw new RarBadPasswordError();
    return undefined;
  };

  // First plaintext block reveals CRC + header size.
  const first = decryptCbc(
    key,
    iv,
    win.subarray(SALT15_SIZE, SALT15_SIZE + 16)
  );
  if (first.length < 7) return undefined;
  const size = first.readUInt16LE(5);
  if (size < 7) return badPassword();
  const encLen = ceil16(size);
  if (SALT15_SIZE + encLen > win.length) {
    win = await readWindow(ra, ctx, abs, SALT15_SIZE + encLen + 32);
    // A wrong password decrypts the size field to noise, typically pointing
    // past the volume; a short re-read before verification is that evidence.
    if (win.length < SALT15_SIZE + encLen) return badPassword();
  }
  const plain = decryptCbc(
    key,
    iv,
    win.subarray(SALT15_SIZE, SALT15_SIZE + encLen)
  );
  if (plain.length < size) return badPassword();
  if ((crc32(plain.subarray(2, size)) & 0xffff) !== plain.readUInt16LE(0)) {
    return badPassword();
  }
  ctx.rar4Verified = true;
  // The data area follows the salt + padded ciphertext (file data is decrypted
  // by the file's own key when streamed, not here).
  return parseRar4Plain(plain, abs + SALT15_SIZE + encLen);
}
