import { featureFiles } from '../../debrid/utils.js';
import { torrentKey } from '../../release-blocklist/keys.js';
import {
  MediaInfoRecordSchema,
  type MediaInfoRecord,
  type MediaTrack,
} from '../record.js';
import { queueReport, storesFrom } from './queue.js';

/** StremThru's per-file `media_info`, as its magnet checks return it. */
interface WireMediaInfo {
  video?: { codec?: unknown; hdr?: unknown; h?: unknown; w?: unknown };
  audio?: Record<string, unknown>[];
  subtitle?: Record<string, unknown>[];
  format?: { n?: unknown; dur?: unknown; s?: unknown; br?: unknown };
  has_chapters?: unknown;
  /** Empty when StremThru probed the file itself, else the store that told it. */
  src?: unknown;
  v?: unknown;
}

export interface StremThruCheckedItem {
  hash: string;
  files: {
    name: string;
    path?: string;
    size: number;
    index: number;
    media_info?: unknown;
  }[];
}

const text = (v: unknown) =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;
const count = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
const flag = (v: unknown) => (v === true ? true : undefined);

export function fromWireMediaInfo(
  wire: WireMediaInfo
): MediaInfoRecord | undefined {
  const tracks: MediaTrack[] = [];
  if (wire.video) {
    const hdr = Array.isArray(wire.video.hdr)
      ? wire.video.hdr.flatMap((t) => text(t) ?? [])
      : [];
    // Fields in the prober's order, which packed records compress best in.
    tracks.push({
      index: tracks.length,
      codec: text(wire.video.codec),
      type: 'video',
      width: count(wire.video.w),
      height: count(wire.video.h),
      hdr: hdr.length ? hdr : undefined,
    });
  }
  for (const a of wire.audio ?? []) {
    tracks.push({
      index: tracks.length,
      codec: text(a.codec),
      profile: text(a.profile),
      language: text(a.lang),
      title: text(a.title),
      default: flag(a.default),
      hearingImpaired: flag(a.hearing_impaired),
      visualImpaired: flag(a.visual_impaired),
      commentary: flag(a.commentary),
      dub: flag(a.dub),
      original: flag(a.original),
      type: 'audio',
      channels: count(a.ch),
      channelLayout: text(a.ch_layout),
    });
  }
  for (const s of wire.subtitle ?? []) {
    tracks.push({
      index: tracks.length,
      codec: text(s.codec),
      language: text(s.lang),
      title: text(s.title),
      default: flag(s.default),
      forced: flag(s.forced),
      hearingImpaired: flag(s.hearing_impaired),
      type: 'subtitle',
    });
  }
  if (!tracks.some((t) => t.type !== 'video')) return undefined;
  const nanos = count(wire.format?.dur);
  const parsed = MediaInfoRecordSchema.safeParse({
    container: text(wire.format?.n),
    duration: nanos ? nanos / 1e9 : undefined,
    size: count(wire.format?.s),
    bitrate: count(wire.format?.br),
    chapters: wire.has_chapters === true,
    tracks,
    reportedBy: text(wire.src) ?? 'ffprobe',
  });
  return parsed.success ? parsed.data : undefined;
}

/** A multi-file torrent's paths start with its folder, which names it. */
function titleOf(item: StremThruCheckedItem): string | undefined {
  const segments = item.files[0]?.path?.split('/').filter(Boolean) ?? [];
  return segments.length > 1 ? segments[0] : undefined;
}

/** What would make a report worth writing again. */
function stampOf(wire: WireMediaInfo): string {
  return `${wire.v ?? ''}|${wire.src ?? ''}|${wire.audio?.length ?? 0}|${wire.subtitle?.length ?? 0}|${wire.format?.dur ?? ''}`;
}

export function queueStremThruMediaInfo(items: StremThruCheckedItem[]): void {
  if (!storesFrom('stremthru')) return;
  for (const item of items) {
    const releaseKey = torrentKey(item.hash);
    if (!releaseKey) continue;
    let releaseFiles: number | undefined;
    for (const file of item.files) {
      if (!file.media_info || typeof file.media_info !== 'object') continue;
      const wire = file.media_info as WireMediaInfo;
      queueReport(
        'stremthru',
        `${releaseKey}/${file.index}`,
        stampOf(wire),
        () => ({
          releaseKeys: [releaseKey],
          file: file.name,
          size: file.size,
          releaseFiles: (releaseFiles ??= featureFiles(item.files).length),
          title: titleOf(item),
          record: () => fromWireMediaInfo(wire),
        })
      );
    }
  }
}
