import type { MediaTrack, ParsedFile, ParsedStream } from '../db/schemas.js';
import { constants } from '../utils/index.js';
import { languageToIso6392 } from '../utils/languages.js';
import { mediaSourceId } from './ids.js';
import {
  mergeSubtitleTracks,
  subtitleCodecFor,
  subtitleExtensionOf,
  type SubtitleFormat,
} from './subtitles.js';
import type {
  AiostreamsSourceExtension,
  JellyfinMediaSource,
  JellyfinMediaStream,
  MediaSourceRecord,
  SubtitleTrack,
} from './types.js';

export const TICKS_PER_MS = 10_000;

type Encode = (typeof constants.ENCODES)[number];
type AudioTag = (typeof constants.AUDIO_TAGS)[number];
type AudioChannels = (typeof constants.AUDIO_CHANNELS)[number];
type Resolution = (typeof constants.RESOLUTIONS)[number];
type VisualTag = (typeof constants.VISUAL_TAGS)[number];

/* ffmpeg codec names, what Jellyfin clients compare their device profiles against */
const ENCODE_CODEC = {
  AV1: 'av1',
  HEVC: 'hevc',
  AVC: 'h264',
  'VC-1': 'vc1',
  XviD: 'mpeg4',
  DivX: 'mpeg4',
  'MPEG-4': 'mpeg4',
  Unknown: undefined,
} satisfies Record<Encode, string | undefined>;

const AUDIO_CODEC = {
  Atmos: 'truehd',
  TrueHD: 'truehd',
  'DTS:X': 'dts',
  'DTS-HD MA': 'dts',
  'DTS-HD': 'dts',
  'DTS-ES': 'dts',
  DTS: 'dts',
  'DD+': 'eac3',
  DD: 'ac3',
  PCM: 'pcm_s16le',
  OPUS: 'opus',
  FLAC: 'flac',
  AAC: 'aac',
  Unknown: undefined,
} satisfies Record<AudioTag, string | undefined>;

const CHANNEL_COUNT = {
  '2.0': 2,
  '5.1': 6,
  '6.1': 7,
  '7.1': 8,
  Unknown: undefined,
} satisfies Record<AudioChannels, number | undefined>;

const CHANNEL_LAYOUT = {
  '2.0': 'stereo',
  '5.1': '5.1',
  '6.1': '6.1',
  '7.1': '7.1',
  Unknown: undefined,
} satisfies Record<AudioChannels, string | undefined>;

const RESOLUTION_SIZE = {
  '2160p': [3840, 2160],
  '1440p': [2560, 1440],
  '1080p': [1920, 1080],
  '720p': [1280, 720],
  '576p': [720, 576],
  '480p': [640, 480],
  '360p': [480, 360],
  '240p': [320, 240],
  '144p': [256, 144],
  Unknown: undefined,
} satisfies Record<Resolution, [number, number] | undefined>;

/* Jellyfin VideoRangeType per tag; composites resolve to their strongest member. */
const VIDEO_RANGE_TYPE = {
  'HDR10+': 'HDR10Plus',
  HDR10: 'HDR10',
  DV: 'DOVI',
  HDR: 'HDR10',
  HLG: 'HLG',
  'HDR+DV': 'DOVI',
  'DV Only': 'DOVI',
  'HDR Only': 'HDR10',
  '10bit': undefined,
  '3D': undefined,
  IMAX: undefined,
  AI: undefined,
  Upscaled: undefined,
  SDR: 'SDR',
  'H-OU': undefined,
  'H-SBS': undefined,
  Unknown: undefined,
} satisfies Record<VisualTag, string | undefined>;

const RANGE_PRIORITY = ['DOVI', 'HDR10Plus', 'HDR10', 'HLG', 'SDR'];

function videoRangeTypeOf(tags: string[]): string {
  const found = tags
    .map((t) => VIDEO_RANGE_TYPE[t as VisualTag])
    .filter((v): v is string => !!v);
  return RANGE_PRIORITY.find((r) => found.includes(r)) ?? 'SDR';
}

export function containerOf(stream: ParsedStream): string {
  const ext =
    stream.parsedFile?.container ||
    stream.parsedFile?.extension ||
    stream.filename?.split('.').pop() ||
    (stream.url ? stream.url.split('?')[0].split('.').pop() : undefined);
  const c = (ext || '').toLowerCase().replace(/^\./, '');
  if (/^(mkv|mp4|avi|mov|m4v|ts|webm|wmv|flv|m2ts|mpg|mpeg)$/.test(c)) return c;
  if (stream.type === 'live') return 'ts';
  return 'mkv';
}

