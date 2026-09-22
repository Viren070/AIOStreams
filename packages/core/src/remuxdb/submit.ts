import { appConfig, makeRequest } from '../utils/index.js';
import { instanceId } from '../stream-sessions/index.js';
import { logger } from './client.js';

export interface ExternalIds {
  imdb_id?: string;
  tmdb_id?: number;
  tvdb_id?: number;
}

export interface NzbSubmission {
  indexer: string;
  indexer_guid: string;
  title?: string;
}

interface BaseTrackPayload {
  idx: number;
  bit_rate?: number;
  bit_depth?: number;
  profile?: string;
  codec_tag?: string;
  comment?: string;
  title?: string;
  language?: string;
  is_default?: boolean;
  is_forced?: boolean;
  is_external?: boolean;
  is_hearing_impaired?: boolean;
}

export interface VideoTrackPayload extends BaseTrackPayload {
  kind: 'video';
  codec: string;
  width: number;
  height: number;
  fps?: number;
  avg_fps?: number;
  pixel_format?: string;
  color_primaries?: string;
  color_range?: string;
  color_space?: string;
  color_transfer?: string;
  aspect_ratio?: string;
  rotation?: number;
  is_interlaced?: boolean;
  is_anamorphic?: boolean;
  hdr10_plus_present?: boolean;
  dv_profile?: number;
  dv_level?: number;
  dv_version_major?: number;
  dv_version_minor?: number;
  dv_bl_signal_compat_id?: number;
  dv_rpu_present?: boolean;
  dv_bl_present?: boolean;
  dv_el_present?: boolean;
  level?: number;
  ref_frames?: number;
}

export interface AudioTrackPayload extends BaseTrackPayload {
  kind: 'audio';
  codec: string;
  channels: number;
  sample_rate: number;
  channel_layout?: string;
}

export interface SubtitleTrackPayload extends BaseTrackPayload {
  kind: 'subtitle';
  codec?: string;
}

export type TrackPayload =
  | VideoTrackPayload
  | AudioTrackPayload
  | SubtitleTrackPayload;

export interface MediaInfoPayload {
  client_id?: string;
  kind: 'movie' | 'episode';
  filename: string;
  torrent_info_hash?: string;
  torrent_file_idx?: number;
  nzb?: NzbSubmission;
  container: string;
  size: number;
  duration: number;
  bitrate?: number;
  season?: number;
  episode?: number;
  external_ids?: ExternalIds;
  tracks: TrackPayload[];
}

export async function submitProbe(
  payload: Omit<MediaInfoPayload, 'client_id'>
): Promise<boolean> {
  try {
    const url = `${appConfig.remuxdb.baseUrl}/api/mediainfo`;
    const body = JSON.stringify({ ...payload, client_id: instanceId() });
    logger.trace(
      `remuxdb payload for ${payload.filename} (${payload.nzb?.indexer}:${payload.nzb?.indexer_guid}): ${body}`
    );
    const response = await makeRequest(url, {
      method: 'POST',
      timeout: 10000,
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      logger.error(
        `remuxdb submission for ${payload.filename} (${payload.nzb?.indexer}:${payload.nzb?.indexer_guid}) returned ${response.status}: ${body}`
      );
      return false;
    }
    logger.debug(
      `remuxdb submission for ${payload.filename} (${payload.nzb?.indexer}:${payload.nzb?.indexer_guid}) accepted`
    );
    return true;
  } catch (error) {
    logger.error(
      `remuxdb submission failed for ${payload.filename} (${payload.nzb?.indexer}:${payload.nzb?.indexer_guid}): ${error}`
    );
    return false;
  }
}
