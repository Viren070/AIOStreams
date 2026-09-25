import type { JellyfinClient } from './client';
import { TICKS_PER_MS } from './format';
import { storage } from './storage';
import type { MediaStream, SourceInfo } from './types';

/**
 * The server's stream route. A player cannot send the sign-in header, so the
 * token rides in the query, which servers that guard the route require.
 */
export function streamUrl(
  client: JellyfinClient,
  itemId: string,
  source: SourceInfo,
  playSessionId?: string | null
): string {
  return client.url(`/Videos/${itemId}/stream`, {
    static: true,
    MediaSourceId: source.Id,
    PlaySessionId: playSessionId,
    ApiKey: client.token,
  });
}

/** The source's own address, which outlives this session. */
export function directUrl(
  client: JellyfinClient,
  itemId: string,
  source: SourceInfo
): string {
  return source.Path && /^https?:\/\//i.test(source.Path)
    ? source.Path
    : streamUrl(client, itemId, source);
}

export function textSubtitles(source: SourceInfo): MediaStream[] {
  return (source.MediaStreams ?? []).filter(
    (s) => s.Type === 'Subtitle' && s.DeliveryMethod === 'External'
  );
}

/** An absolute WebVTT address for an external subtitle stream. */
export function subtitleUrl(
  client: JellyfinClient,
  stream: MediaStream
): string | null {
  if (!stream.DeliveryUrl) return null;
  return new URL(
    client.url(stream.DeliveryUrl.replace(/Stream\.\w+$/, 'Stream.vtt')),
    window.location.origin
  ).toString();
}

const EXTERNAL_PLAYER_KEY = 'aiostreams-web-external-player';

/** A URL template with `{url}` or `{encodedUrl}`, kept per device. */
export function externalPlayerTemplate(): string {
  return storage.get<string>(EXTERNAL_PLAYER_KEY) ?? '';
}

export function setExternalPlayerTemplate(template: string): void {
  if (template.trim()) storage.set(EXTERNAL_PLAYER_KEY, template.trim());
  else storage.remove(EXTERNAL_PLAYER_KEY);
}

export function externalPlayerUrl(template: string, url: string): string {
  if (template.includes('{encodedUrl}'))
    return template.replace('{encodedUrl}', encodeURIComponent(url));
  if (template.includes('{url}')) return template.replace('{url}', url);
  return `${template}${url}`;
}

const PROGRESS_EVERY_MS = 10_000;

/**
 * Reports a playback the way a Jellyfin client does, so it shows as playing,
 * resumes later and reaches the trackers.
 */
export class PlaybackReporter {
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor(
    private readonly client: JellyfinClient,
    private readonly info: {
      itemId: string;
      mediaSourceId: string;
      playSessionId?: string | null;
    },
    private readonly position: () => { ms: number; paused: boolean }
  ) {}

  private body(extra: Record<string, unknown> = {}) {
    const { ms, paused } = this.position();
    return {
      ItemId: this.info.itemId,
      MediaSourceId: this.info.mediaSourceId,
      PlaySessionId: this.info.playSessionId ?? undefined,
      PositionTicks: Math.round(ms) * TICKS_PER_MS,
      IsPaused: paused,
      CanSeek: true,
      PlayMethod: 'DirectPlay',
      ...extra,
    };
  }

  start(): void {
    void this.client.post('/Sessions/Playing', this.body()).catch(() => {});
    this.timer = setInterval(
      () => this.progress('TimeUpdate'),
      PROGRESS_EVERY_MS
    );
  }

  progress(event: 'TimeUpdate' | 'Pause' | 'Unpause'): void {
    if (this.stopped) return;
    void this.client
      .post('/Sessions/Playing/Progress', this.body({ EventName: event }))
      .catch(() => {});
  }

  stop(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    // keepalive lets the report leave while the page is closing.
    return this.client
      .request('POST', '/Sessions/Playing/Stopped', {
        body: this.body(),
        keepalive: true,
      })
      .then(
        () => {},
        () => {}
      );
  }
}
