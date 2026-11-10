import { storedMap } from '@/lib/storage';
import type { PlaybackInfoResponse, SourceInfo } from '@/lib/jellyfin/types';

/** The version each item last played in, which resuming it goes straight to. */
export const lastVersions = storedMap<string>(
  'aiostreams-web-last-versions',
  500
);

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
