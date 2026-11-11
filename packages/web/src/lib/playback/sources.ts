import { storedMap } from '@/lib/storage';
import type { PlaybackInfoResponse, SourceInfo } from '@/lib/jellyfin/types';

export interface LastVersion {
  id: string;
  release?: string;
  service?: string;
}

const stored = storedMap<LastVersion | string>(
  'aiostreams-web-last-versions',
  500
);

/** The version each item last played in, which resuming it goes straight to. */
export const lastVersions = {
  get(itemId: string): LastVersion | undefined {
    const last = stored.get(itemId);
    return typeof last === 'string' ? { id: last } : last;
  },
  set: (itemId: string, last: LastVersion | undefined) =>
    stored.set(itemId, last),
};

export const lastVersionOf = (source: SourceInfo): LastVersion => ({
  id: source.Id!,
  release: source.aiostreams?.release,
  service: source.aiostreams?.service,
});

export function findVersion(
  sources: SourceInfo[],
  last: LastVersion | undefined
): SourceInfo | undefined {
  if (!last) return undefined;
  return (
    sources.find((s) => s.Id === last.id) ??
    (last.release
      ? sources.find(
          (s) =>
            s.aiostreams?.release === last.release &&
            s.aiostreams?.service === last.service
        )
      : undefined)
  );
}

/** Notices from addons carry text only. */
export function isNotice(source: SourceInfo): boolean {
  return source.Type === 'Placeholder';
}

export function playableSources(
  info: PlaybackInfoResponse | undefined
): SourceInfo[] {
  return ((info?.MediaSources ?? []) as SourceInfo[]).filter(
    (s) => !isNotice(s)
  );
}

/** Notices by the version each came after, `null` for those before them all. */
export function placedNotices(
  info: PlaybackInfoResponse | undefined,
  versions: SourceInfo[]
): Map<SourceInfo | null, SourceInfo[]> {
  const placed = new Map<SourceInfo | null, SourceInfo[]>();
  for (const notice of (info?.MediaSources ?? []) as SourceInfo[]) {
    if (!isNotice(notice)) continue;
    const at = notice.aiostreams?.index ?? Infinity;
    const after =
      versions.filter((v) => (v.aiostreams?.index ?? -Infinity) < at).pop() ??
      null;
    placed.set(after, [...(placed.get(after) ?? []), notice]);
  }
  return placed;
}
