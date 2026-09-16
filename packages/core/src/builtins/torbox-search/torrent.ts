import { z } from 'zod';
import { TorBoxSearchApiDataSchema } from './schemas.js';
import {
  extractInfoHashFromMagnet,
  extractTrackersFromMagnet,
} from '../utils/debrid.js';
import { parseAgeString } from '../../parser/utils.js';

export interface Torrent {
  hash: string;
  // magnet?: string;
  title: string;
  size: number;
  indexer: string;
  age?: number;
  seeders?: number;
  type: 'torrent' | 'usenet';
  sources: string[];
  nzb?: string;
  userSearch?: boolean;
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
    age: parseAgeString(file.age),
    type: file.type,
    userSearch: file.user_search,
    seeders:
      file.last_known_seeders !== -1 ? file.last_known_seeders : undefined,
    nzb: file.nzb ?? undefined,
  }));
}
