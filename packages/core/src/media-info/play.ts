import { createHash } from 'node:crypto';
import { appConfig, constants, createLogger } from '../utils/index.js';
import type { FileInfo, TitleMetadata } from '../debrid/base.js';
import {
  featureFiles,
  metadataStore,
  parsePlaybackUrl,
  type PlaybackTarget,
} from '../debrid/utils.js';
import { UsenetLibraryRepository } from '../db/repositories/usenet-library.js';
import type {
  ProbeKind,
  ProbePath,
} from '../db/repositories/media-info-probes.js';
import {
  decodeFileInfo,
  decodeStoreAuth,
  isOwnHostRedirect,
  resolveExternalTarget,
  resolvePlaybackTarget,
} from '../main/failover.js';
import { unwrapProxyUrl } from '../proxy/token.js';
import {
  nzbContentKey,
  releaseKeyKind,
  torrentKey,
} from '../release-blocklist/keys.js';
import {
  contribute,
  type ContributedSource,
  type ContributionIds,
} from './contribute.js';
import {
  decodeUsenetStreamUrl,
  type UsenetStreamToken,
} from '../usenet/integration/tokens.js';
import type { ParsedStream } from '../db/schemas.js';
import {
  mediaInfoIdentity,
  nzbUrlKey,
  type MediaInfoIdentity,
} from './identity.js';
import { mediaInfoProber } from './probe.js';
import { engineReader, httpReader } from './readers.js';
import { isSharedKey } from './remote.js';
import type { MediaInfoRecord } from './record.js';

const logger = createLogger('media-info');

export function probesOn(path: ProbePath): boolean {
  const { probe, probeOn } = appConfig.mediaInfo;
  return probe && probeOn.includes(path);
}

const md5 = (value: string) => createHash('md5').update(value).digest('hex');

function within<T>(work: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), Math.max(ms, 0));
    const done = (value: T | undefined) => {
      clearTimeout(timer);
      resolve(value);
    };
    work.then(done, () => done(undefined));
  });
}

function idsOf(metadata: TitleMetadata | undefined): ContributionIds {
  return {
    imdbId: metadata?.imdbId ?? undefined,
    tmdbId: metadata?.tmdbId ?? undefined,
    tvdbId: metadata?.tvdbId ?? undefined,
    season: metadata?.season,
    episode: metadata?.episode,
  };
}

/** Keys a usenet release is known by besides its content hash. */
function usenetKeys(releaseKey?: string, nzbUrl?: string): string[] {
  const keys: string[] = [];
  if (releaseKey && releaseKeyKind(releaseKey) === 'usenet') {
    keys.push(releaseKey);
  }
  const urlKey = nzbUrlKey(nzbUrl);
  if (urlKey) keys.push(urlKey);
  return keys;
}

/** Probe a usenet file through our engine; returns the key to wait on. */
export async function queueEngineProbe(
  decoded: UsenetStreamToken,
  path: ProbePath
): Promise<string | undefined> {
  const exact = nzbContentKey(decoded.hash);
  const file = decoded.innerPath ?? decoded.filename;
  if (!exact || !file) return undefined;
  const entry = await UsenetLibraryRepository.get(decoded.hash).catch(
    () => undefined
  );
  return mediaInfoProber.queue({
    releaseKeys: [exact, ...usenetKeys(decoded.releaseKey, decoded.nzb)],
    file,
    // Unknown counts as a pack, which never stands in for every request.
    releaseFiles: entry ? featureFiles(entry.files).length : 0,
    title: entry?.name,
    path,
    kind: 'usenet',
    reader: 'engine',
    onStored: async (record) =>
      contribute({
        source: { kind: 'nzb', nzbUrl: decoded.nzb },
        file: decoded.filename ?? file,
        record,
        imdbId: decoded.imdbId,
        tmdbId: decoded.tmdbId,
        tvdbId: decoded.tvdbId,
        season: decoded.season,
        episode: decoded.episode,
      }),
    open: () => engineReader(decoded),
  });
}

interface RemoteProbe {
  /** What to read: a debrid link or a proxy URL in front of one. */
  url: string;
  headers?: Record<string, string>;
  releaseKeys: string[];
  kind: ProbeKind;
  /** The file, when known before reading; else the response names it. */
  file?: string;
  title?: string;
  /** Stands in for the file while it is unknown, so a replay is not re-read. */
  pendingName: string;
  path: ProbePath;
  source?: ContributedSource;
  ids?: ContributionIds;
  /** Someone waits on the result, so it is worth reading without a key. */
  waited?: boolean;
}

