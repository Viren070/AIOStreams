/* eslint-disable lingui/no-unlocalized-strings -- YouTube's API */
import type { FetchPastCors, YouTubeStream } from '.';
import { appLog } from './shell/bridge';

interface Client {
  name: string;
  id: string;
  version: string;
  userAgent: string;
  key?: string;
  fields: Record<string, string>;
  /** Every size; the muxed formats stop at 360p. */
  hls: boolean;
}

const CLIENTS: Client[] = [
  {
    name: 'VISIONOS',
    id: '101',
    version: '1.02',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
    fields: {
      deviceMake: 'Apple',
      deviceModel: 'RealityDevice17,1',
      osName: 'visionOS',
      osVersion: '26.5.23O471',
    },
    hls: true,
  },
  {
    name: 'ANDROID',
    id: '3',
    version: '20.10.41',
    userAgent:
      'com.google.android.youtube/20.10.41 (Linux; U; Android 11) gzip',
    key: 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w',
    fields: {
      deviceMake: 'Google',
      deviceModel: 'Pixel 5',
      osName: 'Android',
      osVersion: '11',
      androidSdkVersion: '30',
      platform: 'MOBILE',
    },
    hls: false,
  },
];

const TIMEOUT_MS = 10_000;

interface StreamingData {
  hlsManifestUrl?: string;
  formats?: { url?: string }[];
  adaptiveFormats?: {
    audioTrack?: { id?: string; audioIsDefault?: boolean };
  }[];
}

interface Answer {
  playabilityStatus?: { status?: string };
  streamingData?: StreamingData;
  responseContext?: { visitorData?: string };
}

/** The original audio's language, which a manifest with dubs doesn't mark. */
function originalLanguage(streaming: StreamingData): string | undefined {
  const track = streaming.adaptiveFormats?.find(
    (format) => format.audioTrack?.audioIsDefault
  )?.audioTrack;
  // Such as `en-US.4`.
  return track?.id?.split('.')[0];
}

function player(
  via: FetchPastCors,
  client: Client,
  videoId: string,
  visitor: string | null
): Promise<Answer> {
  const key = client.key ? `key=${client.key}&` : '';
  const asked = via(
    `https://www.youtube.com/youtubei/v1/player?${key}prettyPrint=false`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // A page's own fetch drops these three; a TV's service sends them.
        'User-Agent': client.userAgent,
        Origin: 'https://www.youtube.com',
        Referer: 'https://www.youtube.com/',
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
  ).then((response) => response.json() as Promise<Answer>);
  const late = new Promise<never>((_, fail) =>
    setTimeout(() => fail(new Error('no answer in time')), TIMEOUT_MS)
  );
  return Promise.race([asked, late]);
}

async function ask(
  via: FetchPastCors,
  client: Client,
  videoId: string
): Promise<YouTubeStream | null> {
  let visitor: string | null = null;
  for (let i = 0; i < 2; i++) {
    const answer = await player(via, client, videoId, visitor);
    if (answer.playabilityStatus?.status === 'OK') {
      const streaming = answer.streamingData ?? {};
      const url = client.hls
        ? streaming.hlsManifestUrl
        : streaming.formats?.find((f) => f.url)?.url;
      return url
        ? { url, originalLanguage: originalLanguage(streaming) }
        : null;
    }
    // Without a visitor id YouTube refuses, but hands one out for the next ask.
    visitor = answer.responseContext?.visitorData ?? null;
    if (!visitor) return null;
  }
  return null;
}

/** Asks YouTube's player API as its apps do. The links only play from the address that asked, so the TV asks itself. */
export const youTubeResolver =
  (via: FetchPastCors) =>
  async (videoId: string): Promise<YouTubeStream | null> => {
    if (!/^[\w-]{11}$/.test(videoId)) return null;
    for (const client of CLIENTS) {
      try {
        const stream = await ask(via, client, videoId);
        if (stream) return stream;
      } catch (error) {
        appLog('warn', `youtube ${client.name}: ${String(error)}`);
      }
    }
    return null;
  };
