import { execFile } from 'node:child_process';
import type { MediaInfoRecord, MediaTrack, VideoTrack } from './record.js';

const PROBE_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const VIDEO_FRAME_SAMPLE = 5;
const MAX_TEXT = 512;

interface FfprobeStream {
  index: number;
  codec_type?: string;
  codec_name?: string;
  codec_tag_string?: string;
  profile?: string;
  width?: number;
  height?: number;
  level?: number;
  field_order?: string;
  refs?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  bit_rate?: string;
  bits_per_raw_sample?: string;
  pix_fmt?: string;
  color_primaries?: string;
  color_range?: string;
  color_space?: string;
  color_transfer?: string;
  display_aspect_ratio?: string;
  channels?: number;
  channel_layout?: string;
  sample_rate?: string;
  side_data_list?: {
    side_data_type?: string;
    dv_profile?: number;
    dv_level?: number;
  }[];
  tags?: Record<string, string | undefined>;
  disposition?: Record<string, number | undefined>;
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  frames?: {
    stream_index?: number;
    side_data_list?: { side_data_type?: string }[];
  }[];
  chapters?: unknown[];
  format?: {
    format_name?: string;
    duration?: string;
    size?: string;
    bit_rate?: string;
  };
}

export class FfprobeMissingError extends Error {}

const versions = new Map<string, Promise<string | null>>();

export function ffprobeVersion(path: string): Promise<string | null> {
  let version = versions.get(path);
  if (!version) {
    version = new Promise((resolve) =>
      execFile(path, ['-version'], { timeout: 10_000 }, (error, stdout) => {
        if (error) return resolve(null);
        const named = /ffprobe version (\S+)/.exec(stdout)?.[1];
        resolve(named ?? (stdout.split('\n')[0].trim() || null));
      })
    );
    versions.set(path, version);
  }
  return version;
}

function run(
  path: string,
  args: string[],
  signal?: AbortSignal
): Promise<FfprobeOutput> {
  return new Promise((resolve, reject) => {
    execFile(
      path,
      ['-v', 'error', '-print_format', 'json', ...args],
      { timeout: PROBE_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, signal },
      (error, stdout) => {
        if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') {
          reject(new FfprobeMissingError(path));
          return;
        }
        if (error) {
          reject(error);
          return;
        }
        try {
          resolve(JSON.parse(stdout) as FfprobeOutput);
        } catch (err) {
          reject(err);
        }
      }
    );
  });
}

function number(value: unknown): number | undefined {
  const n = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(n) && n >= 0
    ? n
    : undefined;
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, MAX_TEXT) : undefined;
}

function frameRate(rate: string | undefined): number | undefined {
  if (!rate) return undefined;
  const [num, den] = rate.split('/').map(Number);
  const fps = den ? num / den : num;
  return Number.isFinite(fps) && fps > 0 ? fps : undefined;
}

function pixelBitDepth(pixFmt: string | undefined): number | undefined {
  if (!pixFmt) return undefined;
  const depth = /p(\d{2})(?:le|be)?$/.exec(pixFmt)?.[1];
  return depth ? Number(depth) : /^yuvj?4\d\dp$/.test(pixFmt) ? 8 : undefined;
}

/** Matroska and other containers without FourCCs report all-zero tags. */
function codecTag(tag: string | undefined): string | undefined {
  return tag && !/^(\[0\])+$/.test(tag) ? text(tag) : undefined;
}

const HDR10_PLUS_SIDE_DATA = new Set([
  'HDR Dynamic Metadata SMPTE2094-40 (HDR10+)',
  'HDR10+ Dynamic Metadata (SMPTE 2094-40)',
]);

interface FrameFacts {
  refs: Map<number, number>;
  hdr10Plus: Set<number>;
}

