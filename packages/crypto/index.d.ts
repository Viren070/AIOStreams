declare const crypto: {
  /**
   * Raw AES-CBC decrypt of `data` in place, no padding; the key length picks
   * AES-128/192/256. `null` when the native binary is unavailable.
   */
  aesCbcDecrypt: ((key: Buffer, iv: Buffer, data: Buffer) => void) | null;
};
export = crypto;
