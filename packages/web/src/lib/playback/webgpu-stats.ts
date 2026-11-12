import type { StatsRow } from './engine';

interface GpuStream {
  Codec: string | null;
  Profile: string | null;
  Width: number | null;
  Height: number | null;
  BitDepth: number | null;
  ColorPrimaries: string | null;
  VideoRangeType: string | null;
  Channels: number | null;
  SampleRate: number | null;
}

export interface GpuStats {
  route: string;
  video: GpuStream | null;
  audio: GpuStream | null;
  dolbyVisionProfile: number | null;
  toneMapped: boolean;
  audioOutputLayout: string | null;
  audioObjects: number | null;
  audioUnderflows: number;
  framesPresented: number;
  framesDropped: number;
  framesLate: number;
  videoAheadMs: number | null;
  audioAheadMs: number | null;
  clockMs: number;
  presentedMs: number | null;
  passes: readonly string[];
}

/** The name of the upscaler's last pass in its pass file. */
export const UPSCALE_PASS = 'upscale';

/* eslint-disable lingui/no-unlocalized-strings -- a technical readout, as mpv's own is */
const CODECS: Record<string, string> = {
  aac: 'AAC',
  ac3: 'AC-3',
  av1: 'AV1',
  dts: 'DTS',
  eac3: 'E-AC-3',
  flac: 'FLAC',
  h264: 'H.264',
  hevc: 'HEVC',
  mp3: 'MP3',
  mpeg2video: 'MPEG-2',
  mpeg4: 'MPEG-4',
  opus: 'Opus',
  truehd: 'TrueHD',
  vc1: 'VC-1',
  vorbis: 'Vorbis',
  vp8: 'VP8',
  vp9: 'VP9',
};

const codecOf = (stream: GpuStream) =>
  (stream.Codec && (CODECS[stream.Codec] ?? stream.Codec)) || '?';
const seconds = (ms: number | null) =>
  ms === null ? '?' : `${(ms / 1000).toFixed(1)} s`;

/** `speed` is the clock's over the last read, null on the first. */
export function gpuStatsRows(
  stats: GpuStats,
  speed: number | null
): StatsRow[] {
  const { video, audio } = stats;
  const rows: StatsRow[] = [
    { label: 'Engine', value: 'WebGPU-Player' },
    { label: 'Route', value: stats.route },
  ];
  if (video) {
    rows.push({
      label: 'Video',
      value: [
        codecOf(video),
        video.Profile,
        video.Width && video.Height && `${video.Width}×${video.Height}`,
        video.BitDepth && `${video.BitDepth}-bit`,
      ]
        .filter(Boolean)
        .join(' '),
    });
    rows.push({
      label: 'Colour',
      value: [
        stats.dolbyVisionProfile !== null &&
          `Dolby Vision profile ${stats.dolbyVisionProfile}`,
        video.VideoRangeType ?? 'SDR',
        video.ColorPrimaries === 'bt2020' && 'BT.2020',
        stats.toneMapped && 'tone-mapped to SDR',
      ]
        .filter(Boolean)
        .join(' · '),
    });
  }
  if (audio) {
    const hz = audio.SampleRate;
    rows.push({
      label: 'Audio',
      value: `${codecOf(audio)} ${audio.Channels ?? '?'} ch${hz ? ` ${hz / 1000} kHz` : ''}${stats.audioObjects ? ` · ${stats.audioObjects} objects` : ''}`,
    });
    if (stats.audioOutputLayout)
      rows.push({ label: 'Output', value: stats.audioOutputLayout });
  }
  rows.push(
    {
      label: 'Clock',
      value: `${seconds(stats.clockMs)}${speed === null ? '' : ` · ${speed.toFixed(2)}×`}`,
    },
    {
      label: 'A-V',
      value:
        stats.presentedMs === null
          ? '?'
          : `${Math.round(stats.presentedMs - stats.clockMs)} ms`,
    },
    {
      label: 'Buffered',
      value: `video ${seconds(stats.videoAheadMs)} · audio ${seconds(stats.audioAheadMs)}`,
    },
    {
      label: 'Frames',
      value: `${stats.framesPresented} shown · ${stats.framesDropped} dropped · ${stats.framesLate} late`,
    }
  );
  if (stats.audioUnderflows)
    rows.push({ label: 'Underflows', value: String(stats.audioUnderflows) });
  const passes = stats.passes.filter(
    (name) => !name.startsWith('upscale layer')
  );
  if (passes.length) rows.push({ label: 'Passes', value: passes.join(', ') });
  return rows;
}
/* eslint-enable lingui/no-unlocalized-strings */