function queueRemoteProbe(probe: RemoteProbe): string | undefined {
  const [releaseKey] = probe.releaseKeys;
  if (!releaseKey && !probe.waited) return undefined;
  return mediaInfoProber.queue({
    releaseKeys: probe.releaseKeys,
    file: probe.file,
    releaseFiles: 0,
    title: probe.title,
    path: probe.path,
    kind: probe.kind,
    reader: 'http',
    dedupeKey: `${releaseKey ?? 'url'}:~${probe.pendingName}`,
    onStored: async (record, file) => {
      if (probe.source) {
        contribute({ source: probe.source, file, record, ...probe.ids });
      }
    },
    open: (signal) => httpReader(probe.url, signal, probe.headers),
  });
}

/** A debrid file of ours: its keys come from the playback URL's file info. */
function queueDebridProbe(input: {
  url: string;
  fileInfo: FileInfo;
  filename: string;
  path: ProbePath;
  ids?: ContributionIds;
  waited?: boolean;
}): string | undefined {
  const { fileInfo } = input;
  // The playback URL only names the file when the listing picked one.
  const file =
    fileInfo.index !== undefined && fileInfo.index >= 0
      ? input.filename
      : undefined;
  if (fileInfo.type === 'usenet') {
    return queueRemoteProbe({
      url: input.url,
      releaseKeys: usenetKeys(fileInfo.releaseKey, fileInfo.nzb),
      kind: 'usenet',
      file,
      title: fileInfo.title,
      pendingName: input.filename,
      path: input.path,
      source: fileInfo.nzb ? { kind: 'nzb', nzbUrl: fileInfo.nzb } : undefined,
      ids: input.ids,
      waited: input.waited,
    });
  }
  const key = torrentKey(fileInfo.hash);
  return queueRemoteProbe({
    url: input.url,
    releaseKeys: key ? [key] : [],
    kind: 'torrent',
    file,
    title: fileInfo.title,
    pendingName: input.filename,
    path: input.path,
    source: key ? { kind: 'torrent', infoHash: fileInfo.hash } : undefined,
    ids: input.ids,
    waited: input.waited,
  });
}

export interface PlaybackPlay {
  path: ProbePath;
  target: PlaybackTarget;
  resolvedUrl: string;
  viaProxy: boolean;
}

/**
 * A debrid file is read only where that adds no IP to the account. TorBox
 * torrents are left to StremThru, which probes every link it generates.
 */
export async function onPlay(play: PlaybackPlay): Promise<void> {
  if (!probesOn(play.path)) return;
  try {
    const token = decodeUsenetStreamUrl(play.resolvedUrl);
    if (token) {
      await queueEngineProbe(token, play.path);
      return;
    }
    const fileInfo = await decodeFileInfo(play.target.fileInfoRaw);
    const service = decodeStoreAuth(play.target)?.id;
    if (!fileInfo || !service) return;
    const torbox = service === constants.TORBOX_SERVICE;
    if (torbox && fileInfo.type === 'torrent') return;
    if (!play.viaProxy && !(torbox && fileInfo.type === 'usenet')) return;
    // Here it is a TorBox usenet file, or a debrid file our proxy reads.
    const metadata = await metadataStore()
      .get(play.target.metadataId)
      .catch(() => undefined);
    queueDebridProbe({
      url: play.resolvedUrl,
      fileInfo,
      filename: play.target.filename,
      path: play.path,
      ids: idsOf(metadata),
    });
  } catch (err) {
    logger.debug(
      { err: (err as Error)?.message },
      'could not queue a probe for a play'
    );
  }
}

/**
 * A preload pinged an external addon's URL and saw where it redirects. A
 * TorBox link is safe to read, and these never pass through StremThru.
 */
export function onPreloadRedirect(
  path: ProbePath,
  stream: ParsedStream,
  location: string,
  ids?: ContributionIds
): void {
  if (!probesOn(path) || stream.service?.id !== constants.TORBOX_SERVICE) {
    return;
  }
  if (!stream.url || isOwnHostRedirect(stream.url, location)) return;
  const identity = mediaInfoIdentity(stream);
  const infoHash = identity?.releaseKeys
    .find((k) => k.startsWith('btih:'))
    ?.slice('btih:'.length);
  if (!identity || !infoHash) return;
  queueRemoteProbe({
    url: location,
    releaseKeys: identity.releaseKeys,
    kind: 'torrent',
    file: identity.file,
    title: identity.title,
    pendingName: identity.filename ?? '',
    path,
    source: { kind: 'torrent', infoHash },
    ids,
  });
}

// Players ask for a file's start more than once per play.
const proxiedPlays = new Map<string, number>();
const PROXIED_PLAY_MS = 10 * 60 * 1000;

