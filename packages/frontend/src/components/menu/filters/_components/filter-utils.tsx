import {
  RESOLUTIONS,
  QUALITIES,
  ENCODES,
  STREAM_TYPES,
  VISUAL_TAGS,
  AUDIO_TAGS,
  AUDIO_CHANNELS,
  LANGUAGES,
} from '../../../../../../core/src/utils/constants';

// Type aliases

export type Resolution = (typeof RESOLUTIONS)[number];
export type Quality = (typeof QUALITIES)[number];
export type Encode = (typeof ENCODES)[number];
export type StreamType = (typeof STREAM_TYPES)[number];
export type VisualTag = (typeof VISUAL_TAGS)[number];
export type AudioTag = (typeof AUDIO_TAGS)[number];
export type AudioChannel = (typeof AUDIO_CHANNELS)[number];
export type Language = (typeof LANGUAGES)[number];

// Default preference arrays

export const defaultPreferredResolutions: Resolution[] = [
  '2160p',
  '1440p',
  '1080p',
  '720p',
  '576p',
  '480p',
  '360p',
  '240p',
  '144p',
  'Unknown',
];

export const defaultPreferredQualities: Quality[] = [
  'BluRay REMUX',
  'BluRay',
  'WEB-DL',
  'WEBRip',
  'HDRip',
  'HC HD-Rip',
  'DVD REMUX',
  'DVDRip',
  'HDTV',
  'CAM',
  'TS',
  'TC',
  'SCR',
  'Unknown',
];

export const defaultPreferredEncodes: Encode[] = [];
export const defaultPreferredStreamTypes: StreamType[] = [];
export const defaultPreferredVisualTags: VisualTag[] = [];
export const defaultPreferredAudioTags: AudioTag[] = [];

// Utility functions

/**
 * Formats age in hours to a human-readable string.
 * Shows hours if < 24, otherwise shows days.
 */
export function formatAgeDisplay(hours: number): string {
  if (hours < 24) {
    return `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

// Deduplicator constants

export const deduplicatorMultiGroupBehaviourHelp = {
  conservative:
    'Removes duplicates conservatively - removes uncached versions which have cached versions from the same service, and removes P2P versions when cached versions exist',
  aggressive:
    'Aggressively removes all uncached and p2p streams when cached versions exist, and removes uncached streams when p2p versions exist',
  keep_all: 'Keeps all streams and processes each group independently',
};

export const defaultDeduplicatorMultiGroupBehaviour = 'aggressive';