export function extensionFor(
  stream: ParsedStream,
  formatted: { name: string; description: string }
): AiostreamsSourceExtension {
  const pf = stream.parsedFile;
  return {
    name: formatted.name,
    description: formatted.description,
    addon: stream.addon?.name ?? '',
    service: stream.service?.id,
    cached: stream.service?.cached,
    proxied: stream.proxied,
    resolution: pf?.resolution,
    quality: pf?.quality,
    encode: pf?.encode,
    visualTags: pf?.visualTags ?? [],
    audioTags: pf?.audioTags ?? [],
    audioChannels: pf?.audioChannels ?? [],
    languages: pf?.languages ?? [],
    size: stream.size,
    seeders: stream.torrent?.seeders,
    age: stream.age,
    releaseGroup: pf?.releaseGroup,
    indexer: stream.indexer,
    mediaInfoQuality: pf?.mediaInfoQuality,
    filename: stream.filename,
    type: stream.type,
  };
}

/** A stream clients can play directly: has a URL and needs no headers unless proxied. */
export function isPlayable(stream: ParsedStream): boolean {
  if (!stream.url) return false;
  if (stream.proxied) return true;
  const needsHeaders =
    (stream.requestHeaders && Object.keys(stream.requestHeaders).length > 0) ||
    (stream.responseHeaders && Object.keys(stream.responseHeaders).length > 0);
  return !needsHeaders;
}

export function sourceRecordFrom(
  uuid: string,
  stream: ParsedStream,
  formatted: { name: string; description: string },
  label: string,
  addonSubtitles: SubtitleTrack[]
): MediaSourceRecord {
  const identity = stream.id || stream.url || JSON.stringify(stream.releaseKey);
  return {
    msid: mediaSourceId(uuid, identity),
    url: stream.url!,
    requestHeaders: stream.proxied ? undefined : stream.requestHeaders,
    filename: stream.filename,
    container: containerOf(stream),
    size: stream.size,
    bitrate: stream.bitrate,
    durationMs: stream.duration,
    label,
    parsedFile: stream.parsedFile,
    subtitles: mergeSubtitleTracks(stream, addonSubtitles),
    videoHash: stream.videoHash,
    live: stream.type === 'live',
    extension: extensionFor(stream, formatted),
  };
}

const STREAM_FLAGS = {
  IsForced: false,
  IsExternal: false,
  IsInterlaced: false,
  IsHearingImpaired: false,
  SupportsExternalStream: false,
};

function videoStream(
  pf: ParsedFile | undefined,
  bitrate: number | undefined
): JellyfinMediaStream {
  const resolution = pf?.resolution as Resolution | undefined;
  const size = resolution ? RESOLUTION_SIZE[resolution] : undefined;
  const encode = pf?.encode as Encode | undefined;
  const codec = encode ? ENCODE_CODEC[encode] : undefined;
  const tags = pf?.visualTags ?? [];
  const rangeType = videoRangeTypeOf(tags);
  const tenBit = rangeType !== 'SDR' || tags.includes('10bit');
  return {
    Type: 'Video',
    Index: 0,
    ...STREAM_FLAGS,
    Codec: codec,
    Width: size?.[0],
    Height: size?.[1],
    AspectRatio: size ? (size[0] / size[1] >= 1.7 ? '16:9' : '4:3') : undefined,
    IsDefault: true,
    IsTextSubtitleStream: false,
    VideoRange: rangeType === 'SDR' ? 'SDR' : 'HDR',
    VideoRangeType: rangeType,
    BitDepth: tenBit ? 10 : 8,
    BitRate: bitrate,
    DisplayTitle:
      [
        resolution !== 'Unknown' ? resolution : undefined,
        encode !== 'Unknown' ? encode : undefined,
        rangeType !== 'SDR' ? rangeType : undefined,
      ]
        .filter(Boolean)
        .join(' ') || 'Video',
  };
}

