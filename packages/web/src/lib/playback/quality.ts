import { t } from '@lingui/core/macro';
import type { UserDto } from '@/lib/jellyfin/types';
import { QUALITIES } from '@/lib/settings';

export const mayConvert = (user: UserDto): boolean =>
  user.Policy?.EnableVideoPlaybackTranscoding !== false;

/** The most a stream may take, with the height that usually fits in it. */
export function qualityLabel(bitrate: number): string {
  if (!bitrate) return t`Original`;
  const mbps = bitrate / 1e6;
  const height =
    bitrate >= 10e6
      ? '1080p'
      : bitrate >= 4e6
        ? '720p'
        : bitrate >= 2e6
          ? '480p'
          : '360p';
  return t`${height}, ${mbps} Mbps`;
}

export const qualityOptions = () =>
  QUALITIES.map((bitrate) => ({
    id: String(bitrate),
    label: qualityLabel(bitrate),
  }));
