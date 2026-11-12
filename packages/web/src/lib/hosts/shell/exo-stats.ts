import { formatBytes } from '@aiostreams/ui/core/format';
import type { EngineStats, StatsRow } from '@/lib/playback/engine';
import { t } from '@lingui/core/macro';
import { ask } from './bridge';

/* eslint-disable lingui/no-unlocalized-strings -- a technical readout, as mpv's own is */
const CODECS: Record<string, string> = {
  'video/avc': 'H.264',
  'video/hevc': 'HEVC',
  'video/av01': 'AV1',
  'video/x-vnd.on2.vp9': 'VP9',
  'audio/mp4a-latm': 'AAC',
  'audio/ac3': 'AC-3',
  'audio/eac3': 'E-AC-3',
  'audio/eac3-joc': 'E-AC-3 Atmos',
  'audio/true-hd': 'TrueHD',
  'audio/vnd.dts': 'DTS',
  'audio/vnd.dts.hd': 'DTS-HD',
  'audio/vnd.dts.uhd;profile=p2': 'DTS:X',
  'audio/ac4': 'AC-4',
  'audio/opus': 'Opus',
  'audio/flac': 'FLAC',
  'audio/raw': 'PCM',
};

/** Media3's C.COLOR_TRANSFER_* values. */
const TRANSFERS: Record<number, string> = { 6: 'HDR10 (PQ)', 7: 'HLG' };
/** Media3's C.COLOR_SPACE_BT2020. */
const BT2020 = 6;

const HEVC_PROFILES: Record<string, string> = {
  '1': 'Main',
  '2': 'Main 10',
  '3': 'Main Still',
};
const AVC_PROFILES: Record<string, string> = {
  '42': 'Baseline',
  '4D': 'Main',
  '64': 'High',
  '6E': 'High 10',
};

/** As `hvc1.2.4.L153` or `dvhe.08.06` name it. */
function profileOf(codecs: string | undefined): string | undefined {
  const [kind = '', a = '', b = ''] = codecs?.split('.') ?? [];
  if (/^(dvhe|dvh1|dav1|dva1|dvav)$/.test(kind))
    return `Dolby Vision profile ${Number(a)}, level ${Number(b)}`;
  if (kind === 'hvc1' || kind === 'hev1')
    return HEVC_PROFILES[a.replace(/^[A-C]/, '')];
  if (kind === 'avc1' || kind === 'avc3')
    return AVC_PROFILES[a.slice(0, 2).toUpperCase()];
  return undefined;
}

/** Android's display HDR types. */
const HDR_TYPES: Record<number, string> = {
  1: 'Dolby Vision',
  2: 'HDR10',
  3: 'HLG',
  4: 'HDR10+',
};

