/**
 * Minimal LZMA1 raw-stream decode. Used **only** to decompress a
 * 7z archive's encoded header (`kEncodedHeader`), which is small and off the
 * playback hot path; stored (copy-coder) file content is never run through it.
 *
 * Input is a raw LZMA1 stream (no `.lzma`/ALONE container, no end-of-stream
 * marker required) plus the 5-byte 7z coder properties (`lclppb` + 4-byte little
 * endian dictionary size) and the known decoded size. Decoding stops exactly at
 * `outSize` bytes.
 */

const K_NUM_BIT_MODEL_TOTAL_BITS = 11;
const K_BIT_MODEL_TOTAL = 1 << K_NUM_BIT_MODEL_TOTAL_BITS;
const K_NUM_MOVE_BITS = 5;
const PROB_INIT = K_BIT_MODEL_TOTAL >>> 1;

const K_NUM_POS_BITS_MAX = 4;
const K_NUM_STATES = 12;
const K_NUM_LEN_TO_POS_STATES = 4;
const K_NUM_ALIGN_BITS = 4;
const K_END_POS_MODEL_INDEX = 14;
const K_NUM_FULL_DISTANCES = 1 << (K_END_POS_MODEL_INDEX >> 1);
const K_MATCH_MIN_LEN = 2;

class RangeDecoder {
  range = 0xffffffff;
  code = 0;
  pos = 0;

  constructor(private buf: Buffer) {
    // First byte is always 0 and ignored; next 4 form the initial code.
    this.pos = 1;
    for (let i = 0; i < 4; i++) {
      this.code = ((this.code << 8) | this.nextByte()) >>> 0;
    }
  }

  private nextByte(): number {
    return this.pos < this.buf.length ? this.buf[this.pos++] : 0;
  }

  private normalize(): void {
    if (this.range < 0x0100_0000) {
      this.range = (this.range << 8) >>> 0;
      this.code = ((this.code << 8) | this.nextByte()) >>> 0;
    }
  }

  decodeDirectBits(numBits: number): number {
    let res = 0;
    do {
      this.range = this.range >>> 1;
      this.code = (this.code - this.range) >>> 0;
      const t = 0 - (this.code >>> 31); // 0 or 0xFFFFFFFF
      this.code = (this.code + (this.range & t)) >>> 0;
      this.normalize();
      res = ((res << 1) + t + 1) >>> 0;
    } while (--numBits);
    return res >>> 0;
  }

  decodeBit(probs: Uint16Array, index: number): number {
    let v = probs[index];
    const bound = (this.range >>> K_NUM_BIT_MODEL_TOTAL_BITS) * v;
    let symbol: number;
    // Unsigned compare.
    if (this.code >>> 0 < bound >>> 0) {
      v += (K_BIT_MODEL_TOTAL - v) >>> K_NUM_MOVE_BITS;
      this.range = bound >>> 0;
      symbol = 0;
    } else {
      v -= v >>> K_NUM_MOVE_BITS;
      this.code = (this.code - bound) >>> 0;
      this.range = (this.range - bound) >>> 0;
      symbol = 1;
    }
    probs[index] = v;
    this.normalize();
    return symbol;
  }
}

function bitTreeDecode(
  rc: RangeDecoder,
  probs: Uint16Array,
  offset: number,
  numBits: number
): number {
  let m = 1;
  for (let i = 0; i < numBits; i++) {
    m = (m << 1) + rc.decodeBit(probs, offset + m);
  }
  return m - (1 << numBits);
}

function bitTreeReverseDecode(
  rc: RangeDecoder,
  probs: Uint16Array,
  offset: number,
  numBits: number
): number {
  let m = 1;
  let symbol = 0;
  for (let i = 0; i < numBits; i++) {
    const bit = rc.decodeBit(probs, offset + m);
    m = (m << 1) + bit;
    symbol |= bit << i;
  }
  return symbol;
}

