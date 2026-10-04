import { z } from 'zod';

/** Raise when the prober or record shape changes, so files re-probe on play. */
export const MEDIA_INFO_VERSION = 1;

const text = z.string().max(512).optional();
const count = z.number().nonnegative().optional();

const commonTrack = {
  /** Stream index in the container, across every track type. */
  index: z.number().int().nonnegative(),
  codec: text,
  profile: text,
  language: text,
  title: text,
  bitrate: count,
  default: z.boolean().optional(),
  forced: z.boolean().optional(),
  hearingImpaired: z.boolean().optional(),
  visualImpaired: z.boolean().optional(),
  commentary: z.boolean().optional(),
  dub: z.boolean().optional(),
  original: z.boolean().optional(),
};

const VideoTrackSchema = z.object({
  ...commonTrack,
  type: z.literal('video'),
  width: count,
  height: count,
  fps: count,
  avgFps: count,
  bitDepth: count,
  pixelFormat: text,
  colorPrimaries: text,
  colorRange: text,
  colorSpace: text,
  colorTransfer: text,
  aspectRatio: text,
  codecTag: text,
  level: z.number().optional(),
  refFrames: count,
  interlaced: z.boolean().optional(),
  dvProfile: count,
  dvLevel: count,
  hdr10Plus: z.boolean().optional(),
  /** HDR formats a source reported without the details above. */
  hdr: z.array(z.string().max(16)).max(8).optional(),
});

const AudioTrackSchema = z.object({
  ...commonTrack,
  type: z.literal('audio'),
  channels: count,
  channelLayout: text,
  sampleRate: count,
});

const SubtitleTrackSchema = z.object({
  ...commonTrack,
  type: z.literal('subtitle'),
});

export const MediaTrackSchema = z.discriminatedUnion('type', [
  VideoTrackSchema,
  AudioTrackSchema,
  SubtitleTrackSchema,
]);
export type MediaTrack = z.infer<typeof MediaTrackSchema>;
export type VideoTrack = z.infer<typeof VideoTrackSchema>;
export type AudioTrack = z.infer<typeof AudioTrackSchema>;
export type SubtitleTrack = z.infer<typeof SubtitleTrackSchema>;

/** One probed file. Tracks are in container order. */
export const MediaInfoRecordSchema = z.object({
  container: text,
  /** Seconds. */
  duration: count,
  size: count,
  bitrate: count,
  chapters: z.boolean(),
  tracks: z.array(MediaTrackSchema).max(256),
  /** What a source's record was measured with: `ffprobe`, or a store (`rd`). */
  reportedBy: z.string().max(32).optional(),
});
export type MediaInfoRecord = z.infer<typeof MediaInfoRecordSchema>;