/* One entry per real track when the probe listed them, otherwise per language. */
function audioStreams(
  pf: ParsedFile | undefined,
  startIndex: number
): JellyfinMediaStream[] {
  if (pf?.audioTracks?.length) {
    return pf.audioTracks.map((track, i) => {
      const tag = track.tag as AudioTag | undefined;
      const channelTag = track.channels as AudioChannels | undefined;
      return {
        Type: 'Audio',
        Index: startIndex + i,
        ...STREAM_FLAGS,
        Codec: track.codec ?? (tag ? AUDIO_CODEC[tag] : undefined),
        Language: track.lang ? languageToIso6392(track.lang) : undefined,
        DisplayTitle:
          [track.lang, track.title, tag, channelTag]
            .filter(Boolean)
            .join(' ') || 'Audio',
        Title: track.title,
        Channels: channelTag ? CHANNEL_COUNT[channelTag] : undefined,
        ChannelLayout: channelTag ? CHANNEL_LAYOUT[channelTag] : undefined,
        IsDefault: track.default ?? i === 0,
        IsTextSubtitleStream: false,
      };
    });
  }

  const languages = (pf?.languages ?? []).filter((l) => l && l !== 'Unknown');
  const audioTag = (pf?.audioTags ?? []).find((t) => t !== 'Unknown') as
    | AudioTag
    | undefined;
  const codec = audioTag ? AUDIO_CODEC[audioTag] : undefined;
  const channelTag = (pf?.audioChannels ?? []).find((c) => c !== 'Unknown') as
    | AudioChannels
    | undefined;
  const channels = channelTag ? CHANNEL_COUNT[channelTag] : undefined;
  const layout = channelTag ? CHANNEL_LAYOUT[channelTag] : undefined;
  const list = languages.length ? languages : ['Unknown'];
  return list.map((lang, i) => ({
    Type: 'Audio',
    Index: startIndex + i,
    ...STREAM_FLAGS,
    Codec: codec,
    Language: lang === 'Unknown' ? undefined : languageToIso6392(lang),
    DisplayTitle:
      [lang !== 'Unknown' ? lang : undefined, audioTag, channelTag]
        .filter(Boolean)
        .join(' ') || 'Audio',
    Channels: channels,
    ChannelLayout: layout,
    IsDefault: i === 0,
    IsTextSubtitleStream: false,
  }));
}

/*
 * Only a real probe knows the embedded tracks. Clients match an advertised
 * track to the one their player demuxed by language and title, so the language
 * fallback emits no `Title` rather than an invented one that mis-selects.
 */
function embeddedSubtitleStreams(
  pf: ParsedFile | undefined,
  startIndex: number
): JellyfinMediaStream[] {
  if (pf?.mediaInfoQuality !== 'probe') return [];
  const tracks = pf.subtitleTracks?.length
    ? pf.subtitleTracks
    : (pf.subtitles ?? [])
        .filter((l) => l && l !== 'Unknown')
        .map((lang) => ({ lang }) as MediaTrack);
  return tracks.map((track, i) => ({
    Type: 'Subtitle',
    Index: startIndex + i,
    ...STREAM_FLAGS,
    Codec: track.codec,
    Language: track.lang ? languageToIso6392(track.lang) : undefined,
    DisplayTitle:
      [track.lang, track.title].filter(Boolean).join(' - ') || 'Subtitle',
    Title: track.title,
    IsDefault: track.default ?? false,
    IsForced: track.forced ?? false,
    IsTextSubtitleStream: true,
    DeliveryMethod: 'Embed',
  }));
}

export interface MediaSourceBuildOptions {
  /** Id to emit; the first source of an item uses the item id. */
  id: string;
  /** Delivery format for one track, given the format it is served in upstream. */
  subtitleFormat: (sourceExtension: string) => SubtitleFormat;
  /** Server-relative delivery URL for the subtitle stream at `index`. */
  subtitleUrl: (index: number, format: SubtitleFormat) => string;
  runtimeMs?: number;
  includeExtension: boolean;
  hasSegments?: boolean;
}

/**
 * Index of the first external subtitle stream. The subtitle route is addressed
 * by MediaStream index, so this must match what `buildMediaStreams` emits.
 */
export function externalSubtitleStartIndex(record: MediaSourceRecord): number {
  return (
    1 +
    audioStreams(record.parsedFile, 0).length +
    embeddedSubtitleStreams(record.parsedFile, 0).length
  );
}

