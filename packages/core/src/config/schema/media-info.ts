import { z } from 'zod';
import {
  commaSeparatedEnumList,
  positiveInt,
  seconds,
  urlString,
} from './helpers.js';
import type { RuntimeConfigSection } from '../types.js';

export const MEDIA_INFO_PROBE_PATHS = [
  'stremio',
  'jellyfin',
  'library',
  'shares',
] as const;
export type MediaInfoProbePath = (typeof MEDIA_INFO_PROBE_PATHS)[number];

export const MEDIA_INFO_BACKFILL_SOURCES = ['stremthru', 'remuxdb'] as const;
export type MediaInfoBackfillSource =
  (typeof MEDIA_INFO_BACKFILL_SOURCES)[number];

export const mediaInfoSchema = {
  probe: {
    schema: z.boolean(),
    default: true,
    label: 'Probe played files',
    description:
      'The first time a file plays, read its tracks, codecs and languages with ffprobe and remember them, so later stream lists and media servers can show the real tracks. **Probe on** sets where this happens.',
    env: 'MEDIA_INFO_PROBE',
    requiresRestart: false,
    secret: false,
  },
  probeOn: {
    schema: commaSeparatedEnumList(MEDIA_INFO_PROBE_PATHS),
    default: ['stremio', 'jellyfin', 'library'] as string[],
    label: 'Probe on',
    description:
      "Where files are probed. **stremio** covers plays from Stremio and every other addon client; **jellyfin** covers media server clients, including the wait for tracks on play; **library** covers NZBs added from the dashboard; **shares** covers the first read through the WebDAV, NFS or FUSE shares, which Sonarr, Radarr and media server scans use and usually probe themselves, so it is off by default. Debrid files are only read where that can't add another IP to the account: TorBox, proxied streams, and usenet through the built-in engine.",
    env: 'MEDIA_INFO_PROBE_ON',
    requiresRestart: false,
    secret: false,
  },
  backfill: {
    schema: commaSeparatedEnumList(MEDIA_INFO_BACKFILL_SOURCES),
    default: ['stremthru'] as string[],
    label: 'Store media info from',
    description:
      'Sources whose tracks are kept here, so streams from every addon show them. **stremthru** keeps what StremThru reports for torrent files when a debrid service checks what it has cached; **remuxdb** keeps the RemuxDB versions streams matched, where configurations look RemuxDB up. Leave this empty and turn **Probe** off to store nothing here, for example when looking files up on another instance instead.',
    env: 'MEDIA_INFO_BACKFILL',
    requiresRestart: false,
    secret: false,
  },
  playWait: {
    schema: seconds,
    default: 0,
    label: 'Wait for tracks on play',
    description:
      'When a media server client starts a version whose tracks are not known yet and that can be read safely, probe it first and wait up to this long before answering, so the player shows the real tracks on the first play. **0** answers at once, and the tracks show from the next play. This is the default for configurations that do not set their own.',
    env: 'MEDIA_INFO_PLAY_WAIT',
    requiresRestart: false,
    secret: false,
  },
  maxConcurrentProbes: {
    schema: positiveInt,
    default: 1,
    label: 'Max concurrent probes',
    description:
      'How many files may be probed at the same time. Each probe reads the start of a file and runs ffprobe, so one is usually enough.',
    env: 'MEDIA_INFO_MAX_CONCURRENT_PROBES',
    requiresRestart: false,
    secret: false,
  },
  maxQueuedProbes: {
    schema: positiveInt,
    default: 50,
    label: 'Max queued probes',
    description:
      'How many files may wait for a probe. Files past this are skipped and probed the next time they play.',
    env: 'MEDIA_INFO_MAX_QUEUED_PROBES',
    requiresRestart: false,
    secret: false,
  },
  probeTimeout: {
    schema: seconds,
    default: 90,
    label: 'Probe timeout',
    description:
      'The longest one probe may take, from opening the file to storing its tracks. A probe that runs over is stopped and recorded as timed out.',
    env: 'MEDIA_INFO_PROBE_TIMEOUT',
    requiresRestart: false,
    secret: false,
  },
  ffprobePath: {
    schema: z.string().min(1),
    default: 'ffprobe',
    label: 'ffprobe path',
    description:
      'The ffprobe program to run. Leave it as **ffprobe** to use the one on the PATH, which the Docker image includes.',
    env: 'FFPROBE_PATH',
    requiresRestart: false,
    secret: false,
  },
  serve: {
    schema: z.boolean(),
    default: false,
    label: 'Share with other instances',
    description:
      'Let other AIOStreams instances look up the media info stored here, read-only. They ask by info hash or NZB key and get back the tracks of files played here, which shows which releases this instance has played.',
    env: 'MEDIA_INFO_SERVE',
    requiresRestart: false,
    secret: false,
  },
  lookupUrl: {
    schema: z.union([urlString, z.null()]),
    default: null,
    label: 'Look up on another instance',
    description:
      'An AIOStreams instance that shares its media info. Files with nothing stored here are looked up there, so tracks show without probing them yourself. Every stream list sends the info hashes and NZB keys of its results to that instance.',
    env: 'MEDIA_INFO_LOOKUP_URL',
    requiresRestart: false,
    secret: false,
  },
} as const satisfies RuntimeConfigSection;