// Length decoder: choice + choice2 + low[16][8] + mid[16][8] + high[256].
class LenDecoder {
  choice = new Uint16Array(2).fill(PROB_INIT);
  low = new Uint16Array((1 << K_NUM_POS_BITS_MAX) * 8).fill(PROB_INIT);
  mid = new Uint16Array((1 << K_NUM_POS_BITS_MAX) * 8).fill(PROB_INIT);
  high = new Uint16Array(256).fill(PROB_INIT);

  decode(rc: RangeDecoder, posState: number): number {
    if (rc.decodeBit(this.choice, 0) === 0) {
      return bitTreeDecode(rc, this.low, posState * 8, 3);
    }
    if (rc.decodeBit(this.choice, 1) === 0) {
      return 8 + bitTreeDecode(rc, this.mid, posState * 8, 3);
    }
    return 16 + bitTreeDecode(rc, this.high, 0, 8);
  }
}

/**
 * Hard cap on a single LZMA decode output (only ever a 7z archive header here).
 * Deliberately generous (real season-pack headers are far smaller), so the cap
 * never rejects a legitimate archive; it exists solely to stop a corrupt or
 * hostile NZB from declaring a gigantic header size and forcing a huge buffer
 * allocation + multi-minute decode (a CPU/RAM DoS on the engine).
 */
const MAX_DECODED_BYTES = 128 * 1024 * 1024;
/** Wall-clock backstop for a runaway/looping decode (a malformed stream). */
const DECODE_BUDGET_MS = 30_000;

