/**
 * RAR4/RAR5 (`-hp` header / `-p` data) encryption primitives, ported from
 * `nwaples/rardecode/v2`.
 *
 * RAR5 derives its keys with PBKDF2-HMAC-SHA256 over a single output block,
 * reading the AES key at iteration `2^kdfLog2` and two further checkpoints 16
 * and 32 iterations later (the 2nd is an optional file-checksum key, the 3rd
 * folds down to the 12-byte password-check value). Node's `pbkdf2Sync` computes
 * exactly that single-block PBKDF2, so the three keys are three native calls at
 * iteration counts `2^kdfLog2`, `+16`, `+32`. Data is AES-256-CBC.
 *
 * RAR4 (1.5-4.x) uses a custom SHA-1 KDF: one accumulating SHA-1 over 0x40000
 * rounds of `UTF16LE(password) + salt(8) + 3-byte LE round counter`; the IV is
 * byte 19 of the intermediate digest sampled every 16384 rounds, the AES-128
 * key is the final digest's first 16 bytes with each dword byte-reversed.
 * RAR4 has no password-check value; a wrong password surfaces as a CRC16
 * mismatch on the first decrypted header (`-hp`), or not at all (`-p`).
 *
 * In both versions stored file data is one continuous CBC stream over the
 * file's concatenated volume fragments, seekable at 16-byte boundaries (the
 * preceding ciphertext block is the IV); see {@link ./rar-aes-source.js}.
 */
import {
  createDecipheriv,
  createHash,
  pbkdf2Sync,
  timingSafeEqual,
} from 'node:crypto';

/** Max KDF exponent the format allows (`2^24` iterations). */
const MAX_KDF_LOG2 = 24;
/** PBKDF2 salt is capped at 64 bytes in the reference. */
const MAX_SALT = 64;
const PW_CHECK_FOLD = 8;

/** The RAR5 encryption parameters captured from a crypt header / file record. */
export interface Rar5CryptInfo {
  /** KDF iteration exponent: PBKDF2 runs `2^kdfLog2` iterations. */
  kdfLog2: number;
  /** 16-byte PBKDF2 salt. */
  salt: Buffer;
  /** 16-byte AES-CBC initial vector (per encrypted region/file). */
  iv: Buffer;
  /** Optional 12-byte password-check value (validate before trusting bytes). */
  check?: Buffer;
}

/**
 * Version-tagged encryption parameters for a stored encrypted entry. RAR4
 * carries only the 8-byte salt (KDF rounds are fixed and the IV is derived);
 * RAR5 carries the full file-encryption record. {@link cryptKeyIv} resolves
 * either into an AES key + IV.
 */
export type RarCryptInfo = ({ v: 5 } & Rar5CryptInfo) | { v: 4; salt: Buffer };

/** A resolved AES-CBC key + initial vector. */
export interface RarKeyIv {
  key: Buffer;
  iv: Buffer;
}

/** Derived RAR5 keys. */
export interface Rar5Keys {
  /** AES-256 key for block/data decryption. */
  key: Buffer;
  /** File-checksum key (unused for stored-file streaming). */
  hashKey: Buffer;
  /** 12-byte password-check value to compare against a record's `check`. */
  pwcheck: Buffer;
}

/** Thrown when an archive is encrypted but no password was supplied. */
export class RarEncryptedError extends Error {
  constructor(message = 'rar archive is encrypted (password required)') {
    super(message);
    this.name = 'RarEncryptedError';
  }
}

/** Thrown when the supplied password fails the archive's password check. */
export class RarBadPasswordError extends Error {
  constructor(message = 'rar archive password is incorrect') {
    super(message);
    this.name = 'RarBadPasswordError';
  }
}

/**
 * Minimal LRU for derived keys: KDF derivation is expensive and an archive
 * reuses one salt per volume (often one for the whole set), so a handful of
 * entries absorbs all repeats. 16 covers typical concurrent volume walks.
 */
