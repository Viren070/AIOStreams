import { createHash, createDecipheriv } from 'node:crypto';

/**
 * 7-zip AES-256-CBC + SHA-256 decryption, ported from `bodgit/sevenzip`. Used
 * to decrypt a password-protected 7z's encoded (LZMA→AES) header and its AES
 * content folders. Node's built-in `crypto` provides SHA-256 and AES-256-CBC,
 * so no dependency is needed.
 */

/** AES coder id in a 7z folder (`06 f1 07 01`). */
export const CODER_AES = Buffer.from([0x06, 0xf1, 0x07, 0x01]);

/**
 * KDF iteration exponent is capped to bound CPU. Standard 7-zip uses 19
 * (~500K rounds); 24 (~16M) gives headroom. `0x3f` bypasses hashing.
 */
const MAX_CYCLES_POWER = 24;

export interface AesParams {
  salt: Buffer;
  iv: Buffer;
  /** KDF iteration exponent (`2^cycles` SHA-256 rounds), or `0x3f` for raw. */
  cycles: number;
}

/**
 * Parse an AES coder's `properties` bytes into salt/iv/cycles. Layout: `p[0]`
 * packs cycles + high salt/iv-size bits, `p[1]` packs salt/iv sizes, then salt
 * bytes, then iv bytes.
 */
export function parseAesParams(props: Buffer): AesParams {
  if (props.length < 2) {
    throw new Error('aes7z: not enough properties');
  }
  if ((props[0] & 0xc0) === 0) {
    throw new Error('aes7z: unsupported method');
  }
  const saltSize = ((props[0] >> 7) & 1) + (props[1] >> 4);
  const ivSize = ((props[0] >> 6) & 1) + (props[1] & 0x0f);
  if (props.length !== 2 + saltSize + ivSize) {
    throw new Error('aes7z: not enough properties');
  }
  const salt = props.subarray(2, 2 + saltSize);
  const iv = Buffer.alloc(16);
  props.subarray(2 + saltSize).copy(iv);
  return { salt, iv, cycles: props[0] & 0x3f };
}

const keyCache = new Map<string, Buffer>();

/**
 * Derive the AES-256 key from the password (UTF-16LE), salt and cycles.
 * `cycles === 0x3f` copies salt+password directly into the key.
 */
export function deriveAesKey(
  password: string,
  cycles: number,
  salt: Buffer
): Buffer {
  const cacheKey = `${cycles}:${salt.toString('hex')}:${password}`;
  const cached = keyCache.get(cacheKey);
  if (cached) return cached;

  // 7-zip encodes the password as UTF-16LE without a BOM.
  const pw = Buffer.from(password, 'utf16le');
  const key = Buffer.alloc(32);

  if (cycles === 0x3f) {
    Buffer.concat([salt, pw]).copy(key, 0, 0, 32);
  } else {
    if (cycles > MAX_CYCLES_POWER) {
      throw new Error(`aes7z: cycles power exceeds maximum (${cycles})`);
    }
    const h = createHash('sha256');
    const counter = Buffer.alloc(8);
    const rounds = 1n << BigInt(cycles);
    for (let i = 0n; i < rounds; i++) {
      h.update(salt);
      h.update(pw);
      counter.writeBigUInt64LE(i);
      h.update(counter);
    }
    h.digest().copy(key);
  }

  if (keyCache.size > 16) keyCache.clear();
  keyCache.set(cacheKey, key);
  return key;
}

/**
 * Decrypt an AES-256-CBC buffer in full (used for the small encoded header).
 * `ciphertext` must be block-aligned (16 bytes); output is clamped to
 * `outSize`. Padding is not validated (7-zip pads to the block boundary).
 */
export function decryptAesAll(
  params: AesParams,
  password: string,
  ciphertext: Buffer,
  outSize: number
): Buffer {
  const key = deriveAesKey(password, params.cycles, params.salt);
  const decipher = createDecipheriv('aes-256-cbc', key, params.iv);
  decipher.setAutoPadding(false);
  const aligned = ciphertext.length - (ciphertext.length % 16);
  const out = Buffer.concat([
    decipher.update(ciphertext.subarray(0, aligned)),
    decipher.final(),
  ]);
  return out.subarray(0, outSize);
}

/**
 * Decrypt a block-aligned region of an AES-256-CBC stream starting at
 * ciphertext block `startBlock`, using `prevBlock` (the preceding 16-byte
 * ciphertext block, or the stream IV for block 0) as the CBC IV. Enables
 * seekable decryption: any 16-byte boundary can be decrypted from the prior
 * block. `ciphertext` must be a multiple of 16 bytes.
 */
export function decryptAesRegion(
  key: Buffer,
  prevBlock: Buffer,
  ciphertext: Buffer
): Buffer {
  const decipher = createDecipheriv('aes-256-cbc', key, prevBlock);
  decipher.setAutoPadding(false);
  // With padding off and block-aligned input, update() yields all plaintext
  // and final() is empty, so the concat (a full extra copy) can be skipped.
  const out = decipher.update(ciphertext);
  const fin = decipher.final();
  return fin.length === 0 ? out : Buffer.concat([out, fin]);
}
