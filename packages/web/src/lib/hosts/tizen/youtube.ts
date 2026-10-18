/**
 * A YouTube video's stream for a trailer, asked of its player API as the
 * desktop app's `core/src/youtube.rs` and the Android app's `YouTube.kt` ask,
 * with the same clients. The packaged TV app may ask across origins (its
 * `config.xml` grants `<access origin="*">`); a page can't set the
 * `User-Agent` they send, so the TV's own goes. What fails goes to the
 * console, which Tizen Studio's inspector shows.
 *
 * AVPlay plays only an HLS playlist's first size, YouTube's smallest, so the
 * separate H.264 and AAC files are handed over as a DASH manifest instead,
 * for the page's video to play through Shaka (`playback/dash.ts`); HLS, then
 * the 360p muxed format, are what's left where those are missing.
 */
/* eslint-disable lingui/no-unlocalized-strings -- YouTube's API and console notes, not text a person reads */
import {
  dashAddress,
  dashManifest,
  type DashStream,
} from '../../playback/dash';

interface Client {
  name: string;
  id: string;
  version: string;
  key?: string;
  fields: Record<string, string>;
}

const CLIENTS: Client[] = [
  {
    name: 'VISIONOS',
    id: '101',
    version: '1.02',
    fields: {
      deviceMake: 'Apple',
      deviceModel: 'RealityDevice17,1',
      osName: 'visionOS',
      osVersion: '26.5.23O471',
    },
  },
  {
    name: 'ANDROID',
    id: '3',
    version: '20.10.41',
    key: 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w',
    fields: {
      deviceMake: 'Google',
      deviceModel: 'Pixel 5',
      osName: 'Android',
      osVersion: '11',
      androidSdkVersion: '30',
      platform: 'MOBILE',
    },
  },
];

const TIMEOUT_MS = 10_000;
/** The TV's own size; above it a file only costs the connection. */
const MAX_HEIGHT = 1080;

interface Range {
  start: string;
  end: string;
}

interface Format {
  itag?: number;
  url?: string;
  mimeType?: string;
  bitrate?: number;
  width?: number;
  height?: number;
  initRange?: Range;
  indexRange?: Range;
  approxDurationMs?: string;
  audioTrack?: { audioIsDefault?: boolean };
}

interface Answer {
  playabilityStatus?: { status?: string; reason?: string };
  streamingData?: {
    hlsManifestUrl?: string;
    formats?: Format[];
    adaptiveFormats?: Format[];
  };
  responseContext?: { visitorData?: string };
}

function tell(text: string): void {
  console.warn(`youtube: ${text}`);
}

/**
 * What AVPlay is to be told of an adaptive stream before it prepares it: to
 * start on its largest size, which Tizen 6's AVPlay doesn't heed.
 */
export function adaptiveInfo(url: string): string | null {
  return /^https?:/i.test(url) && /\.m3u8|\/manifest\//i.test(url)
    ? 'STARTBITRATE=HIGHEST|SKIPBITRATE=LOWEST'
    : null;
}

async function player(
  client: Client,
  videoId: string,
  visitor: string | null
): Promise<Answer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const key = client.key ? `key=${client.key}&` : '';
    const response = await fetch(
      `https://www.youtube.com/youtubei/v1/player?${key}prettyPrint=false`,
      {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-YouTube-Client-Name': client.id,
          'X-YouTube-Client-Version': client.version,
          ...(visitor && { 'X-Goog-Visitor-Id': visitor }),
        },
        body: JSON.stringify({
          videoId,
          context: {
            client: {
              clientName: client.name,
              clientVersion: client.version,
              hl: 'en',
              gl: 'US',
              ...(visitor && { visitorData: visitor }),
              ...client.fields,
            },
          },
          contentCheckOk: true,
          racyCheckOk: true,
        }),
      }
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as Answer;
  } finally {
    clearTimeout(timer);
  }
}

/** The client's streams for the video, or null where it refuses. */
async function ask(
  client: Client,
  videoId: string
): Promise<NonNullable<Answer['streamingData']> | null> {
  let visitor: string | null = null;
  for (let i = 0; i < 2; i++) {
    const answer = await player(client, videoId, visitor);
    if (answer.playabilityStatus?.status === 'OK' && answer.streamingData)
      return answer.streamingData;
    // Without a visitor id YouTube refuses, but hands one out for the next ask.
    visitor = answer.responseContext?.visitorData ?? null;
    if (!visitor) {
      tell(
        `${client.name} ${answer.playabilityStatus?.status ?? '?'} ${answer.playabilityStatus?.reason ?? ''}`
      );
      return null;
    }
  }
  tell(`${client.name}: refused twice`);
  return null;
}

function stream(format: Format): DashStream | null {
  const { url, mimeType, initRange, indexRange } = format;
  const [, mime, codecs] =
    /^([^;]+);\s*codecs="([^"]+)"/.exec(mimeType ?? '') ?? [];
  if (!url || !mime || !codecs || !initRange || !indexRange) return null;
  return {
    id: String(format.itag ?? codecs),
    url,
    mime,
    codecs,
    bandwidth: format.bitrate ?? 0,
    width: format.width,
    height: format.height,
    init: { start: Number(initRange.start), end: Number(initRange.end) },
    index: { start: Number(indexRange.start), end: Number(indexRange.end) },
  };
}

/** A DASH manifest of the H.264 sizes up to 1080p and the default AAC audio. */
function dashOf(formats: Format[]): string | null {
  const video = formats
    .filter(
      (f) =>
        f.mimeType?.startsWith('video/mp4') &&
        f.mimeType.includes('avc1') &&
        !!f.height &&
        f.height <= MAX_HEIGHT
    )
    .map(stream)
    .filter((s): s is DashStream => !!s);
  const aac = formats.filter(
    (f) => f.mimeType?.startsWith('audio/mp4') && f.mimeType.includes('mp4a')
  );
  // The video's own language over a dub, then the fullest AAC (itag 140).
  const chosen =
    aac
      .filter((f) => f.audioTrack?.audioIsDefault !== false)
      .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0] ?? aac[0];
  const audio = chosen ? stream(chosen) : null;
  const durationMs = Number(
    formats.find((f) => f.approxDurationMs)?.approxDurationMs ?? 0
  );
  if (!video.length || !audio || !durationMs) return null;
  const top = Math.max(...video.map((v) => v.height ?? 0));
  tell(`dash ${top}p, ${video.length} sizes`);
  return dashAddress(dashManifest(durationMs, video, [audio]));
}

export async function resolveYouTube(videoId: string): Promise<string | null> {
  if (!/^[\w-]{11}$/.test(videoId)) return null;
  for (const client of CLIENTS) {
    try {
      const streaming = await ask(client, videoId);
      if (!streaming) continue;
      const dash = dashOf(streaming.adaptiveFormats ?? []);
      if (dash) return dash;
      const fallback =
        streaming.hlsManifestUrl ?? streaming.formats?.find((f) => f.url)?.url;
      if (fallback) {
        tell(
          `${client.name}: no DASH, ${streaming.hlsManifestUrl ? 'HLS' : '360p'}`
        );
        return fallback;
      }
    } catch (e) {
      tell(`${client.name} ${(e as Error).message || String(e)}`);
    }
  }
  return null;
}