class KeyLru<V> {
  private readonly map = new Map<string, V>();
  constructor(private readonly max: number) {}
  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v); // LRU refresh
    }
    return v;
  }
  set(key: string, value: V): void {
    this.map.set(key, value);
    if (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }
}

const KEY_CACHE_MAX = 16;
const rar5KeyCache = new KeyLru<Rar5Keys>(KEY_CACHE_MAX);
const rar4KeyCache = new KeyLru<RarKeyIv>(KEY_CACHE_MAX);

function cacheKey(password: string, salt: Buffer, kdfLog2: number): string {
  const passHash = createHash('sha256').update(password, 'utf8').digest('hex');
  return `${passHash}:${salt.toString('hex')}:${kdfLog2}`;
}

/**
 * Derive the RAR5 key set for a password + salt + KDF exponent. Cached: a
 * header-encrypted archive shares one salt per volume set, so the expensive
 * PBKDF2 derivation runs once.
 */
export function deriveRar5Keys(
  password: string,
  salt: Buffer,
  kdfLog2: number
): Rar5Keys {
  if (kdfLog2 > MAX_KDF_LOG2) {
    throw new RarBadPasswordError('rar5 kdf count out of range');
  }
  const usableSalt = salt.length > MAX_SALT ? salt.subarray(0, MAX_SALT) : salt;
  const pass = Buffer.from(password, 'utf8');
  const ck = cacheKey(password, usableSalt, kdfLog2);
  const cached = rar5KeyCache.get(ck);
  if (cached) return cached;

  const iters = 1 << kdfLog2;
  // Single-block PBKDF2 checkpoints: key at 2^n, file-hash key at +16, the
  // password-check seed at +32.
  const key = pbkdf2Sync(pass, usableSalt, iters, 32, 'sha256');
  const hashKey = pbkdf2Sync(pass, usableSalt, iters + 16, 32, 'sha256');
  const k2 = pbkdf2Sync(pass, usableSalt, iters + 32, 32, 'sha256');

  // Password check: fold bytes 8..31 of k2 into 0..7 (index & 7), then append
  // the first 4 bytes of its SHA-256 → a 12-byte value.
  const fold = Buffer.from(k2.subarray(0, PW_CHECK_FOLD));
  for (let i = PW_CHECK_FOLD; i < k2.length; i++) {
    fold[(i - PW_CHECK_FOLD) & (PW_CHECK_FOLD - 1)] ^= k2[i];
  }
  const sum = createHash('sha256').update(fold).digest();
  const pwcheck = Buffer.concat([fold, sum.subarray(0, 4)]);

  const keys: Rar5Keys = { key, hashKey, pwcheck };
  rar5KeyCache.set(ck, keys);
  return keys;
}

/** RAR4 KDF round count, fixed by the format. */
const RAR4_ROUNDS = 0x40000;
/** The IV is sampled from 16 intermediate digests, one every 16384 rounds. */
const RAR4_IV_SAMPLES = 16;

/**
 * Derive the RAR4 AES-128 key + IV for a password + 8-byte salt. One
 * accumulating SHA-1 consumes 0x40000 rounds of
 * `UTF16LE(password) + salt + 3-byte LE round counter`; `iv[j]` is byte 19 of
 * the digest snapshot taken right after round `j * 16384`; the key is the
 * final digest's first 16 bytes with each 4-byte dword byte-reversed. Rounds
 * are batched (16 chunks of one pre-built buffer) to avoid per-round native
 * crossing overhead. Cached like the RAR5 keys: `-hp` sets reuse one header
 * salt per volume.
 */