export function buildMediaStreams(
  record: MediaSourceRecord,
  opts: Pick<MediaSourceBuildOptions, 'subtitleFormat' | 'subtitleUrl'>
): JellyfinMediaStream[] {
  const streams: JellyfinMediaStream[] = [
    videoStream(record.parsedFile, record.bitrate),
  ];
  streams.push(...audioStreams(record.parsedFile, streams.length));
  streams.push(...embeddedSubtitleStreams(record.parsedFile, streams.length));
  const externalStart = streams.length;
  record.subtitles.forEach((sub, i) => {
    const index = externalStart + i;
    const format = opts.subtitleFormat(subtitleExtensionOf(sub.url));
    const url = opts.subtitleUrl(index, format);
    streams.push({
      Type: 'Subtitle',
      Index: index,
      ...STREAM_FLAGS,
      IsExternal: true,
      SupportsExternalStream: true,
      Codec: subtitleCodecFor(format),
      Language: languageToIso6392(sub.lang) ?? sub.lang.toLowerCase(),
      DisplayTitle: `${sub.lang} (external)`,
      Title: sub.lang,
      IsDefault: false,
      IsTextSubtitleStream: true,
      DeliveryMethod: 'External',
      DeliveryUrl: url,
      IsExternalUrl: false,
      Path: url,
    });
  });
  return streams;
}

const SOURCE_FLAGS = {
  ReadAtNativeFramerate: false,
  IgnoreDts: false,
  IgnoreIndex: false,
  GenPtsInput: false,
  SupportsTranscoding: false,
  SupportsDirectStream: false,
  SupportsDirectPlay: true,
  UseMostCompatibleTranscodingProfile: false,
  RequiresOpening: false,
  RequiresClosing: false,
  RequiresLooping: false,
  SupportsProbing: false,
  VideoType: 'VideoFile',
  MediaAttachments: [] as never[],
  Formats: [] as never[],
  RequiredHttpHeaders: {},
  TranscodingSubProtocol: 'http',
  DefaultSubtitleStreamIndex: -1,
  HasSegments: false,
};

export function buildMediaSource(
  record: MediaSourceRecord,
  opts: MediaSourceBuildOptions
): JellyfinMediaSource {
  const mediaStreams = buildMediaStreams(record, opts);
  const audioIndex = mediaStreams.findIndex((s) => s.Type === 'Audio');
  const durationMs = record.live
    ? undefined
    : record.durationMs || opts.runtimeMs;
  const source: JellyfinMediaSource = {
    Protocol: 'Http',
    Id: opts.id,
    Path: record.url,
    Type: 'Default',
    Container: record.container,
    Size: record.size,
    Name: record.label,
    IsRemote: true,
    ETag: record.msid,
    RunTimeTicks: durationMs ? durationMs * TICKS_PER_MS : undefined,
    IsInfiniteStream: record.live,
    ...SOURCE_FLAGS,
    HasSegments: opts.hasSegments ?? false,
    MediaStreams: mediaStreams,
    Bitrate: record.bitrate,
    DefaultAudioStreamIndex: audioIndex >= 0 ? audioIndex : undefined,
  };
  if (opts.includeExtension) source.aiostreams = record.extension;
  return source;
}

/** A list row carrying one source offers no version picker; detail replaces these with the resolved list. */
export function listPlaceholderSources(
  itemId: string,
  markerId: string,
  name: string,
  path: string
): JellyfinMediaSource[] {
  const stub = (id: string, label: string): JellyfinMediaSource => ({
    Protocol: 'Http',
    Id: id,
    ETag: id,
    Path: path,
    Type: 'Placeholder',
    Name: label,
    IsRemote: true,
    IsInfiniteStream: false,
    SupportsDirectPlay: true,
    SupportsDirectStream: false,
    SupportsTranscoding: false,
    MediaStreams: [],
    Formats: [],
  });
  return [stub(itemId, name), stub(markerId, 'Load versions')];
}

/** Shown when nothing is playable, so clients never see an empty list. */
export function placeholderMediaSource(
  id: string,
  name: string,
  path: string
): JellyfinMediaSource {
  return {
    Protocol: 'Http',
    Id: id,
    Path: path,
    Type: 'Placeholder',
    Container: 'mp4',
    Name: name,
    IsRemote: true,
    ETag: id,
    IsInfiniteStream: false,
    ...SOURCE_FLAGS,
    MediaStreams: [
      {
        Type: 'Video',
        Index: 0,
        ...STREAM_FLAGS,
        Codec: 'h264',
        IsDefault: true,
        IsTextSubtitleStream: false,
        DisplayTitle: name,
      },
    ],
  };
}
