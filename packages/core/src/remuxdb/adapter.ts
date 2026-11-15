import type { ParsedStream } from '../db/schemas.js';
import { unwrapProxyUrl } from '../proxy/token.js';
import type { MediaInfo } from '../utils/media-info.js';
import { NEWZNAB_INDEXERS } from '../presets/newznab.js';
import type { MediaInfoRecord, MediaTrack } from '../media-info/record.js';
import { toWireMediaInfo as recordToWire } from '../media-info/wire.js';
import type { MediaProbeVersion, ProbeSource, TrackDetail } from './client.js';

/**
 * Where a preset already names an indexer. `value` is the API URL.
 * `apiKeyUrl` is the page a user copies the key from. That page is not
 * always the info page: TorBox's is the account settings.
 */
export type RemuxDbHostSource = {
  value: string;
  apiKeyUrl?: string;
  remuxDbIndexer?: string;
  /**
   * An info-page host that is neither the API host nor that host with the
   * leading `api.` label removed. Leave unset for NZBgeek: `nzbgeek.info`
   * is already that label removed, and the profile URL confirms it.
   */
  remuxDbHosts?: readonly string[];
};

/** Lower-case, and drop one leading `www.`. */
function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '');
}

/** A preset URL or a bare hostname, reduced to the host we match on. */
function hostFrom(input: string): string {
  let hostname: string;
  try {
    hostname = (
      input.includes('://') ? new URL(input) : new URL(`https://${input}`)
    ).hostname;
  } catch {
    throw new Error(`RemuxDB host is not a URL or a hostname: ${input}`);
  }
  const host = normalizeHostname(hostname);
  if (!host) throw new Error(`RemuxDB host is empty: ${input}`);
  return host;
}

/**
 * Host to RemuxDB indexer id.
 *
 * Prowlarr and NZBHydra hand us the indexer's info page, not the API
 * download URL. NZBgeek's page is
 * `https://nzbgeek.info/geekseek.php?guid=<id>`: the host is `nzbgeek.info`,
 * and the preset's API host is `api.nzbgeek.info`. Mapping only the API host
 * makes that release look unknown, so it never matches and is never
 * contributed.
 *
 * The public host is registered only when the preset already says so twice:
 * the profile URL's host is the API host with the leading `api.` label
 * removed. That holds for NZBgeek, altHUB, NZB.life and NZBPlanet. It is not
 * a guess applied to every profile URL. TorBox's profile URL is the account
 * settings on `torbox.app`, not an info page, and a link on that host must
 * not name a release. SearchNZB has no RemuxDB id, so neither of its hosts
 * is claimed. A public host that fits neither fact goes in `remuxDbHosts`.
 *
 * One host claimed by two indexer ids is refused. Last-write-wins would file
 * the probe under whichever indexer was listed last, and a wrong contribution
 * is worse than no match. The same id on two hosts is fine: Anime Tosho's
 * two feeds are one indexer.
 */
export function remuxDbHostMap(
  indexers: readonly RemuxDbHostSource[]
): Record<string, string> {
  const map: Record<string, string> = {};
  const claim = (host: string, id: string) => {
    const existing = map[host];
    if (existing !== undefined && existing !== id) {
      throw new Error(
        `RemuxDB host ${host} is claimed by ${existing} and ${id}`
      );
    }
    map[host] = id;
  };
  for (const indexer of indexers) {
    const id = indexer.remuxDbIndexer;
    // No RemuxDB id means the hosts are not ours to claim, even when the
    // preset has a profile URL (SearchNZB).
    if (!id) continue;
    const apiHost = hostFrom(indexer.value);
    claim(apiHost, id);
    // Profile host, only when it confirms the `api.` label rather than
    // introducing a new site. See the comment above.
    const website = apiHost.startsWith('api.') ? apiHost.slice(4) : undefined;
    if (
      website &&
      indexer.apiKeyUrl &&
      hostFrom(indexer.apiKeyUrl) === website
    ) {
      claim(website, id);
    }
    for (const extra of indexer.remuxDbHosts ?? []) {
      if (extra) claim(hostFrom(extra), id);
    }
  }
  return map;
}

const KNOWN_INDEXER_HOSTNAMES = remuxDbHostMap(NEWZNAB_INDEXERS);

export function resolveRemuxDbIndexer(
  nzbUrl: string | undefined
): string | undefined {
  if (!nzbUrl) return undefined;
  try {
    const hostname = normalizeHostname(
      new URL(unwrapProxyUrl(nzbUrl)).hostname
    );
    return KNOWN_INDEXER_HOSTNAMES[hostname];
  } catch {
    return undefined;
  }
}

