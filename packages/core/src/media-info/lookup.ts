import type { ParsedStream, UserData } from '../db/schemas.js';
import {
  LOCAL_ORIGIN,
  MediaInfoRepository,
  type MediaInfoRow,
  type StoredFile,
} from '../db/repositories/media-info.js';
import { UsenetLibraryRepository } from '../db/repositories/usenet-library.js';
import type { DebridFile, TitleMetadata } from '../debrid/base.js';
import {
  featureFiles,
  isEpisodeWrong,
  isSeasonWrong,
  parseFileNames,
  selectFileInTorrentOrNZB,
  VIDEO_FILE_EXTENSIONS,
} from '../debrid/utils.js';
import { nzbContentKey } from '../release-blocklist/keys.js';
import type { StreamContext } from '../streams/context.js';
import { constants, createLogger, hasTrackLists } from '../utils/index.js';
import { applyMediaInfo } from './apply.js';
import { mediaInfoIdentity, type MediaInfoIdentity } from './identity.js';
import type { MediaInfoRecord, MediaTrack } from './record.js';
import { REMOTE_ORIGIN_PREFIX, remoteRows } from './remote.js';
import { noteLookup } from './activity.js';
import { torrentInventories } from './inventory.js';

export { mediaInfoIdentity, type MediaInfoIdentity } from './identity.js';

const logger = createLogger('media-info');

const baseName = (path: string | undefined) => path?.split('/').pop() ?? '';

/** The episode a request is for, as the resolver's file selection reads it. */
export async function requestTitleMetadata(
  context: StreamContext
): Promise<TitleMetadata> {
  const metadata = await context.getMetadata();
  return {
    titles: metadata?.titles?.map((t) => t.title) ?? [],
    year: metadata?.year,
    seasonYear: metadata?.seasonYear,
    country: metadata?.country,
    season: Number(context.parsedId?.season) || undefined,
    episode: Number(context.parsedId?.episode) || undefined,
    absoluteEpisode: metadata?.absoluteEpisode,
    relativeAbsoluteEpisode: metadata?.relativeAbsoluteEpisode,
    originalLanguage: metadata?.originalLanguage,
  };
}

/**
 * Our own probe first, then StremThru's, then RemuxDB's and what a store
 * reported.
 */
function originRank(row: StoredFile): number {
  if (row.origin === LOCAL_ORIGIN) return 0;
  const origin = row.origin.startsWith(REMOTE_ORIGIN_PREFIX)
    ? row.origin.slice(REMOTE_ORIGIN_PREFIX.length)
    : row.origin;
  return origin === 'remuxdb' || row.info?.reportedBy === 'rd' ? 2 : 1;
}

/** One row per file, the most trustworthy origin first. */
function byFile<T extends StoredFile>(rows: T[]): T[] {
  const files = new Map<string, T>();
  for (const row of rows) {
    const held = files.get(row.file);
    if (!held || originRank(row) < originRank(held)) files.set(row.file, row);
  }
  return [...files.values()];
}

function layout(record: MediaInfoRecord): string {
  return JSON.stringify(
    record.tracks.map((t: MediaTrack) => [
      t.type,
      t.codec,
      t.language,
      t.title,
      t.default,
      t.forced,
      t.hearingImpaired,
      t.commentary,
      t.type === 'audio' ? [t.channels, t.channelLayout] : undefined,
      t.type === 'video'
        ? [t.width, t.height, t.dvProfile, t.hdr10Plus, t.colorTransfer, t.hdr]
        : undefined,
    ])
  );
}

/** What every episode of a pack shares: its tracks, not its length or size. */
function tracksOnly(record: MediaInfoRecord): MediaInfoRecord {
  return {
    container: record.container,
    chapters: record.chapters,
    reportedBy: record.reportedBy,
    tracks: record.tracks.map(({ bitrate: _bitrate, ...track }) => track),
  };
}

function namedRow(
  names: (string | undefined)[],
  rows: StoredFile[],
  torrent: boolean
): StoredFile | undefined {
  for (const named of names) {
    if (!named) continue;
    const name = baseName(named);
    if (!name) continue;
    if (!torrent || name !== named) {
      const exact = rows.find((r) => r.file === named);
      if (exact) return exact;
    }
    const matches = rows.filter((r) => baseName(r.file) === name);
    if (!torrent && matches.length) return matches[0];
    if (matches.length === 1 && (name === named || matches[0].file === name)) {
      return matches[0];
    }
  }
  return undefined;
}

function videoExtension(name: string): string | undefined {
  const lower = name.toLowerCase();
  return VIDEO_FILE_EXTENSIONS.find((ext) => lower.endsWith(ext));
}

function torrentFileName(identity: MediaInfoIdentity): string | undefined {
  const { file, filename } = identity;
  const namesFile = (name: string) =>
    /[\/\\]/.test(name) || !!videoExtension(name);
  if (file) return file;
  return filename && namesFile(filename) ? filename : undefined;
}

function torrentFeatures(rows: StoredFile[]): StoredFile[] {
  return featureFiles(
    rows.map((row) => ({ name: baseName(row.file), size: row.size ?? 0, row }))
  ).map((f) => f.row);
}

