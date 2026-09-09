import {
  WATCH_STATE_MANIFEST_KEY,
  WATCH_STATE_RESOURCE,
} from '../../utils/constants.js';
import {
  WatchStateCapabilitySchema,
  type Manifest,
  type StrictManifestResource,
} from '../../db/schemas.js';

/** Unpausing is another `start`, so there is no `unpause`. */
export const SENDABLE_EVENTS = [
  'start',
  'pause',
  'stop',
  'played',
  'unplayed',
] as const;

export type PlaybackEventKind = (typeof SENDABLE_EVENTS)[number];

export interface WatchStateCapabilityInfo {
  version: number;
  /** Empty when the addon declares no `push` half. */
  events: Set<PlaybackEventKind>;
  /** Whether the addon answers the `pull` half. */
  pullable: boolean;
  /** How long its answer may be reused before asking again. */
  ttlSeconds?: number;
  types: string[];
  idPrefixes?: string[];
}

function isSendable(value: string): value is PlaybackEventKind {
  return (SENDABLE_EVENTS as readonly string[]).includes(value);
}

/** Declaring the resource is the opt-in. The v1 root `events` still parses. */
export function readWatchStateCapability(
  manifest: Manifest | null | undefined,
  resources: StrictManifestResource[] | undefined
): WatchStateCapabilityInfo | null {
  if (!manifest) return null;
  const entry = resources?.find((r) => r.name === WATCH_STATE_RESOURCE);
  if (!entry) return null;

  const parsed = WatchStateCapabilitySchema.safeParse(
    (manifest as Record<string, unknown>)[WATCH_STATE_MANIFEST_KEY]
  );
  const block = parsed.success ? parsed.data : undefined;

  const declared = block?.push?.events ?? block?.events;
  const events = new Set<PlaybackEventKind>(
    declared?.length ? declared.filter(isSendable) : SENDABLE_EVENTS
  );

  const pull = block?.pull;
  const pullable = !!pull && (pull.items !== false || pull.watched !== false);

  if (!events.size && !pullable) return null;

  return {
    version: block?.version ?? 1,
    events,
    pullable,
    ttlSeconds: pull?.ttlSeconds,
    types: entry.types ?? [],
    idPrefixes: entry.idPrefixes?.length ? entry.idPrefixes : undefined,
  };
}