/** Decode a raw LZMA1 stream into exactly `outSize` bytes. */
export function decodeLzma1(
  props: Buffer,
  input: Buffer,
  outSize: number
): Buffer {
  if (props.length < 5) throw new Error('lzma: properties too short');
  if (outSize < 0 || outSize > MAX_DECODED_BYTES) {
    throw new Error(
      `lzma: refusing to decode ${outSize} bytes (cap ${MAX_DECODED_BYTES})`
    );
  }
  let d = props[0];
  if (d >= 9 * 5 * 5) throw new Error('lzma: invalid properties byte');
  const lc = d % 9;
  d = Math.floor(d / 9);
  const lp = d % 5;
  const pb = Math.floor(d / 5);

  const out = Buffer.allocUnsafe(outSize);
  let outPos = 0;
  const startedAt = Date.now();
  let iter = 0;

  const rc = new RangeDecoder(input);

  // Probability model.
  const posSlotDecoder = new Uint16Array(
    K_NUM_LEN_TO_POS_STATES * (1 << 6)
  ).fill(PROB_INIT);
  const alignDecoder = new Uint16Array(1 << K_NUM_ALIGN_BITS).fill(PROB_INIT);
  const posDecoders = new Uint16Array(
    1 + K_NUM_FULL_DISTANCES - K_END_POS_MODEL_INDEX
  ).fill(PROB_INIT);
  const isMatch = new Uint16Array(K_NUM_STATES << K_NUM_POS_BITS_MAX).fill(
    PROB_INIT
  );
  const isRep = new Uint16Array(K_NUM_STATES).fill(PROB_INIT);
  const isRepG0 = new Uint16Array(K_NUM_STATES).fill(PROB_INIT);
  const isRepG1 = new Uint16Array(K_NUM_STATES).fill(PROB_INIT);
  const isRepG2 = new Uint16Array(K_NUM_STATES).fill(PROB_INIT);
  const isRep0Long = new Uint16Array(K_NUM_STATES << K_NUM_POS_BITS_MAX).fill(
    PROB_INIT
  );
  const litProbs = new Uint16Array(0x300 << (lc + lp)).fill(PROB_INIT);
  const lenDecoder = new LenDecoder();
  const repLenDecoder = new LenDecoder();

  const posMask = (1 << pb) - 1;
  const litPosMask = (1 << lp) - 1;

  let state = 0;
  let rep0 = 0;
  let rep1 = 0;
  let rep2 = 0;
  let rep3 = 0;

  while (outPos < outSize) {
    // Cheap periodic backstop against a malformed stream that never terminates.
    if ((++iter & 0xffff) === 0 && Date.now() - startedAt > DECODE_BUDGET_MS) {
      throw new Error('lzma: decode exceeded time budget');
    }
    const posState = outPos & posMask;
    if (rc.decodeBit(isMatch, (state << K_NUM_POS_BITS_MAX) + posState) === 0) {
      // Literal.
      const prevByte = outPos > 0 ? out[outPos - 1] : 0;
      const litState = ((outPos & litPosMask) << lc) + (prevByte >>> (8 - lc));
      const probsOffset = 0x300 * litState;
      let symbol = 1;
      if (state >= 7) {
        let matchByte = out[outPos - rep0 - 1];
        do {
          const matchBit = (matchByte >>> 7) & 1;
          matchByte = (matchByte << 1) & 0xff;
          const bit = rc.decodeBit(
            litProbs,
            probsOffset + ((1 + matchBit) << 8) + symbol
          );
          symbol = (symbol << 1) | bit;
          if (matchBit !== bit) break;
        } while (symbol < 0x100);
      }
      while (symbol < 0x100) {
        symbol = (symbol << 1) | rc.decodeBit(litProbs, probsOffset + symbol);
      }
      out[outPos++] = symbol & 0xff;
      state = state < 4 ? 0 : state < 10 ? state - 3 : state - 6;
      continue;
    }

    let len: number;
    if (rc.decodeBit(isRep, state) !== 0) {
      // Rep match.
      if (rc.decodeBit(isRepG0, state) === 0) {
        if (
          rc.decodeBit(isRep0Long, (state << K_NUM_POS_BITS_MAX) + posState) ===
          0
        ) {
          // Short rep: single byte copy of rep0.
          state = state < 7 ? 9 : 11;
          out[outPos] = out[outPos - rep0 - 1];
          outPos++;
          continue;
        }
      } else {
        let dist: number;
        if (rc.decodeBit(isRepG1, state) === 0) {
          dist = rep1;
        } else {
          if (rc.decodeBit(isRepG2, state) === 0) {
            dist = rep2;
          } else {
            dist = rep3;
            rep3 = rep2;
          }
          rep2 = rep1;
        }
        rep1 = rep0;
        rep0 = dist;
      }
      len = repLenDecoder.decode(rc, posState) + K_MATCH_MIN_LEN;
      state = state < 7 ? 8 : 11;
    } else {
      // New match.
      rep3 = rep2;
      rep2 = rep1;
      rep1 = rep0;
      len = lenDecoder.decode(rc, posState);
      state = state < 7 ? 7 : 10;

      const lenToPosState =
        len < K_NUM_LEN_TO_POS_STATES ? len : K_NUM_LEN_TO_POS_STATES - 1;
      const posSlot = bitTreeDecode(rc, posSlotDecoder, lenToPosState << 6, 6);
      if (posSlot < 4) {
        rep0 = posSlot;
      } else {
        const numDirectBits = (posSlot >> 1) - 1;
        // Multiplication (not <<) keeps values >2^31 positive.
        rep0 = (2 | (posSlot & 1)) * Math.pow(2, numDirectBits);
        if (posSlot < K_END_POS_MODEL_INDEX) {
          // The start index into the reverse bit-tree is `rep0 - posSlot - 1`.
          rep0 += bitTreeReverseDecode(
            rc,
            posDecoders,
            rep0 - posSlot - 1,
            numDirectBits
          );
        } else {
          rep0 +=
            rc.decodeDirectBits(numDirectBits - K_NUM_ALIGN_BITS) *
            Math.pow(2, K_NUM_ALIGN_BITS);
          rep0 += bitTreeReverseDecode(rc, alignDecoder, 0, K_NUM_ALIGN_BITS);
        }
      }
      len += K_MATCH_MIN_LEN;

      if (rep0 === 0xffffffff) {
        // End-of-stream marker.
        break;
      }
    }

    // Copy `len` bytes from the match distance.
    const srcStart = outPos - rep0 - 1;
    for (let i = 0; i < len && outPos < outSize; i++) {
      out[outPos] = out[srcStart + i];
      outPos++;
    }
  }

  if (outPos !== outSize) {
    throw new Error(`lzma: decoded ${outPos} bytes, expected ${outSize}`);
  }
  return out;
}