function exoStatsRows(
  stats: Record<string, unknown>,
  cpu: number | undefined
): StatsRow[] {
  const num = (key: string) =>
    typeof stats[key] === 'number' ? (stats[key] as number) : undefined;
  const str = (key: string) =>
    typeof stats[key] === 'string' ? (stats[key] as string) : undefined;
  const list = (key: string) =>
    Array.isArray(stats[key]) ? (stats[key] as number[]) : [];
  const codec = (mime?: string) => (mime && (CODECS[mime] ?? mime)) || '?';
  const rate = (bits?: number) =>
    bits && bits > 0 ? ` · ${(bits / 1e6).toFixed(1)} Mbps` : '';
  const rows: StatsRow[] = [{ label: 'Engine', value: 'ExoPlayer' }];
  if (str('videoMime')) {
    const fps = num('frameRate');
    // A Dolby Vision track played as its base layer comes out as plain HEVC.
    const profile = profileOf(str('dolbyVisionCodecs') ?? str('videoCodecs'));
    const vision = profile?.startsWith('Dolby');
    rows.push(
      {
        label: 'Video',
        value: `${codec(str('videoMime'))}${profile && !vision ? ` ${profile}` : ''} ${num('width')}×${num('height')}${fps && fps > 0 ? ` ${fps.toFixed(3)} fps` : ''}${rate(num('videoBitrate'))}`,
      },
      {
        label: 'Colour',
        value: [
          vision && profile,
          TRANSFERS[num('colorTransfer') ?? -1] ?? (vision ? undefined : 'SDR'),
          num('colorSpace') === BT2020 && 'BT.2020',
        ]
          .filter(Boolean)
          .join(' · '),
      },
      { label: 'Decoder', value: str('videoDecoder') ?? 'none' }
    );
    const route = str('dolbyVisionRoute');
    if (route) rows.push({ label: 'Plays as', value: route });
    const upscaling = str('upscaling');
    if (upscaling) rows.push({ label: 'Upscaling', value: upscaling });
  }
  const hdr = list('hdrTypes')
    .map((type) => HDR_TYPES[type])
    .filter(Boolean);
  const profiles = list('dolbyVisionProfiles');
  rows.push(
    { label: 'Display', value: hdr.length ? hdr.join(', ') : 'SDR' },
    {
      label: 'DV decoder',
      value: profiles.length ? `profiles ${profiles.join(', ')}` : 'none',
    }
  );
  if (str('audioMime')) {
    const hz = num('sampleRate');
    rows.push(
      {
        label: 'Audio',
        value: `${codec(str('audioMime'))} ${num('channels') ?? '?'} ch${hz && hz > 0 ? ` ${hz / 1000} kHz` : ''}${rate(num('audioBitrate'))}`,
      },
      { label: 'Decoder', value: str('audioDecoder') ?? 'passthrough' }
    );
    const output = str('outputMime');
    const outputs = num('outputChannels') ?? 0;
    const inputs = num('channels') ?? 0;
    if (output === 'audio/raw')
      rows.push({
        label: 'Output',
        value: `PCM ${outputs} ch${inputs > outputs ? `, mixed from ${inputs}` : ''}`,
      });
    else if (output === 'audio/ac3' && str('audioMime') !== output)
      rows.push({ label: 'Output', value: `AC-3 ${outputs} ch, re-encoded` });
    else if (output)
      rows.push({
        label: 'Output',
        value: `${codec(output)} passthrough (sound settings don't apply)`,
      });
  }
  const buffered = num('bufferedMs');
  if (buffered !== undefined)
    rows.push({
      label: 'Buffered',
      value: `${(buffered / 1000).toFixed(1)} s`,
    });
  const ahead = num('cacheAhead');
  if (ahead !== undefined) {
    const aheadMs = num('cacheAheadMs');
    const behindMs = num('cacheBehindMs');
    const speed = num('linkSpeed') ?? 0;
    const ratio = num('linkRatio');
    rows.push({
      label: 'Cache',
      value: `${behindMs !== undefined ? `${Math.round(behindMs / 1000)} s behind · ` : ''}${aheadMs !== undefined ? `${Math.round(aheadMs / 1000)} s` : formatBytes(ahead)} ahead · ${formatBytes(num('cacheBytes'))} of ${formatBytes(num('cacheBudget'))}${speed > 0 ? ` · link ${formatBytes(speed)}/s${ratio ? ` (${ratio.toFixed(1)}× the file)` : ''}` : ''}`,
    });
  }
  const shown = num('renderedFrames');
  if (shown !== undefined)
    rows.push({
      label: 'Frames',
      value: `${shown} shown · ${num('droppedFrames') ?? 0} dropped`,
    });
  const javaHeap = num('javaHeap');
  const nativeHeap = num('nativeHeap');
  if (javaHeap !== undefined && nativeHeap !== undefined)
    rows.push({
      label: 'Memory',
      value: `Java ${formatBytes(javaHeap)} · native ${formatBytes(nativeHeap)}`,
    });
  if (cpu !== undefined)
    rows.push({ label: 'App CPU', value: `${Math.round(cpu)}% of a core` });
  return rows;
}
/* eslint-enable lingui/no-unlocalized-strings */

/** ExoPlayer draws no statistics, so the page asks the app for its numbers. */
export function exoStats(): EngineStats {
  let last: { cpuMs: number; atMs: number } | undefined;
  return {
    pages: [{ id: 'exo', label: t`Playback` }],
    async read() {
      const m = await ask({ type: 'player-stats' }, 'player-stats', {
        timeoutMs: 5000,
      });
      const cpu =
        last && m.atMs > last.atMs
          ? ((m.cpuMs - last.cpuMs) / (m.atMs - last.atMs)) * 100
          : undefined;
      last = m;
      return exoStatsRows(m.stats, cpu);
    },
  };
}
