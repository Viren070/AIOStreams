import { RandomAccess } from '../random-access.js';
import {
  VolumeCtx,
  VolumeParse,
  VolumeBlock,
  ENDARC_SKIP_BYTES,
  MAX_BLOCKS_PER_VOLUME,
} from './types.js';
import { findSignature } from './scan.js';
import { parseRar5Block, blockKeyFromCrypt } from './rar5.js';
import { parseRar4Block } from './rar4.js';
import { RarEncryptedError } from '../crypto/rar-kdf.js';

/**
 * Walk one volume's block headers; returns its file blocks in order. Module
 * level (not a {@link RarReader} method) so the lazy fragment resolver can
 * read a single middle volume's continuation header at serve time through the
 * exact same code path the import parse used.
 *
 * Header-encrypted (`-hp`) archives announce themselves via a plaintext block
 * (reported as `headerCrypt`): RAR5 with a crypt header (htype 4) whose record
 * yields the volume's block key; RAR4 with the encrypted flag on the main
 * header (per-header salts; the parser derives a key per block). Every later
 * header is AES-CBC encrypted and decrypted inside the version's block parser.
 * The crypt state lives on `ctx` and is reset per walk (each volume re-states
 * its own encryption).
 */
export async function walkVolume(
  ra: RandomAccess,
  ctx: VolumeCtx,
  signal?: AbortSignal
): Promise<VolumeParse> {
  const sig = await findSignature(ra, ctx);
  if (!sig) {
    // Without the marker the volume's blocks (and any continuation passing
    // through it) cannot be located; this is a hole, not a silent skip.
    return { blocks: [], error: new Error('rar signature not found') };
  }
  const out: VolumeBlock[] = [];
  let version = sig.version;
  let abs = sig.dataStart;
  let guard = 0;
  let encrypted = false;
  // Each volume re-states its own encryption, so reset the crypt state per walk.
  ctx.blockKey = undefined;
  ctx.rar4Encrypted = undefined;
  ctx.rar4Verified = undefined;
  while (abs < ctx.range.end && guard++ < MAX_BLOCKS_PER_VOLUME) {
    if (signal?.aborted) throw new Error('parse aborted');
    // Tail-skip: at an inter-block boundary with only an endarc-sized
    // remainder left there is nothing useful to read.
    if (ctx.range.end - abs <= ENDARC_SKIP_BYTES) break;
    const res =
      version === 5
        ? await parseRar5Block(ra, ctx, abs)
        : await parseRar4Block(ra, ctx, abs);
    if (!res || res.next <= abs) break; // malformed / EOF
    // Headers are encrypted from here on. RAR5: derive the block key from the
    // crypt header's record (throws on missing/bad password). RAR4: per-header
    // salts, so only the password can be checked here; the parser derives a
    // key per block and CRC-checks the first decrypted header.
    if (res.kind === 'other' && res.headerCrypt) {
      if (res.headerCrypt.v === 5) {
        ctx.blockKey = blockKeyFromCrypt(res.headerCrypt.crypt, ctx.password);
      } else {
        if (!ctx.password) throw new RarEncryptedError();
        ctx.rar4Encrypted = true;
      }
      encrypted = true;
      abs = res.next;
      continue;
    }
    if (res.kind === 'file') {
      out.push({
        file: res.file,
        fragment: { offset: res.dataOff, length: res.file.packedSize },
      });
      // SPLIT_AFTER ⇒ the file's data runs to this volume's data end (it
      // continues in the next volume), so no further FILE block can follow
      // here; only service records (quick-open copies, recovery) and the
      // endarc, none of which we need. Stopping now avoids a cold tail
      // fetch per volume (a QO block sits past the 24-byte endarc window
      // on most WinRAR5 sets). Only valid in per-volume mode: in a joined
      // whole-stream range the continuation lives later in the SAME range.
      if (ctx.perVolume && !res.file.last) break;
      abs = res.next;
      continue;
    }
    abs = res.next;
    if (res.kind === 'end') {
      // End-of-volume record. In a per-volume range nothing meaningful
      // follows; in a joined raw-split (whole set = one range) the NEXT
      // volume's marker sits right here; rescan and keep walking so a
      // concatenated multi-volume archive parses end to end. Anything too
      // small to hold another volume's headers isn't worth a cold read.
      if (ctx.perVolume || ctx.range.end - abs < 512) break;
      const re = await findSignature(ra, {
        range: { start: abs, end: ctx.range.end },
        head:
          ctx.head && abs - ctx.range.start < ctx.head.length
            ? ctx.head.subarray(abs - ctx.range.start)
            : undefined,
        perVolume: ctx.perVolume,
      });
      if (!re) break;
      version = re.version;
      abs = re.dataStart;
    }
  }
  return { version, blocks: out, encrypted: encrypted || undefined };
}
