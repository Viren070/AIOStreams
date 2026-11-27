/* eslint-disable lingui/no-unlocalized-strings -- YouTube's API */
import type { FetchPastCors, YouTubeStream } from '.';
import { appLog } from './shell/bridge';
import { rewriteMaster, type RewrittenSound } from './youtube-playlist';

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

/** Apple's headset's client, which hands a playlist of every size. */
const VISIONOS: Client = {
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
};

/** Android's client, whose muxed formats play wherever a playlist cannot. */
const ANDROID: Client = {
  name: 'ANDROID',
  id: '3',
  version: '20.10.41',
  userAgent: 'com.google.android.youtube/20.10.41 (Linux; U; Android 11) gzip',
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
};

const CLIENTS: Client[] = [VISIONOS, ANDROID];

const TIMEOUT_MS = 10_000;

/** Serves the playlist the page made, as an address a player reads. */
type Serve = (text: string, type: string) => Promise<string | null>;

interface StreamingData {
  hlsManifestUrl?: string;
  /** Muxed, which stop at 360p. */
  formats?: { url?: string; height?: number }[];
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

/** The muxed format with the most lines, as one without sound plays alone. */
function bestMuxed(
  formats: StreamingData['formats']
): { url: string; height: number } | null {
  let best: { url: string; height: number } | undefined;
  for (const format of formats ?? []) {
    const height = format.height ?? 0;
    if (!format.url || (best && height <= best.height)) continue;
    best = { url: format.url, height };
  }
  return best ?? null;
}

/** A playlist's type, which the service or the blob that carries it needs. */
const HLS = 'application/vnd.apple.mpegurl';

/**
 * The playlist's largest variant, as an address the TV's player reads: a TV
 * starts a playlist at its smallest variant, so the page hands it one, with
 * the sound stream that variant names kept beside it, playing its own
 * language, which the playlist's renditions don't mark.
 */
async function variantOf(
  via: FetchPastCors,
  url: string,
  original: string | undefined,
  serve: Serve | undefined
): Promise<{
  url: string;
  height: number;
  served: boolean;
  sound: RewrittenSound[];
} | null> {
  const late = new Promise<never>((_, fail) =>
    setTimeout(() => fail(new Error('no answer in time')), TIMEOUT_MS)
  );
  try {
    const read = via(url, { method: 'GET', headers: {} }).then(
      // The playlist's own address, after redirects, is what its links are relative to.
      async (response) => {
        const master = rewriteMaster(
          await response.text(),
          response.url,
          original
        );
        if (!master) return null;
        // A player reads an address, not the page's own memory, so the TV's
        // service holds the playlist; the page's own blob plays where it won't.
        const held = (await serve?.(master.text, HLS)) ?? null;
        return {
          url:
            held ?? URL.createObjectURL(new Blob([master.text], { type: HLS })),
          height: master.height,
          served: !!held,
          sound: master.sound,
        };
      }
    );
    const picked = await Promise.race([read, late]);
    if (picked) {
      appLog(
        'info',
        picked.served
          ? `youtube: the TV service serves the ${picked.height}p variant`
          : `youtube: playing the ${picked.height}p variant as a page blob`
      );
      const own = picked.sound.find((s) => s.original);
      const renditions = picked.sound
        .map((s) => `${s.lang ?? 'none'}${s.original ? '*' : ''}`)
        .join(' ');
      if (picked.sound.length)
        appLog(
          'info',
          own
            ? `youtube: the ${own.lang ?? 'unnamed'} original sound; ${renditions}`
            : `youtube: no original sound; ${renditions}`
        );
    } else appLog('info', 'youtube: no variant of the playlist has sound');
    return picked;
  } catch (error) {
    appLog('warn', `youtube playlist: ${String(error)}`);
    return null;
  }
}

async function ask(
  via: FetchPastCors,
  client: Client,
  videoId: string,
  variant: boolean,
  fallback?: () => Promise<string | null>,
  serve?: Serve
): Promise<YouTubeStream | null> {
  let visitor: string | null = null;
  let answer: Answer = {};
  for (let i = 0; i < 2; i++) {
    answer = await player(via, client, videoId, visitor);
    if (answer.playabilityStatus?.status === 'OK') {
      const streaming = answer.streamingData ?? {};
      const original = originalLanguage(streaming);
      if (client.hls && streaming.hlsManifestUrl) {
        if (!variant)
          return { url: streaming.hlsManifestUrl, originalLanguage: original };
        // The page picks, where the TV would start at the smallest; a
        // playlist without a sound variant falls back to a muxed format.
        const picked = await variantOf(
          via,
          streaming.hlsManifestUrl,
          original,
          serve
        );
        return picked
          ? {
              url: picked.url,
              originalLanguage: original,
              ...(fallback && { fallbackUrl: fallback }),
            }
          : null;
      }
      const muxed = bestMuxed(streaming.formats);
      if (muxed)
        appLog(
          'info',
          `youtube: playing the ${muxed.height}p muxed ${client.name} stream`
        );
      return muxed ? { url: muxed.url, originalLanguage: original } : null;
    }
    // Without a visitor id YouTube refuses, but hands one out for the next ask.
    visitor = answer.responseContext?.visitorData ?? null;
    if (!visitor) break;
  }
  // The last refusal, which leaves the video nothing to play.
  appLog(
    'info',
    `youtube ${client.name}: ${answer.playabilityStatus?.status ?? 'no answer'}`
  );
  return null;
}

/**
 * Asks YouTube's player API as its apps do. The links only play from the
 * address that asked, so the TV asks itself. `variant` makes the page pick a
 * playlist's own variant, for a TV that starts one at its smallest, with the
 * muxed stream held back until that fails and `serve` handing the variant it
 * picked to the TV's service to hold.
 */
export const youTubeResolver =
  (via: FetchPastCors, opts: { variant?: boolean; serve?: Serve } = {}) =>
  async (videoId: string): Promise<YouTubeStream | null> => {
    if (!/^[\w-]{11}$/.test(videoId)) return null;
    // The muxed stream, asked for only when the variant fails, so kept as a
    // promise of its own that a second failure reuses.
    let muxed: Promise<string | null> | null = null;
    const fallback = opts.variant
      ? () =>
          (muxed ??= ask(via, ANDROID, videoId, false).then(
            (stream) => stream?.url ?? null
          ))
      : undefined;
    for (const client of CLIENTS) {
      try {
        const stream = await ask(
          via,
          client,
          videoId,
          !!opts.variant,
          fallback,
          opts.serve
        );
        if (stream) return stream;
      } catch (error) {
        appLog('warn', `youtube ${client.name}: ${String(error)}`);
      }
    }
    return null;
  };
