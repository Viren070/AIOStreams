import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, randomBytes } from 'node:crypto';
import { decryptString } from './crypto.js';
import { toUrlSafeBase64 } from './general.js';

// Regression guard against a CBC padding oracle. decryptString must return the
// SAME error for a ciphertext with bad PKCS#7 padding and for one that decrypts
// but is not a valid deflate stream. If the two ever differ again, a caller
// that surfaces the message (e.g. the auth header parser) leaks one bit per
// request, enough to decrypt any blob a byte at a time without the key.
describe('decryptString padding oracle', () => {
  const key = randomBytes(32); // test-local key; the property is key-independent
  const iv = randomBytes(16);

  const wrap = (ivBuf: Buffer, ct: Buffer) =>
    toUrlSafeBase64(
      JSON.stringify({ i: ivBuf.toString('base64'), e: ct.toString('base64'), t: 'a' })
    );

  // A plaintext that is valid PKCS#7 (cipher.final adds it) but NOT a valid
  // deflate stream, so decrypt succeeds and decompress is what fails.
  const cipher = createCipheriv('aes-256-cbc', key, iv);
  const validPaddingCt = Buffer.concat([
    cipher.update(Buffer.from('this is definitely not a deflate stream')),
    cipher.final(),
  ]);

  // Same ciphertext with the last byte flipped -> PKCS#7 padding check fails.
  const badPaddingCt = Buffer.from(validPaddingCt);
  badPaddingCt[badPaddingCt.length - 1] ^= 0xff;

  test('valid padding and bad padding return the same error', () => {
    const good = decryptString(wrap(iv, validPaddingCt), key);
    const bad = decryptString(wrap(iv, badPaddingCt), key);

    assert.equal(good.success, false, 'garbage plaintext should fail to inflate');
    assert.equal(bad.success, false, 'corrupt padding should fail to decrypt');

    // No oracle: both failures must be indistinguishable to the caller.
    assert.equal(
      good.error,
      bad.error,
      `padding oracle: messages must match.\n  valid-padding: ${good.error}\n  bad-padding:   ${bad.error}`
    );
  });
});
