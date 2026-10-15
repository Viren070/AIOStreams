import { episodeCode, ticksToMs } from '../format';
import type { BaseItemDto, SourceInfo } from '../types';

/** What a party plays, as its members read it: sealed, so the relay never does. */
export interface PartyItem {
  /** The item's id on the starter's server; most ids name the same title on any. */
  id: string;
  /** Another id for it that every server resolves, where `id` is only the starter's. */
  sharedId?: string;
  type: string;
  name: string;
  year?: number;
  seriesName?: string;
  season?: number;
  episode?: number;
  runtimeMs?: number;
  /** The starter's version, which members play too where they have it. */
  version?: {
    filename?: string;
    size?: number;
    releaseGroup?: string;
    resolution?: string;
  };
}

export function partyItem(
  item: BaseItemDto,
  source?: SourceInfo | null
): PartyItem {
  const extension = source?.aiostreams;
  const runtime = source?.RunTimeTicks ?? item.RunTimeTicks;
  return {
    id: item.Id!,
    sharedId: (item as { aiostreams?: { sharedId?: string } }).aiostreams
      ?.sharedId,
    type: item.Type ?? 'Movie',
    name: item.Name ?? '',
    year: item.ProductionYear ?? undefined,
    seriesName: item.SeriesName ?? undefined,
    season: item.ParentIndexNumber ?? undefined,
    episode: item.IndexNumber ?? undefined,
    runtimeMs: runtime ? ticksToMs(runtime) : undefined,
    version: extension && {
      filename: extension.filename,
      size: extension.size,
      releaseGroup: extension.releaseGroup,
      resolution: extension.resolution,
    },
  };
}

/** The member's own version closest to the one the party started with. */
export function matchingVersion(
  sources: SourceInfo[],
  wanted: PartyItem['version'],
  fallback?: (sources: SourceInfo[]) => SourceInfo | undefined
): SourceInfo | undefined {
  const same = (s: SourceInfo) => s.aiostreams;
  if (wanted?.filename) {
    const file = sources.find(
      (s) =>
        same(s)?.filename === wanted.filename &&
        (!wanted.size || !same(s)?.size || same(s)?.size === wanted.size)
    );
    if (file) return file;
  }
  if (wanted?.releaseGroup) {
    const release = sources.find(
      (s) =>
        same(s)?.releaseGroup === wanted.releaseGroup &&
        same(s)?.resolution === wanted.resolution
    );
    if (release) return release;
  }
  return fallback?.(sources) ?? sources[0];
}

export function partyItemTitle(item: PartyItem): string {
  if (item.type !== 'Episode' || !item.seriesName) return item.name;
  return [item.seriesName, episodeCode(item.season, item.episode), item.name]
    .filter(Boolean)
    .join(' · ');
}
