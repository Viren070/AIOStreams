import type { JellyfinClient } from '../client';
import { backdropUrl, logoUrl, posterUrl } from '../images';
import { textSubtitles, subtitleUrl } from '../subtitles/tracks';
import type { BaseItemDto, SourceInfo } from '../types';
import type { HostFile, HostJob } from './types';

/** What the desktop app accepts; anything else is saved as Matroska, which players sniff anyway. */
const VIDEO_TYPES = new Set([
  'mkv',
  'mp4',
  'm4v',
  'avi',
  'mov',
  'webm',
  'ts',
  'm2ts',
  'wmv',
  'flv',
  'mpg',
  'mpeg',
  'ogv',
  '3gp',
]);

const SUBTITLE_TYPES = new Set(['srt', 'vtt', 'ass', 'ssa', 'sub', 'sup']);

/** A file or folder name every system takes. */
export function cleanName(name: string): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 120);
  if (!cleaned) return 'Untitled';
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(cleaned)
    ? `_${cleaned}`
    : cleaned;
}

const pad = (n: number) => String(n).padStart(2, '0');

function videoType(source: SourceInfo): string {
  const named = source.aiostreams?.filename?.split('.').pop()?.toLowerCase();
  if (named && VIDEO_TYPES.has(named)) return named;
  const container = source.Container?.split(',')
    .map((c) => c.trim().toLowerCase())
    .find((c) => VIDEO_TYPES.has(c));
  return container ?? 'mkv';
}

/** Where an item goes, named the way media servers expect, so the folder works in one too. */
export function placeOf(
  item: BaseItemDto,
  series: BaseItemDto | undefined
): { folder: string; base: string; showFolder?: string } {
  if (item.Type !== 'Episode') {
    const name = cleanName(
      item.ProductionYear
        ? `${item.Name} (${item.ProductionYear})`
        : `${item.Name}`
    );
    return { folder: `Movies/${name}`, base: name };
  }
  const year = series?.ProductionYear;
  const show = cleanName(
    `${item.SeriesName ?? series?.Name ?? 'Show'}${year ? ` (${year})` : ''}`
  );
  const season = item.ParentIndexNumber ?? 0;
  const numbers =
    item.IndexNumber == null
      ? ''
      : `S${pad(season)}E${pad(item.IndexNumber)}${item.IndexNumberEnd ? `-E${pad(item.IndexNumberEnd)}` : ''}`;
  const base = cleanName(
    [show, numbers, item.Name].filter(Boolean).join(' - ')
  );
  return {
    showFolder: `Shows/${show}`,
    folder: `Shows/${show}/Season ${pad(season)}`,
    base,
  };
}

function subtitleFiles(
  client: JellyfinClient,
  source: SourceInfo,
  at: string
): HostFile[] {
  const used = new Set<string>();
  const files: HostFile[] = [];
  for (const stream of textSubtitles(source)) {
    const url = subtitleUrl(client, stream, { original: true });
    const type = url?.match(/Stream\.(\w+)(?=\?|$)/)?.[1]?.toLowerCase();
    if (!url || !type || !SUBTITLE_TYPES.has(type)) continue;
    const tags = [stream.Language || 'und', stream.IsForced && 'forced']
      .filter(Boolean)
      .join('.');
    // Two of one language get a number, as players read the language from the name.
    let name = `${at}.${tags}`;
    for (let n = 2; used.has(name); n++) name = `${at}.${n}.${tags}`;
    used.add(name);
    files.push({ url, path: `${name}.${type}`, kind: 'subtitle' });
  }
  return files;
}

function imageFiles(
  client: JellyfinClient,
  item: BaseItemDto,
  series: BaseItemDto | undefined,
  place: ReturnType<typeof placeOf>
): HostFile[] {
  const owner = series ?? item;
  const root = place.showFolder ?? place.folder;
  const files: HostFile[] = [];
  const add = (url: string | null, path: string) => {
    if (url) files.push({ url, path, kind: 'image' });
  };
  add(posterUrl(client, owner, { maxWidth: 1000 }), `${root}/poster.jpg`);
  add(backdropUrl(client, owner, { maxWidth: 1920 }), `${root}/fanart.jpg`);
  add(logoUrl(client, owner, { maxWidth: 800 }), `${root}/clearlogo.png`);
  if (item.Type === 'Episode' && item.ImageTags?.Primary)
    add(
      client.url(`/Items/${item.Id}/Images/Primary`, {
        tag: item.ImageTags.Primary,
        maxWidth: 960,
      }),
      `${place.folder}/${place.base}-thumb.jpg`
    );
  return files;
}

/** The version's details without its addresses, which carry the sign-in. */
function versionDetails(source: SourceInfo) {
  const { Path: _path, TranscodingUrl: _transcode, ...rest } = source;
  return {
    ...rest,
    MediaStreams: source.MediaStreams?.map(({ DeliveryUrl: _url, ...s }) => s),
  };
}

/** Everything a download saves: the video, its subtitles, art and details. */
export function hostJob(
  client: JellyfinClient,
  id: string,
  item: BaseItemDto,
  series: BaseItemDto | undefined,
  source: SourceInfo,
  opts: { subtitles: boolean }
): HostJob {
  const place = placeOf(item, series);
  const at = `${place.folder}/${place.base}`;
  const video = client.url(`/Items/${item.Id}/Download`, {
    MediaSourceId: source.Id,
    ApiKey: client.token,
  });
  return {
    id,
    title: place.base,
    files: [
      { url: video, path: `${at}.${videoType(source)}`, kind: 'video' },
      ...(opts.subtitles ? subtitleFiles(client, source, at) : []),
      ...imageFiles(client, item, series, place),
    ],
    texts: [
      {
        path: `${at}.json`,
        text: JSON.stringify(
          { item, series, version: versionDetails(source) },
          null,
          2
        ),
      },
    ],
  };
}
