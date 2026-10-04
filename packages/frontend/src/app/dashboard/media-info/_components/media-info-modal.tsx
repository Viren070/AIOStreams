import React from 'react';
import { toast } from 'sonner';
import { BiCopy } from 'react-icons/bi';
import { Modal } from '@aiostreams/ui/modal';
import { IconButton } from '@aiostreams/ui/button';
import { Tooltip } from '@aiostreams/ui/tooltip';
import { cn } from '@aiostreams/ui/core/styling';
import { copyToClipboard } from '@aiostreams/ui/utils/clipboard';
import {
  formatBitrate,
  formatBytes,
  formatDateTime,
  formatDuration,
} from '@aiostreams/ui/core/format';
import type { MediaInfoRecord, ProbedFile } from '../queries';

type Track = MediaInfoRecord['tracks'][number];
type VideoTrack = Extract<Track, { type: 'video' }>;

const CODEC_NAMES: Record<string, string> = {
  hevc: 'HEVC',
  h264: 'H.264',
  av1: 'AV1',
  vp9: 'VP9',
  mpeg2video: 'MPEG-2',
  mpeg4: 'MPEG-4',
  vc1: 'VC-1',
  truehd: 'TrueHD',
  eac3: 'E-AC-3',
  ac3: 'AC-3',
  dts: 'DTS',
  aac: 'AAC',
  flac: 'FLAC',
  opus: 'Opus',
  mp3: 'MP3',
  vorbis: 'Vorbis',
  pcm_s16le: 'PCM',
  pcm_s24le: 'PCM',
  subrip: 'SRT',
  ass: 'ASS',
  ssa: 'SSA',
  webvtt: 'WebVTT',
  mov_text: 'Timed text',
  hdmv_pgs_subtitle: 'PGS',
  dvd_subtitle: 'VobSub',
  dvb_subtitle: 'DVB',
};

export function codecName(codec?: string): string {
  if (!codec) return 'Unknown';
  return CODEC_NAMES[codec] ?? codec.toUpperCase();
}

const languageNames = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' });
  } catch {
    return undefined;
  }
})();

export function languageName(code?: string): string | undefined {
  if (!code || code === 'und') return undefined;
  try {
    return languageNames?.of(code) ?? code;
  } catch {
    return code;
  }
}

export function resolutionLabel(v: VideoTrack): string | undefined {
  if (!v.width || !v.height) return undefined;
  // Scope films are short for their width, so judge by either side.
  if (v.width >= 3200 || v.height >= 1800) return '2160p';
  if (v.width >= 1800 || v.height >= 1000) return '1080p';
  if (v.width >= 1200 || v.height >= 700) return '720p';
  return `${v.height}p`;
}

const REPORTED_HDR: Record<string, string> = {
  dv: 'DV',
  'hdr10+': 'HDR10+',
  hdr10: 'HDR10',
  hlg: 'HLG',
  hdr: 'HDR',
};

export function hdrLabels(v: VideoTrack): string[] {
  if (v.hdr) {
    return v.hdr.map((tag) => REPORTED_HDR[tag.toLowerCase()] ?? tag);
  }
  const out: string[] = [];
  if (v.dvProfile !== undefined) out.push(`DV P${v.dvProfile}`);
  if (v.hdr10Plus) out.push('HDR10+');
  else if (v.colorTransfer === 'smpte2084') out.push('HDR10');
  if (v.colorTransfer === 'arib-std-b67') out.push('HLG');
  return out;
}

/** The base filename; packs name files by their path inside the post. */
export function baseName(file: string): string {
  return file.split(/[\\/]/).pop() || file;
}

export function sourceLabel(file: ProbedFile): string {
  if (file.origin === 'local') return 'This instance';
  const name = file.origin === 'stremthru' ? 'StremThru' : file.origin;
  const by = file.info.reportedBy;
  if (!by || by === 'ffprobe') return name;
  return `${name}, reported by ${by === 'rd' ? 'Real-Debrid' : by}`;
}

export function isTorrent(file: ProbedFile): boolean {
  return file.releaseKey.startsWith('btih:');
}

function Chip({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'brand';
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium',
        tone === 'brand'
          ? 'border-brand/40 bg-brand/10 text-brand'
          : 'border-[--border] text-[--muted]'
      )}
    >
      {children}
    </span>
  );
}

function flagChips(t: Track): string[] {
  const flags: string[] = [];
  if (t.default) flags.push('Default');
  if (t.forced) flags.push('Forced');
  if (t.hearingImpaired) flags.push('SDH');
  if (t.visualImpaired) flags.push('Audio description');
  if (t.commentary) flags.push('Commentary');
  if (t.original) flags.push('Original');
  if (t.dub) flags.push('Dub');
  return flags;
}

function channelsLabel(channels?: number, layout?: string): string | undefined {
  if (layout) return layout;
  if (!channels) return undefined;
  if (channels === 1) return 'Mono';
  if (channels === 2) return 'Stereo';
  return `${channels} ch`;
}