/** Our proxy served the start of another addon's file. */
export function onProxiedPlay(play: {
  path: ProbePath;
  /** The file's URL once the proxy followed its redirects. */
  url: string;
  /** The URL the proxy was asked for. */
  from: string;
  headers?: Record<string, string>;
  mediaInfo: { keys: string[]; file?: string };
  filename?: string;
}): void {
  if (!probesOn(play.path)) return;
  if (play.url !== play.from && isOwnHostRedirect(play.from, play.url)) return;
  const releaseKeys = play.mediaInfo.keys.filter(isSharedKey);
  const [first] = releaseKeys;
  if (!first) return;
  const id = `${first}:${play.mediaInfo.file ?? play.url}`;
  const now = Date.now();
  if ((proxiedPlays.get(id) ?? 0) > now) return;
  if (proxiedPlays.size >= 1_000) proxiedPlays.clear();
  proxiedPlays.set(id, now + PROXIED_PLAY_MS);
  queueRemoteProbe({
    url: play.url,
    headers: play.headers,
    releaseKeys,
    kind: first.startsWith('btih:') ? 'torrent' : 'usenet',
    file: play.mediaInfo.file,
    pendingName: play.mediaInfo.file ?? play.filename ?? '',
    path: play.path,
  });
}

/** What the Jellyfin path knows of a version before its play. */
export interface PrePlayVersion {
  url: string;
  mediaInfo?: MediaInfoIdentity;
  service?: string;
  proxied?: boolean;
}

async function queuePrePlay(
  version: PrePlayVersion,
  clientIp: string | undefined,
  remaining: () => number,
  ids: ContributionIds | undefined
): Promise<string | undefined> {
  const owned = parsePlaybackUrl(unwrapProxyUrl(version.url));
  if (owned) {
    const storeAuth = decodeStoreAuth(owned);
    const fileInfo = await decodeFileInfo(owned.fileInfoRaw);
    if (!storeAuth || !fileInfo) return undefined;
    if (storeAuth.id === constants.AIOSTREAMS_SERVICE) {
      const resolved = await within(
        resolvePlaybackTarget(owned, { clientIp }),
        remaining()
      );
      const token = resolved ? decodeUsenetStreamUrl(resolved) : undefined;
      return token ? queueEngineProbe(token, 'jellyfin') : undefined;
    }
    // Our proxy reads from this server, so a link resolved here is the same IP.
    const viaOurProxy =
      !!version.proxied && version.url !== unwrapProxyUrl(version.url);
    if (!viaOurProxy && storeAuth.id !== constants.TORBOX_SERVICE) {
      return undefined;
    }
    const resolved = await within(
      resolvePlaybackTarget(owned, {
        clientIp: viaOurProxy ? undefined : clientIp,
      }),
      remaining()
    );
    return resolved
      ? queueDebridProbe({
          url: resolved,
          fileInfo,
          filename: owned.filename,
          path: 'jellyfin',
          ids,
          waited: true,
        })
      : undefined;
  }

  const identity = version.mediaInfo;
  const releaseKeys = identity?.releaseKeys ?? [];
  const infoHash = releaseKeys
    .find((k) => k.startsWith('btih:'))
    ?.slice('btih:'.length);
  const remote = (url: string) =>
    queueRemoteProbe({
      url,
      releaseKeys,
      kind: infoHash ? 'torrent' : 'usenet',
      file: identity?.file,
      title: identity?.title,
      pendingName: identity ? (identity.filename ?? '') : md5(version.url),
      path: 'jellyfin',
      source: infoHash ? { kind: 'torrent', infoHash } : undefined,
      ids,
      waited: true,
    });
  // An external proxy's IP is the one the player reads through too.
  if (version.proxied) return remote(version.url);
  if (version.service === constants.TORBOX_SERVICE && infoHash) {
    const resolved = await within(
      resolveExternalTarget(version.url, { clientIp }),
      remaining()
    );
    return resolved ? remote(resolved) : undefined;
  }
  return undefined;
}

/**
 * Read a version's file now when that is safe. Returns nothing when it was
 * skipped, failed, or read too recently to read again.
 */
export async function probeBeforePlay(
  version: PrePlayVersion,
  opts: { timeoutMs: number; clientIp?: string; ids?: ContributionIds }
): Promise<MediaInfoRecord | undefined> {
  if (!probesOn('jellyfin') || opts.timeoutMs <= 0) return undefined;
  const deadline = Date.now() + opts.timeoutMs;
  const remaining = () => deadline - Date.now();
  try {
    const key = await queuePrePlay(version, opts.clientIp, remaining, opts.ids);
    return key ? await mediaInfoProber.waitFor(key, remaining()) : undefined;
  } catch (err) {
    logger.debug(
      { err: (err as Error)?.message },
      'could not probe a version before its play'
    );
    return undefined;
  }
}

export function idsFromVideoId(videoId: string): ContributionIds {
  const [id, season, episode] = videoId.split(':');
  if (!/^tt\d+$/.test(id ?? '')) return {};
  return {
    imdbId: id,
    season: season ? Number(season) : undefined,
    episode: episode ? Number(episode) : undefined,
  };
}