function toTrack(
  stream: FfprobeStream,
  frames: FrameFacts | undefined
): MediaTrack | undefined {
  const flag = (name: string) => stream.disposition?.[name] === 1 || undefined;
  const common = {
    index: stream.index,
    codec: text(stream.codec_name),
    profile: text(stream.profile),
    language: text(stream.tags?.language),
    title: text(stream.tags?.title),
    bitrate: number(stream.bit_rate ?? stream.tags?.BPS),
    default: flag('default'),
    forced: flag('forced'),
    hearingImpaired: flag('hearing_impaired'),
    visualImpaired: flag('visual_impaired'),
    commentary: flag('comment'),
    dub: flag('dub'),
    original: flag('original'),
  };
  switch (stream.codec_type) {
    case 'video': {
      // Cover art is a still image, not a track players offer.
      if (stream.disposition?.attached_pic === 1) return undefined;
      const dovi = stream.side_data_list?.find(
        (s) => s.side_data_type === 'DOVI configuration record'
      );
      const track: VideoTrack = {
        ...common,
        type: 'video',
        width: number(stream.width),
        height: number(stream.height),
        fps: frameRate(stream.r_frame_rate),
        avgFps: frameRate(stream.avg_frame_rate),
        bitDepth:
          number(stream.bits_per_raw_sample) ?? pixelBitDepth(stream.pix_fmt),
        pixelFormat: text(stream.pix_fmt),
        colorPrimaries: text(stream.color_primaries),
        colorRange: text(stream.color_range),
        colorSpace: text(stream.color_space),
        colorTransfer: text(stream.color_transfer),
        aspectRatio: text(stream.display_aspect_ratio),
        codecTag: codecTag(stream.codec_tag_string),
        level: number(stream.level),
        refFrames: frames?.refs.get(stream.index) ?? number(stream.refs),
        interlaced:
          stream.field_order && stream.field_order !== 'unknown'
            ? stream.field_order !== 'progressive'
            : undefined,
        dvProfile: number(dovi?.dv_profile),
        dvLevel: number(dovi?.dv_level),
        hdr10Plus: frames?.hdr10Plus.has(stream.index) || undefined,
      };
      return track;
    }
    case 'audio':
      return {
        ...common,
        type: 'audio',
        channels: number(stream.channels),
        channelLayout: text(stream.channel_layout),
        sampleRate: number(stream.sample_rate),
      };
    case 'subtitle':
      return { ...common, type: 'subtitle' };
    default:
      return undefined;
  }
}

/** Reference frames and HDR10+ metadata only show once a few frames decode. */
async function probeFrames(
  path: string,
  url: string,
  signal?: AbortSignal
): Promise<FrameFacts> {
  const output = await run(
    path,
    [
      '-select_streams',
      'v',
      '-show_streams',
      '-show_frames',
      '-read_intervals',
      `%+#${VIDEO_FRAME_SAMPLE}`,
      url,
    ],
    signal
  );
  const refs = new Map<number, number>();
  for (const stream of output.streams ?? []) {
    if (stream.refs !== undefined) refs.set(stream.index, stream.refs);
  }
  const hdr10Plus = new Set<number>();
  for (const frame of output.frames ?? []) {
    if (
      frame.stream_index !== undefined &&
      frame.side_data_list?.some((s) =>
        HDR10_PLUS_SIDE_DATA.has(s.side_data_type ?? '')
      )
    ) {
      hdr10Plus.add(frame.stream_index);
    }
  }
  return { refs, hdr10Plus };
}

/** Throws {@link FfprobeMissingError} when ffprobe isn't installed. */
export async function probeMediaInfo(
  path: string,
  url: string,
  signal?: AbortSignal
): Promise<MediaInfoRecord | undefined> {
  const output = await run(
    path,
    ['-show_format', '-show_streams', '-show_chapters', url],
    signal
  );
  const streams = output.streams ?? [];
  const frames = streams.some((s) => s.codec_type === 'video')
    ? await probeFrames(path, url, signal).catch((err) => {
        if (err instanceof FfprobeMissingError || signal?.aborted) throw err;
        return undefined;
      })
    : undefined;
  const tracks = streams
    .map((s) => toTrack(s, frames))
    .filter((t): t is MediaTrack => t !== undefined)
    .sort((a, b) => a.index - b.index);
  if (tracks.length === 0) return undefined;
  return {
    container: text(output.format?.format_name),
    duration: number(output.format?.duration),
    size: number(output.format?.size),
    bitrate: number(output.format?.bit_rate),
    chapters: (output.chapters?.length ?? 0) > 0,
    tracks,
  };
}
