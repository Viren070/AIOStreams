import { config as appConfig } from '../../config/index.js';
import { createLogger } from '../../logging/logger.js';
import { isUnsafeRemoteUrl } from '../../utils/url-safety.js';
import type {
  Addon,
  Manifest,
  StrictManifestResource,
} from '../../db/schemas.js';
import {
  readWatchStateCapability,
  type PlaybackEventKind,
} from './capability.js';

const logger = createLogger('playback-handoff');

export interface ResolvedPlaybackSink {
  instanceId: string;
  name: string;
  /** Manifest URL minus `/manifest.json`. */
  baseUrl: string;
  /** Query string on the manifest URL, preserved like on other resources. */
  query: string;
  events: Set<PlaybackEventKind>;
  /** Whether this addon answers the pull half. */
  pullable: boolean;
  ttlSeconds?: number;
  types: string[];
  idPrefixes?: string[];
}

/** The parts of an engine context this needs, so it takes no engine type. */
export interface PlaybackSinkSource {
  addons: Addon[];
  manifests: Record<string, Manifest | null>;
  supportedResources: Record<string, StrictManifestResource[]>;
}

/** Where the addon's watch state is read from, query string preserved. */
export function pullUrlFor(sink: ResolvedPlaybackSink): string | null {
  if (!sink.pullable) return null;
  return `${sink.baseUrl}/watch_state/pull.json${sink.query}`;
}

/** Where one event is posted. Namespaced so a video id can never collide. */
export function pushUrlFor(
  sink: ResolvedPlaybackSink,
  type: string,
  videoId: string
): string {
  return `${sink.baseUrl}/watch_state/push/${type}/${encodeURIComponent(videoId)}.json${sink.query}`;
}

export function resolvePlaybackSinks(
  src: PlaybackSinkSource
): ResolvedPlaybackSink[] {
  const max = appConfig.watchState.maxSinks;
  if (max <= 0) return [];
  if (!appConfig.watchState.reportEnabled && !appConfig.watchState.pullEnabled)
    return [];

  const sinks: ResolvedPlaybackSink[] = [];
  for (const addon of src.addons) {
    if (sinks.length >= max) break;
    const instanceId = addon.instanceId;
    if (!instanceId || addon.enabled === false) continue;

    const capability = readWatchStateCapability(
      src.manifests[instanceId],
      src.supportedResources[instanceId]
    );
    if (!capability) continue;

    let manifestUrl: URL;
    try {
      manifestUrl = new URL(
        addon.manifestUrl.replace('stremio://', 'https://')
      );
    } catch {
      continue;
    }
    if (
      !appConfig.watchState.allowPrivateUrls &&
      isUnsafeRemoteUrl(manifestUrl.toString())
    ) {
      logger.debug(
        { addon: addon.name },
        'skipping watch-state exchange with a private address'
      );
      continue;
    }

    sinks.push({
      instanceId,
      name: addon.name,
      baseUrl: manifestUrl
        .toString()
        .split('?')[0]
        .split('/')
        .slice(0, -1)
        .join('/'),
      query: manifestUrl.search,
      events: capability.events,
      pullable: capability.pullable,
      ttlSeconds: capability.ttlSeconds,
      types: capability.types,
      idPrefixes: capability.idPrefixes,
    });
  }
  return sinks;
}