function sizeMatches(identity: MediaInfoIdentity, file: StoredFile): boolean {
  return !(
    identity.videoSize !== undefined &&
    file.size &&
    file.size !== identity.videoSize
  );
}

function soleTorrentFile(
  identity: MediaInfoIdentity,
  rows: StoredFile[],
  reports: StoredFile[]
): StoredFile | undefined {
  const features = torrentFeatures(rows);
  const file = features[0];
  if (
    features.length !== 1 ||
    reports.some((r) => r.releaseFiles > 1) ||
    (identity.filename && identity.filename !== identity.title) ||
    !sizeMatches(identity, file)
  ) {
    return undefined;
  }
  return reports.some((r) => r.releaseFiles === 1) ? file : undefined;
}

function needsInventory(
  identity: MediaInfoIdentity,
  reports: StoredFile[]
): boolean {
  return (
    !!identity.releaseKeys[0]?.startsWith('btih:') &&
    !torrentFileName(identity) &&
    !((identity.fileIdx ?? -1) >= 0) &&
    (!identity.filename || identity.filename === identity.title) &&
    !reports.some((r) => r.releaseFiles > 1) &&
    reports.length > 0 &&
    torrentFeatures(byFile(reports)).length === 1
  );
}

/** A store's sole video, matched to the probe by its actual name and bytes. */
function inventoryFile(
  identity: MediaInfoIdentity,
  reports: StoredFile[],
  files: DebridFile[]
): StoredFile | undefined {
  if (files.length !== 1) return undefined;
  const [file] = files;
  if (
    !file.name ||
    !videoExtension(file.name) ||
    !Number.isSafeInteger(file.size) ||
    file.size <= 0
  )
    return undefined;
  const row = namedRow([file.path ?? file.name], byFile(reports), true);
  return row && row.size === file.size && sizeMatches(identity, row)
    ? row
    : undefined;
}

/** The file a stream plays, or a pack's files that may share one layout. */
type Pick = { file: StoredFile } | { siblings: StoredFile[] };

async function pickFile(
  identity: MediaInfoIdentity,
  reports: StoredFile[],
  metadata: () => Promise<TitleMetadata | undefined>,
  movie: boolean
): Promise<Pick | undefined> {
  const rows = byFile(reports);
  const torrent = rows[0].releaseKey.startsWith('btih:');
  const explicitFile = torrent ? torrentFileName(identity) : undefined;
  const indexed = torrent && (identity.fileIdx ?? -1) >= 0;
  let names = [identity.file, identity.filename];
  if (torrent) {
    // A repeated release label is not evidence of the requested file, even
    // when an older probe was stored under that same label.
    const displayName =
      !indexed && identity.filename !== identity.title
        ? identity.filename
        : undefined;
    names = [explicitFile ?? displayName];
  }
  const named = namedRow(names, rows, torrent);
  if (named) return { file: named };
  if (explicitFile || indexed) return undefined;
  const single = torrent
    ? soleTorrentFile(identity, rows, reports)
    : rows.find((r) => r.releaseFiles === 1);
  if (single) return { file: single };
  if (movie) return undefined;

  const episode = await metadata();
  if (!episode?.season || !episode.episode) return undefined;
  const features = featureFiles(
    rows.map((row, index) => ({
      name: baseName(row.file),
      size: row.size ?? 0,
      index,
    }))
  );
  if (features.length === 0) return undefined;

  const title = identity.title ?? '';
  const parsed = await parseFileNames([title, ...features.map((f) => f.name)]);
  const picked = await selectFileInTorrentOrNZB(
    { type: 'usenet', nzb: '', hash: '', title, size: 0 },
    { id: '', status: 'downloaded', files: features },
    parsed,
    episode
  );
  const pickedParse = picked?.name ? parsed.get(picked.name) : undefined;
  if (
    picked?.index !== undefined &&
    pickedParse?.episodes?.length &&
    !isEpisodeWrong(pickedParse, episode) &&
    !isSeasonWrong(pickedParse, episode)
  ) {
    return { file: rows[picked.index] };
  }
  return features.length >= 2
    ? { siblings: features.map((f) => rows[f.index]) }
    : undefined;
}

const fileId = (row: StoredFile) =>
  `${row.releaseKey}\0${row.file}\0${row.origin}`;

interface Found {
  record: MediaInfoRecord;
  origin: string;
}

/**
 * Records are read only for the files streams play: a pack has many files, a
 * stream one.
 */