export function extractNzbGuid(nzbUrl: string | undefined): string | undefined {
  if (!nzbUrl) return undefined;
  const realUrl = unwrapProxyUrl(nzbUrl);
  try {
    const url = new URL(realUrl);
    // `id` is the Newznab release id (`t=get&id=`). Present means the URL
    // already named the release, even when the value is empty: falling
    // through to a path hash would name a different one, and the info URL
    // would never be tried. Next is the hex segment in a details path, which
    // is the info link Prowlarr's Newznab fixture uses
    // (`/details/<hex>#comments`). That wins over a `guid` query, so a query
    // cannot replace an id the path already named. `guid` is only the
    // leftover: NZBgeek's geekseek.php has no `id` and no hex in the path,
    // and puts the release id in `?guid=`.
    const id = url.searchParams.get('id');
    if (id !== null) return id;
    return (
      url.pathname.match(/\/([a-f0-9]{32,40})(?:[./]|$)/i)?.[1] ??
      url.searchParams.get('guid') ??
      undefined
    );
  } catch {
    // A bare guid is not a URL. Give it back. Matching still needs a
    // resolved indexer, so this string alone cannot name a release.
    return realUrl;
  }
}

/**
 * The indexer and guid RemuxDB uses for this release.
 *
 * The download URL is tried first: a direct Newznab link already carries
 * both. Prowlarr and NZBHydra point that link at themselves, so the
 * indexer's info URL is the fallback. The first URL that yields both wins,
 * and the guid is kept as the indexer wrote it. Folding case would disagree
 * with guids already stored from the same function.
 */
export function nzbIndexerGuid(
  nzbUrl: string | undefined,
  infoUrl: string | undefined
): { indexer: string; guid: string } | undefined {
  for (const url of [nzbUrl, infoUrl]) {
    const indexer = resolveRemuxDbIndexer(url);
    const guid = extractNzbGuid(url);
    if (indexer && guid) return { indexer, guid };
  }
  return undefined;
}

const baseName = (path: string | null | undefined) =>
  path?.split('/').pop()?.toLowerCase();

/** Filename goes before fileIdx, as RemuxDB can number a torrent's files differently. */
export function matchEntry(
  versions: MediaProbeVersion[],
  stream: ParsedStream
): MediaProbeVersion | undefined {
  const hash = stream.torrent?.infoHash?.toLowerCase();
  if (hash) {
    const inTorrent = (s: ProbeSource) =>
      s.torrent_info_hash?.toLowerCase() === hash;
    const candidates = versions.filter((v) => v.sources.some(inTorrent));
    const name = baseName(stream.filename);
    const fileIdx = stream.torrent?.fileIdx;
    const size = stream.size;
    const match =
      (name &&
        candidates.find((v) =>
          v.sources.some((s) => inTorrent(s) && baseName(s.filename) === name)
        )) ||
      (fileIdx !== undefined &&
        candidates.find((v) =>
          v.sources.some((s) => inTorrent(s) && s.torrent_file_idx === fileIdx)
        )) ||
      // No file index: the hash only counts if the sizes agree, ruling out packs.
      (fileIdx === undefined &&
        size &&
        candidates.find(
          (v) => v.size && Math.abs(v.size - size) <= size * 0.01
        ));
    if (match) return match;
  }

  const { indexer, guid } = nzbIndexerGuid(stream.nzbUrl, stream.infoUrl) ?? {};
  if (indexer && guid) {
    return versions.find((v) =>
      v.sources.some((s) => s.indexer === indexer && s.indexer_guid === guid)
    );
  }

  return undefined;
}

const nonNull = <T>(value: T | null | undefined): T | undefined =>
  value ?? undefined;

function fromTrack(t: TrackDetail): MediaTrack | undefined {
  const common = {
    index: t.idx,
    codec: nonNull(t.codec),
    profile: nonNull(t.profile),
    language: nonNull(t.language),
    title: nonNull(t.title),
    bitrate: nonNull(t.bit_rate),
    default: t.is_default,
    forced: t.is_forced,
    hearingImpaired: t.is_hearing_impaired,
  };
  switch (t.kind) {
    case 'video':
      return {
        ...common,
        type: 'video',
        width: nonNull(t.width),
        height: nonNull(t.height),
        fps: nonNull(t.fps),
        bitDepth: nonNull(t.bit_depth),
        pixelFormat: nonNull(t.pixel_format),
        colorPrimaries: nonNull(t.color_primaries),
        colorRange: nonNull(t.color_range),
        colorSpace: nonNull(t.color_space),
        colorTransfer: nonNull(t.color_transfer),
        aspectRatio: nonNull(t.aspect_ratio),
        level: nonNull(t.level),
        refFrames: nonNull(t.ref_frames),
        dvProfile: nonNull(t.dv_profile),
        hdr10Plus: t.hdr10_plus_present,
      };
    case 'audio':
      return {
        ...common,
        type: 'audio',
        channels: nonNull(t.channels),
        channelLayout: nonNull(t.channel_layout),
        sampleRate: nonNull(t.sample_rate),
      };
    case 'subtitle':
      return t.is_external ? undefined : { ...common, type: 'subtitle' };
    default:
      return undefined;
  }
}

export function fromRemuxDbVersion(entry: MediaProbeVersion): MediaInfoRecord {
  return {
    container: nonNull(entry.container),
    duration: nonNull(entry.duration),
    size: nonNull(entry.size),
    bitrate: nonNull(entry.bitrate),
    chapters: entry.has_chapters,
    tracks: entry.tracks
      .map(fromTrack)
      .filter((t): t is MediaTrack => t !== undefined),
  };
}

export function toWireMediaInfo(entry: MediaProbeVersion): MediaInfo {
  return recordToWire(fromRemuxDbVersion(entry));
}