export function deriveRar4KeyIv(password: string, salt: Buffer): RarKeyIv {
  const ck = cacheKey(password, salt, 4);
  const cached = rar4KeyCache.get(ck);
  if (cached) return cached;

  // The password is encoded as UTF-16LE before hashing, as required by RAR4.
  const pass = Buffer.from(password, 'utf16le');
  const p = Buffer.concat([pass, salt]);
  const unit = p.length + 3; // password+salt followed by the LE24 round counter
  const interval = RAR4_ROUNDS / RAR4_IV_SAMPLES;

  // One chunk holds rounds 1..interval-1 of a sample window; the counter
  // bytes are rewritten in place each window.
  const chunk = Buffer.alloc(unit * (interval - 1));
  for (let off = 0; off < chunk.length; off += unit) p.copy(chunk, off);
  const first = Buffer.alloc(unit);
  p.copy(first, 0);

  const hash = createHash('sha1');
  const iv = Buffer.alloc(16);
  for (let j = 0; j < RAR4_IV_SAMPLES; j++) {
    const base = j * interval;
    first[p.length] = base & 0xff;
    first[p.length + 1] = (base >> 8) & 0xff;
    first[p.length + 2] = (base >> 16) & 0xff;
    hash.update(first);
    iv[j] = hash.copy().digest()[19];
    for (let r = 1; r < interval; r++) {
      const i = base + r;
      const off = (r - 1) * unit + p.length;
      chunk[off] = i & 0xff;
      chunk[off + 1] = (i >> 8) & 0xff;
      chunk[off + 2] = (i >> 16) & 0xff;
    }
    hash.update(chunk);
  }

  const key = Buffer.from(hash.digest().subarray(0, 16));
  for (let o = 0; o < 16; o += 4) {
    [key[o], key[o + 1], key[o + 2], key[o + 3]] = [
      key[o + 3],
      key[o + 2],
      key[o + 1],
      key[o],
    ];
  }

  const out: RarKeyIv = { key, iv };
  rar4KeyCache.set(ck, out);
  return out;
}

/**
 * Resolve any {@link RarCryptInfo} into its AES key + IV. Throws
 * {@link RarEncryptedError} when no password was supplied, and
 * {@link RarBadPasswordError} when a RAR5 record's check value rejects it
 * (RAR4 has no check; `-hp` wrong passwords surface as a header CRC mismatch
 * in the block walk, `-p` wrong passwords are undetectable at this layer).
 */
export function cryptKeyIv(
  crypt: RarCryptInfo,
  password: string | undefined
): RarKeyIv {
  if (!password) throw new RarEncryptedError();
  if (crypt.v === 4) return deriveRar4KeyIv(password, crypt.salt);
  const keys = deriveRar5Keys(password, crypt.salt, crypt.kdfLog2);
  if (!passwordMatches(keys, crypt.check)) throw new RarBadPasswordError();
  return { key: keys.key, iv: crypt.iv };
}

/**
 * Validate a record's password-check value against derived keys. Returns true
 * when the record carries no check (nothing to verify) or it matches.
 */
export function passwordMatches(keys: Rar5Keys, check?: Buffer): boolean {
  if (!check || check.length === 0) return true;
  if (check.length !== keys.pwcheck.length) return false;
  return timingSafeEqual(check, keys.pwcheck);
}

/**
 * AES-CBC decrypt without padding removal (callers handle block alignment and
 * trailing-pad trimming themselves). The variant follows the key length:
 * 16 bytes → AES-128 (RAR4), 32 bytes → AES-256 (RAR5). `cipher.length` must
 * be a multiple of 16; the function rounds down defensively.
 */
export function decryptCbc(key: Buffer, iv: Buffer, cipher: Buffer): Buffer {
  const aligned = cipher.length - (cipher.length % 16);
  if (aligned <= 0) return Buffer.alloc(0);
  const algorithm = key.length === 16 ? 'aes-128-cbc' : 'aes-256-cbc';
  const decipher = createDecipheriv(algorithm, key, iv);
  decipher.setAutoPadding(false);
  return Buffer.concat([
    decipher.update(cipher.subarray(0, aligned)),
    decipher.final(),
  ]);
}
