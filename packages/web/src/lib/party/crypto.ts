import { gcm } from '@noble/ciphers/aes.js';
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';

/*
 * A party's id and key come from its code. Slow to derive on purpose: the
 * relay knows the id, and finding the code behind it means trying every one.
 * The page has no WebCrypto over plain http, hence the library beside it.
 */

const SALT = new TextEncoder().encode('aiostreams-party-1');
const ITERATIONS = 100_000;

export interface PartyKeys {
  id: string;
  key: Uint8Array;
}

function base64url(bytes: Uint8Array): string {
  let text = '';
  for (const b of bytes) text += String.fromCharCode(b);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(text: string): Uint8Array {
  const plain = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(plain, (c) => c.charCodeAt(0));
}

async function derive(code: string): Promise<Uint8Array> {
  const secret = new TextEncoder().encode(code);
  const subtle = globalThis.crypto?.subtle;
  if (!subtle)
    return pbkdf2Async(sha256, secret, SALT, { c: ITERATIONS, dkLen: 48 });
  const base = await subtle.importKey('raw', secret, 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await subtle.deriveBits(
    { name: 'PBKDF2', salt: SALT, iterations: ITERATIONS, hash: 'SHA-256' },
    base,
    384
  );
  return new Uint8Array(bits);
}

let last: { code: string; keys: Promise<PartyKeys> } | null = null;

/** The last code's keys are kept: a preview and the join after it both need them. */
export function partyKeys(code: string): Promise<PartyKeys> {
  if (last?.code !== code)
    last = {
      code,
      keys: derive(code).then((bits) => ({
        id: base64url(bits.subarray(0, 16)),
        key: bits.slice(16),
      })),
    };
  return last.keys;
}

export function seal(key: Uint8Array, value: unknown): string {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const data = gcm(key, nonce).encrypt(
    new TextEncoder().encode(JSON.stringify(value))
  );
  const out = new Uint8Array(nonce.length + data.length);
  out.set(nonce);
  out.set(data, nonce.length);
  return base64url(out);
}

/** What `seal` sealed, or null for anything not sealed with this key. */
export function unseal<T>(key: Uint8Array, sealed: string): T | null {
  try {
    const bytes = fromBase64url(sealed);
    const data = gcm(key, bytes.subarray(0, 12)).decrypt(bytes.subarray(12));
    return JSON.parse(new TextDecoder().decode(data)) as T;
  } catch {
    return null;
  }
}
