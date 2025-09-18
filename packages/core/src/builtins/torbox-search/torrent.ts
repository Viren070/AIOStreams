import { z } from 'zod';
import { TorBoxSearchApiDataSchema } from './schemas.js';
import {
  extractInfoHashFromMagnet,
  extractTrackersFromMagnet,
} from '../utils/debrid.js';

export interface Torrent {
  hash: string;
  // magnet?: string;
  title: string;
  fileIdx?: number;
  size: number;
  indexer: string;
  age?: string;
  seeders?: number;
  type: 'torrent' | 'usenet';
  sources: string[];
  nzb?: string;
  userSearch?: boolean;
  cached?: boolean;
  owned?: boolean;
}

export function convertDataToTorrents(
  data: z.infer<typeof TorBoxSearchApiDataSchema>['torrents']
): Torrent[] {
  return (data || []).map((file) => ({
    hash:
      file.hash ??
      (file.magnet ? extractInfoHashFromMagnet(file.magnet) : undefined),
    // magnet: file.magnet ?? undefined,
    sources: file.magnet ? extractTrackersFromMagnet(file.magnet) : [],
    title: file.raw_title,
    size: file.size,
    indexer: file.tracker,
    age: file.age,
    type: file.type,
    userSearch: file.user_search,
    seeders:
      file.last_known_seeders !== -1 ? file.last_known_seeders : undefined,
    nzb: file.nzb ?? undefined,
    cached: file.cached ?? undefined,
    owned: file.owned ?? undefined,
  }));
}
