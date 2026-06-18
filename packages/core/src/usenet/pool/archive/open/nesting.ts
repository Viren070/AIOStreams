import { createLogger } from '../../../../logging/logger.js';
import { detectFileType } from '../../file-type.js';
import { RandomAccess } from '../random-access.js';
import { ArchiveKind, groupVolumeSets } from '../archive-volume.js';
import { VolumeSet, Volume } from '../usenet-fs.js';
import { ArchiveEntry } from '../types.js';
import { ArchiveErrorCode } from '../errors.js';
import { entrySource } from './descriptor.js';

const logger = createLogger('usenet/archive');

/** Max archive nesting depth we descend (outer → one nested level). */
export const MAX_NEST_DEPTH = 1;

/** A nested archive volume set discovered among an archive's inner entries. */
export interface NestedGroup {
  kind: ArchiveKind;
  members: ArchiveEntry[];
  /** Whether every member is stored + unencrypted (so it can be opened). */
  allStored: boolean;
}

/**
 * Group an archive's inner entries into nested archive volume sets (one set per
 * kind; multiple distinct nested sets in a single archive is not a real-world
 * case). Members are returned in volume order.
 */
export function groupNestedArchives(entries: ArchiveEntry[]): NestedGroup[] {
  const refs = entries.map((e, i) => ({ index: i, filename: e.name }));
  return groupVolumeSets(refs).map((set) => {
    const memberEntries = set.members.map((m) => entries[m.index]);
    return {
      kind: set.kind,
      members: memberEntries,
      // Stored plaintext, or stored-but-AES (decryptable with the password),
      // and with a contiguous fragment map (an incomplete member would feed
      // the nested parse garbage).
      allStored: memberEntries.every(
        (e) =>
          e.stored && (!e.encrypted || !!e.aes || !!e.crypt) && !e.incomplete
      ),
    };
  });
}

/**
 * Build a {@link VolumeSet} over a nested archive's stored inner volumes. Each
 * inner volume is read through {@link entrySource} over the parent source
 * (decrypting AES store+encrypt volumes), so the nested archive is parsed as
 * its own (possibly multi-volume) archive without decompression.
 */
export function buildNestedVolumeSet(
  parent: RandomAccess,
  members: ArchiveEntry[],
  password: string
): VolumeSet {
  logger.debug(
    {
      volumes: members.length,
      encrypted: members.some((m) => !!m.aes),
      first: members[0]?.name,
      last: members[members.length - 1]?.name,
    },
    'opening nested archive volume set'
  );
  const volumes: Volume[] = members.map((m) => ({
    filename: m.name,
    knownSize: m.size,
    open: async () => entrySource(parent, m, password),
  }));
  return new VolumeSet(volumes);
}

/** Why an entry cannot be streamed, or undefined when it can. */
export function entryReason(e: ArchiveEntry): ArchiveErrorCode | undefined {
  // A fragment-map gap (volume missing/unparseable) trumps everything: the
  // bytes can't be assembled no matter how the entry is encoded.
  if (e.incomplete) return 'archive_incomplete';
  // Encrypted entries are streamable only when we can decrypt them: a 7z
  // store+encrypt AES region, or an encrypted stored RAR4/RAR5 entry (whose
  // crypt info survived the 16-alignment check). Otherwise it stays encrypted.
  if (e.encrypted && !e.aes && !e.crypt) return 'archive_encrypted';
  if (e.solid) return 'archive_solid';
  if (!e.stored) return 'archive_compressed';
  return undefined;
}

/** The largest video entry, if any. */
export function pickBestVideo(
  entries: ArchiveEntry[]
): ArchiveEntry | undefined {
  return entries
    .filter(
      (e) =>
        !e.isDir && detectFileType(Buffer.alloc(0), e.name).category === 'video'
    )
    .sort((a, b) => b.size - a.size)[0];
}
