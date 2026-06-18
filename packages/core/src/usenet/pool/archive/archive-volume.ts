/**
 * Multi-volume archive grouping: volume-numbering logic so a RAR/7z set spread
 * across many NZB files is opened in the correct order.
 */

// `.part01.rar` style.
const RAR_PART = /\.part(\d+)\.rar$/i;
// `.r00`, `.r01` ... (`.rar` is volume 0, `.r00` is volume 1, etc.)
const RAR_RNN = /\.r(\d+)$/i;
const RAR_FIRST = /\.rar$/i;

// `.7z.001`, `.7z.002` ...
const SEVENZIP_PART = /\.7z\.(\d+)$/i;
const SEVENZIP_FIRST = /\.7z$/i;

/** Volume index for a RAR member, or -1 if the name is not part of a RAR set. */
export function rarVolumeNumber(filename: string): number {
  let m = filename.match(RAR_PART);
  if (m) return parseInt(m[1], 10);
  m = filename.match(RAR_RNN);
  if (m) return parseInt(m[1], 10) + 1;
  if (RAR_FIRST.test(filename)) return 0;
  return -1;
}

/** Volume index for a 7z member, or -1 if not part of a 7z set. */
export function sevenZipVolumeNumber(filename: string): number {
  const m = filename.match(SEVENZIP_PART);
  if (m) return parseInt(m[1], 10);
  if (SEVENZIP_FIRST.test(filename)) return 0;
  return -1;
}

export type ArchiveKind = 'rar' | '7z';

export interface VolumeMember {
  /** Index of the file within the NZB. */
  index: number;
  filename: string;
  /** Volume ordinal (0-based) within the set. */
  volume: number;
  /** Segment count of the backing NZB file (for duplicate resolution). */
  segments?: number;
  /** `number=` of the file's first segment (1 for a complete post). */
  firstSegmentNumber?: number;
}

/**
 * Group NZB files into an ordered volume set for the given archive kind. Returns
 * members sorted by volume ordinal. Empty when no member matches.
 */
export function groupVolumes(
  files: Array<{ index: number; filename?: string }>,
  kind: ArchiveKind
): VolumeMember[] {
  const numberer = kind === 'rar' ? rarVolumeNumber : sevenZipVolumeNumber;
  const members: VolumeMember[] = [];
  for (const f of files) {
    if (!f.filename) continue;
    const volume = numberer(f.filename);
    if (volume < 0) continue;
    members.push({ index: f.index, filename: f.filename, volume });
  }
  members.sort(
    (a, b) => a.volume - b.volume || a.filename.localeCompare(b.filename)
  );
  return members;
}

/** Detect the archive kind of a filename, if any. */
export function archiveKindOf(filename?: string): ArchiveKind | undefined {
  if (!filename) return undefined;
  if (rarVolumeNumber(filename) >= 0) return 'rar';
  if (sevenZipVolumeNumber(filename) >= 0) return '7z';
  return undefined;
}

/**
 * Strip a filename's volume suffix to get the archive set's base name + kind.
 * Distinct base names are distinct archives that must NOT be merged: one
 * container can hold several (e.g. a season-pack 7z with one nested RAR per
 * episode). Returns undefined for non-archive filenames.
 */
export function archiveBaseName(
  filename: string
): { base: string; kind: ArchiveKind } | undefined {
  const cut = (re: RegExp, kind: ArchiveKind) => {
    const m = filename.match(re);
    return m
      ? { base: filename.slice(0, filename.length - m[0].length), kind }
      : undefined;
  };
  return (
    cut(RAR_PART, 'rar') ??
    cut(RAR_RNN, 'rar') ??
    cut(RAR_FIRST, 'rar') ??
    cut(SEVENZIP_PART, '7z') ??
    cut(SEVENZIP_FIRST, '7z')
  );
}

export interface VolumeSetGroup {
  kind: ArchiveKind;
  baseName: string;
  members: VolumeMember[];
}

export interface NumericSplitGroup {
  /** Filename with the numeric suffix stripped (e.g. `Movie.mkv`). */
  baseName: string;
  members: VolumeMember[];
}

// `<base>.001`, `<base>.002`, ... are raw splits of ONE byte stream (HJSplit-style
// or `.mkv.NNN` posts). NOT an archive volume scheme; the chunks carry no
// per-part structure, so the set is meaningful only as a plain concatenation.
const NUMERIC_SPLIT = /^(.+)\.(\d{2,4})$/;