function trackFacts(t: Track): string[] {
  const facts = [codecName(t.codec)];
  if (t.profile && t.profile.toLowerCase() !== t.codec?.toLowerCase()) {
    facts.push(t.profile);
  }
  if (t.type === 'video') {
    if (t.width && t.height) facts.push(`${t.width}×${t.height}`);
    if (t.bitDepth) facts.push(`${t.bitDepth}-bit`);
    const fps = t.avgFps ?? t.fps;
    if (fps) facts.push(`${parseFloat(fps.toFixed(3))} fps`);
    if (t.interlaced) facts.push('Interlaced');
  } else if (t.type === 'audio') {
    const channels = channelsLabel(t.channels, t.channelLayout);
    if (channels) facts.push(channels);
    if (t.sampleRate) facts.push(`${t.sampleRate / 1000} kHz`);
  }
  if (t.bitrate) facts.push(formatBitrate(t.bitrate));
  return facts;
}

function TrackRow({ track }: { track: Track }) {
  const language = languageName(track.language);
  const hdr = track.type === 'video' ? hdrLabels(track) : [];
  const flags = flagChips(track);
  return (
    <li className="flex gap-3 py-2">
      <span className="w-6 shrink-0 pt-0.5 text-right font-mono text-xs text-[--muted]">
        {track.index}
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm">
          {trackFacts(track).join(' · ')}
          {language && (
            <span className="text-[--muted]" title={track.language}>
              {' · '}
              {language}
            </span>
          )}
        </p>
        {track.title && (
          <p className="text-xs text-[--muted] break-words">{track.title}</p>
        )}
        {(hdr.length > 0 || flags.length > 0) && (
          <div className="flex flex-wrap gap-1">
            {hdr.map((label) => (
              <Chip key={label} tone="brand">
                {label}
              </Chip>
            ))}
            {flags.map((label) => (
              <Chip key={label}>{label}</Chip>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

function TrackSection({ title, tracks }: { title: string; tracks: Track[] }) {
  if (tracks.length === 0) return null;
  return (
    <section>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-[--muted]">
        {title}
        <span className="ml-1.5 font-normal tabular-nums">{tracks.length}</span>
      </h4>
      <ol className="divide-y divide-[--border]/40">
        {tracks.map((t) => (
          <TrackRow key={t.index} track={t} />
        ))}
      </ol>
    </section>
  );
}

function Fact({ label, value }: { label: string; value?: React.ReactNode }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-[--muted]">
        {label}
      </dt>
      <dd className="text-sm break-words">{value}</dd>
    </div>
  );
}

const KEY_HINT: Record<string, string> = {
  btih: 'Torrent info hash',
  nh1: 'Exact NZB content hash',
  wd1: 'Release fingerprint from indexer metadata',
  nu1: 'NZB URL without credentials',
};

/** Every key the probe is stored under; a stream matches on any of them. */
function KeyList({ keys }: { keys: string[] }) {
  return (
    <section>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-[--muted]">
        Stored under
      </h4>
      <ul className="mt-1 divide-y divide-[--border]/40">
        {keys.map((key) => (
          <li key={key} className="flex items-center gap-2 py-1.5">
            <Tooltip
              side="left"
              trigger={
                <span className="min-w-0 cursor-default break-all font-mono text-xs">
                  {key}
                </span>
              }
            >
              {KEY_HINT[key.split(':')[0]] ?? 'Release key'}
            </Tooltip>
            <IconButton
              size="xs"
              intent="gray-subtle"
              icon={<BiCopy />}
              aria-label="Copy key"
              className="ml-auto shrink-0"
              onClick={() =>
                void copyToClipboard(key, {
                  onSuccess: () => toast.success('Key copied'),
                  onError: () => toast.error('Copy failed'),
                })
              }
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function MediaInfoModal({
  file,
  open,
  onOpenChange,
}: {
  file: ProbedFile | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!file) return null;
  const { info } = file;
  const kind = isTorrent(file) ? 'Torrent' : 'NZB';
  const release = file.title ?? file.nzbName;
  const size = info.size ?? file.size;
  const byType = (type: Track['type']) =>
    info.tracks.filter((t) => t.type === type);
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Media info"
      description={<span className="break-all">{baseName(file.file)}</span>}
      contentClass="max-w-2xl"
    >
      <div className="space-y-5">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <Fact label="Container" value={info.container} />
          <Fact
            label="Duration"
            value={info.duration ? formatDuration(info.duration) : undefined}
          />
          <Fact
            label="Size"
            value={
              size ? (
                <span title={`${size.toLocaleString()} bytes`}>
                  {formatBytes(size)}
                </span>
              ) : undefined
            }
          />
          <Fact
            label="Bitrate"
            value={info.bitrate ? formatBitrate(info.bitrate) : undefined}
          />
          <Fact label="Chapters" value={info.chapters ? 'Yes' : 'No'} />
          <Fact
            label="Stored"
            value={formatDateTime(new Date(file.updatedAt).toISOString())}
          />
          <Fact label="Measured by" value={sourceLabel(file)} />
          <Fact label="Record version" value={file.version} />
          {file.file !== baseName(file.file) && (
            <div className="col-span-2 sm:col-span-3">
              <Fact
                label="Path"
                value={<span className="break-all">{file.file}</span>}
              />
            </div>
          )}
          {release && (
            <div className="col-span-2 sm:col-span-3">
              <Fact
                label={
                  file.releaseFiles > 1
                    ? `${kind} · ${file.releaseFiles} files`
                    : kind
                }
                value={<span className="break-all">{release}</span>}
              />
            </div>
          )}
        </dl>
        <KeyList keys={file.keys} />
        <TrackSection title="Video" tracks={byType('video')} />
        <TrackSection title="Audio" tracks={byType('audio')} />
        <TrackSection title="Subtitles" tracks={byType('subtitle')} />
      </div>
    </Modal>
  );
}