async function findRecords(
  identities: MediaInfoIdentity[],
  metadata: () => Promise<TitleMetadata | undefined>,
  movie: boolean,
  userData?: UserData
): Promise<(Found | undefined)[]> {
  const aliases = await UsenetLibraryRepository.resolveAliases(
    identities.flatMap((i) => (i.nzbHash ? [i.nzbHash] : []))
  );
  const keys = identities.map((i) =>
    [
      ...i.releaseKeys,
      i.nzbHash ? nzbContentKey(aliases.get(i.nzbHash) ?? i.nzbHash) : null,
    ].filter((k): k is string => !!k)
  );
  const rowsByKey = new Map<string, StoredFile[]>();
  const add = (row: StoredFile) => {
    const list = rowsByKey.get(row.releaseKey) ?? [];
    list.push(row);
    rowsByKey.set(row.releaseKey, list);
  };
  for (const row of await MediaInfoRepository.getFilesByKeys(keys.flat())) {
    add(row);
  }
  const unknown = keys.filter((k) => !k.some((key) => rowsByKey.has(key)));
  for (const row of await remoteRows(unknown.flat())) add(row);

  const picks: (Pick | undefined)[] = [];
  for (const [index, identity] of identities.entries()) {
    const rows = keys[index].flatMap((k) => rowsByKey.get(k) ?? []);
    picks.push(
      rows.length ? await pickFile(identity, rows, metadata, movie) : undefined
    );
  }
  if (movie) {
    const pending = identities.filter(
      (identity, index) =>
        !picks[index] &&
        needsInventory(
          identity,
          keys[index].flatMap((k) => rowsByKey.get(k) ?? [])
        )
    );
    const inventories = await torrentInventories(pending, userData);
    for (const [index, identity] of identities.entries()) {
      const files = inventories.get(identity);
      if (!files) continue;
      const file = inventoryFile(
        identity,
        keys[index].flatMap((k) => rowsByKey.get(k) ?? []),
        files
      );
      if (file) picks[index] = { file };
    }
  }
  const wanted = picks.flatMap((pick) =>
    !pick ? [] : 'file' in pick ? [pick.file] : pick.siblings
  );
  const infos = await MediaInfoRepository.getInfos(
    wanted.filter((row) => !row.info)
  );
  const infoOf = (row: StoredFile) => row.info ?? infos.get(fileId(row));
  return picks.map((pick): Found | undefined => {
    if (!pick) return undefined;
    if ('file' in pick) {
      const record = infoOf(pick.file);
      return record && { record, origin: pick.file.origin };
    }
    const siblings = pick.siblings.map(infoOf);
    const first = siblings[0];
    if (!first || siblings.some((info) => !info)) return undefined;
    const shared = layout(first);
    return siblings.every((info) => layout(info!) === shared)
      ? { record: tracksOnly(first), origin: pick.siblings[0].origin }
      : undefined;
  });
}

/** Each listed post's probed files, by NZB content hash then file. */
export async function storedFilesByPost(
  contentHashes: string[]
): Promise<Map<string, Map<string, MediaInfoRecord>>> {
  const byKey = new Map<string, MediaInfoRow[]>();
  const keys = contentHashes.flatMap((h) => nzbContentKey(h) ?? []);
  for (const row of await MediaInfoRepository.getByKeys(keys)) {
    const list = byKey.get(row.releaseKey) ?? [];
    list.push(row);
    byKey.set(row.releaseKey, list);
  }
  const posts = new Map<string, Map<string, MediaInfoRecord>>();
  for (const [key, rows] of byKey) {
    posts.set(
      key.slice('nh1:'.length),
      new Map(byFile(rows).map((row) => [row.file, row.info]))
    );
  }
  return posts;
}

/** A library file's probe: archive members are stored by path, others by name. */
export function storedFileInfo(
  files: Map<string, MediaInfoRecord> | undefined,
  file: { name?: string; path?: string }
): MediaInfoRecord | undefined {
  if (!files) return undefined;
  return (
    (file.path ? files.get(file.path) : undefined) ??
    (file.name ? files.get(file.name) : undefined)
  );
}

export async function storedMediaInfoFor(
  identity: MediaInfoIdentity,
  metadata: TitleMetadata | undefined,
  movie: boolean,
  userData?: UserData
): Promise<MediaInfoRecord | undefined> {
  const [found] = await findRecords(
    [identity],
    async () => metadata,
    movie,
    userData
  );
  return found?.record;
}

export async function resolveStoredMediaInfo(
  streams: ParsedStream[],
  context: StreamContext,
  userData?: UserData
): Promise<void> {
  const eligible: [ParsedStream, MediaInfoIdentity][] = [];
  for (const stream of streams) {
    if (hasTrackLists(stream.parsedFile)) continue;
    const identity = mediaInfoIdentity(stream);
    if (identity) eligible.push([stream, identity]);
  }
  if (eligible.length === 0) return;
  try {
    let metadata: Promise<TitleMetadata | undefined> | undefined;
    const found = await findRecords(
      eligible.map(([, identity]) => identity),
      () => (metadata ??= requestTitleMetadata(context)),
      context.type === constants.MOVIE_TYPE,
      userData
    );
    const filledFrom: string[] = [];
    for (const [index, [stream]] of eligible.entries()) {
      const hit = found[index];
      if (!hit) continue;
      applyMediaInfo(stream, hit.record);
      filledFrom.push(hit.origin);
    }
    noteLookup(eligible.length, filledFrom);
    logger.debug(
      { matched: filledFrom.length, eligible: eligible.length },
      'filled streams from stored media info'
    );
  } catch (err) {
    logger.debug(
      { err: (err as Error)?.message },
      'stored media info lookup failed'
    );
  }
}
