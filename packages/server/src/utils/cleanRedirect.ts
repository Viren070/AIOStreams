import type { Request } from 'express';
import {
  Env,
  constants,
  encryptString,
  type AIOStreamResponse,
  type ParsedStream,
  type UserData,
} from '@aiostreams/core';

type RedirectCode = 302 | 307 | 308;

export type CleanRedirectPayload = {
  url: string;
  redirectCode?: RedirectCode;
};

export function decodeRepeatedly(value: string, max = 4): string {
  let current = String(value || '');

  for (let i = 0; i < max; i++) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) break;
      current = decoded;
    } catch {
      break;
    }
  }

  return current;
}

export function sanitizeFilename(
  input: string,
  fallback = 'stream.mkv'
): string {
  let name = decodeRepeatedly(input || fallback);

  name = name
    .split('?')[0]
    .split('#')[0]
    .replace(/[\r\n"]/g, '')
    .replace(/[\\/]/g, '_')
    .replace(/[<>:"|?*\x00-\x1F]/g, '')
    .replace(/\+/g, ' ')
    .replace(/\s+/g, '.')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .trim();

  if (!name) {
    name = fallback;
  }

  if (!/\.(mkv|mp4|avi|mov|m4v|webm)$/i.test(name)) {
    name += '.mkv';
  }

  return name;
}

export function isValidHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function getBaseUrl(req: Request<any>): string {
  return (
    Env.BASE_URL ||
    `${req.protocol}://${req.hostname}${
      req.hostname === 'localhost' ? `:${Env.PORT}` : ''
    }`
  );
}

function isInternalMetadataStream(
  stream: AIOStreamResponse['streams'][number]
): boolean {
  const type = stream.streamData?.type;
  return (
    type === constants.ERROR_STREAM_TYPE ||
    type === constants.STATISTIC_STREAM_TYPE
  );
}

export function wrapStreamsWithCleanRedirectGate(
  result: AIOStreamResponse,
  parsedStreams: ParsedStream[],
  userData: UserData,
  req: Request<any>
): AIOStreamResponse {
  const config = userData.cleanRedirectOutput;

  if (!config?.enabled) {
    return result;
  }

  const redirectCode = config.redirectCode ?? 307;
  const baseUrl = getBaseUrl(req).replace(/\/+$/, '');
  let originalStreamIndex = 0;

  return {
    ...result,
    streams: result.streams.map((stream) => {
      const parsed = isInternalMetadataStream(stream)
        ? undefined
        : parsedStreams[originalStreamIndex++];

      if (!stream.url || !isValidHttpUrl(stream.url)) {
        return stream;
      }

      const filename = sanitizeFilename(
        parsed?.filename ||
          stream.behaviorHints?.filename ||
          `stream-${originalStreamIndex}.mkv`
      );

      const encrypted = encryptString(
        JSON.stringify({
          url: stream.url,
          redirectCode,
        } satisfies CleanRedirectPayload)
      );

      if (!encrypted.success || !encrypted.data) {
        return stream;
      }

      return {
        ...stream,
        url: `${baseUrl}/api/v${constants.API_VERSION}/stream-gate/${encrypted.data}/${encodeURIComponent(filename)}`,
        behaviorHints: {
          ...stream.behaviorHints,
          filename,
          videoFilename: filename,
        },
      };
    }),
  };
}