/**
 * Group raw numeric-split files (`x.001..x.NNN`) into ordered join sets: ≥3
 * members with consecutive ordinals under one base name. Filenames that match
 * a real archive volume scheme (`.partNN.rar`, `.rNN`, `.7z.NNN`, ...) or PAR2
 * are excluded, since those carry per-volume structure and are handled as archives.
 * What a join set's bytes ARE (one video, one big RAR, ...) is decided by the
 * caller from the first member's magic.
 */
export function groupNumericSplitSets(
  files: Array<{ index: number; filename?: string }>
): NumericSplitGroup[] {
  const map = new Map<string, VolumeMember[]>();
  for (const f of files) {
    if (!f.filename) continue;
    if (archiveBaseName(f.filename)) continue;
    if (/\.par2$/i.test(f.filename)) continue;
    const m = f.filename.match(NUMERIC_SPLIT);
    if (!m) continue;
    const volume = parseInt(m[2], 10);
    let members = map.get(m[1]);
    if (!members) {
      members = [];
      map.set(m[1], members);
    }
    members.push({ index: f.index, filename: f.filename, volume });
  }
  const out: NumericSplitGroup[] = [];
  for (const [baseName, members] of map) {
    if (members.length < 3) continue;
    members.sort((a, b) => a.volume - b.volume);
    // Require strictly consecutive ordinals (from 0 or 1): gaps or duplicates
    // mean the names only look like a split, so joining them would corrupt.
    const start = members[0].volume;
    if (start > 1) continue;
    const consecutive = members.every((m, i) => m.volume === start + i);
    if (!consecutive) continue;
    out.push({ baseName, members });
  }
  return out;
}

/**
 * Group files into one ordered volume set **per distinct archive base name**
 * (unlike {@link groupVolumes}, which lumps every file of a kind together). Each
 * set's members are sorted by volume ordinal.
 */
export function groupVolumeSets(
  files: Array<{
    index: number;
    filename?: string;
    segments?: number;
    firstSegmentNumber?: number;
  }>
): VolumeSetGroup[] {
  const map = new Map<string, VolumeSetGroup>();
  for (const f of files) {
    if (!f.filename) continue;
    const b = archiveBaseName(f.filename);
    if (!b) continue;
    const volume =
      b.kind === 'rar'
        ? rarVolumeNumber(f.filename)
        : sevenZipVolumeNumber(f.filename);
    if (volume < 0) continue;
    const key = `${b.base}\0${b.kind}`;
    let g = map.get(key);
    if (!g) {
      g = { kind: b.kind, baseName: b.base, members: [] };
      map.set(key, g);
    }
    g.members.push({
      index: f.index,
      filename: f.filename,
      volume,
      segments: f.segments,
      firstSegmentNumber: f.firstSegmentNumber,
    });
  }
  for (const g of map.values()) {
    g.members.sort(
      (a, b) => a.volume - b.volume || a.filename.localeCompare(b.filename)
    );
    // Collapse reposted/fill duplicates of the same volume ordinal: a fill post
    // (carrying only originally-missing segments) or a full re-post both wedge
    // extra bytes or headers into the concatenation and corrupt the set. Keep
    // the most complete candidate per ordinal (needs caller-provided segment
    // info); ties keep the first by name.
    g.members = dedupeVolumeMembers(g.members);
  }
  return [...map.values()];
}

/** Pick the most complete candidate per volume ordinal (see groupVolumeSets). */
function dedupeVolumeMembers(members: VolumeMember[]): VolumeMember[] {
  const out: VolumeMember[] = [];
  const better = (a: VolumeMember, b: VolumeMember): boolean => {
    const aFirst = a.firstSegmentNumber === 1 ? 1 : 0;
    const bFirst = b.firstSegmentNumber === 1 ? 1 : 0;
    if (aFirst !== bFirst) return aFirst > bFirst;
    return (a.segments ?? 0) > (b.segments ?? 0);
  };
  for (const m of members) {
    const prev = out[out.length - 1];
    if (prev && prev.volume === m.volume) {
      if (better(m, prev)) out[out.length - 1] = m;
      continue;
    }
    out.push(m);
  }
  return out;
}
