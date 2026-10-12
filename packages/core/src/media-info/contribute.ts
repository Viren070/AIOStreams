import { createLogger } from '../utils/index.js';
import { remuxDbTarget } from '../remuxdb/submit.js';
import type { MediaInfoRecord } from './record.js';

const logger = createLogger('media-info');

export type ContributedSource =
  | { kind: 'nzb'; nzbUrl: string; infoUrl?: string }
  | { kind: 'torrent'; infoHash: string };

/** The title a contribution is filed under. */
export interface ContributionIds {
  imdbId?: string;
  tmdbId?: number;
  tvdbId?: number;
  season?: number;
  episode?: number;
}

/** A file this instance probed and stored. */
export interface Contribution extends ContributionIds {
  source: ContributedSource;
  file: string;
  record: MediaInfoRecord;
}

export interface ContributionTarget {
  name: string;
  enabled(): boolean;
  send(contribution: Contribution): Promise<void>;
}

const TARGETS: ContributionTarget[] = [remuxDbTarget];

export function contribute(contribution: Contribution): void {
  for (const target of TARGETS) {
    if (!target.enabled()) continue;
    target
      .send(contribution)
      .catch((err) =>
        logger.warn(
          { target: target.name, err: (err as Error)?.message },
          'media info contribution failed'
        )
      );
  }
}
