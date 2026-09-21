export type ArrType = 'sonarr' | 'radarr';

/** Sonarr/Radarr instance the operator configured (`arr.instances`). */
export interface ArrInstance {
  id: string;
  name?: string;
  type: ArrType;
  url: string;
  apiKey: string;
  enabled?: boolean;
  /** Download-client categories this instance owns; empty = any. */
  categories?: string[];
}

export type ArrRepairState =
  | 'pending'
  | 'blocklisted'
  | 'searched'
  | 'done'
  | 'failed';

export interface ArrRepair {
  state: ArrRepairState;
  /** Why the release is being replaced. */
  reason: 'failed' | 'degraded';
  attempts: number;
  lastAt?: number;
  /** Epoch ms of the next attempt. */
  nextAt: number;
  lastError?: string;
}

/**
 * What an arr told us about a download we handed it, keyed by the download
 * client id we reported (`SABnzbd_nzo_<hash>` for usenet). Stored as JSON on
 * the library row so any transport can carry the same shape.
 */
export interface ArrLink {
  instanceId: string;
  downloadId: string;
  /** History id of the `grabbed` event; what `history/failed` is posted to. */
  grabId?: number;
  /** movieId (Radarr) or seriesId (Sonarr). */
  parentId?: number;
  linkedAt: number;
  importedAt?: number;
  importedPaths?: string[];
  repair?: ArrRepair;
}
