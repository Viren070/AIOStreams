import React from 'react';
import { playbackHost } from './hosts';
import type { MediaKey } from './hosts/shell';
import { itemSubtitle, itemTitle } from './format';
import { landscapeUrl, posterUrl } from './images';
import { useItem } from './queries';
import { useSession } from './session';
import { useDiscordEvent } from './settings';
import { useLatest, type PlayerController } from './player';
import type { BaseItemDto } from './types';

/** A browser's skip buttons carry no amount. */
const SKIP_MS = 10_000;
/** How far the position may stray from where it should be before the browser is told again. */
const DRIFT_MS = 2000;

/** A browser that lacks an action throws for it. */
function setHandler(
  session: MediaSession,
  action: MediaSessionAction,
  handler: MediaSessionActionHandler | null
) {
  try {
    session.setActionHandler(action, handler);
  } catch {}
}

interface Actions {
  onStop(): void;
  onNext?: () => void;
  onPrevious?: () => void;
}

/**
 * Tells the system's media controls what plays and takes their presses: through
 * the desktop app, which also shows it on Discord, or through the browser.
 */
export function useNowPlaying(
  item: BaseItemDto,
  player: PlayerController,
  actions: Actions
) {
  const { client } = useSession();
  const [discord] = useDiscordEvent('playing');
  const show = useItem(item.SeriesId ?? item.Id!);
  const imdb = (item.Type === 'Episode' ? show.data : item)?.ProviderIds?.Imdb;
  const title = itemTitle(item);
  const subtitle = itemSubtitle(item) || null;
  const artwork =
    landscapeUrl(client, item, { maxWidth: 640 }) ??
    posterUrl(client, item, { maxWidth: 400 });
  const { started, paused, positionMs, durationMs, rate } = player.state;
  const hasNext = !!actions.onNext;
  const hasPrevious = !!actions.onPrevious;
  const host = playbackHost();

  const latest = useLatest({ player, actions });
  const press = React.useCallback((key: MediaKey) => {
    const { player, actions } = latest.current;
    const { paused, positionMs, durationMs } = player.state;
    switch (key.action) {
      case 'play':
      case 'pause':
        if (paused === (key.action === 'play')) player.togglePlay();
        break;
      case 'toggle':
        player.togglePlay();
        break;
      case 'stop':
        actions.onStop();
        break;
      case 'next':
        actions.onNext?.();
        break;
      case 'previous':
        actions.onPrevious?.();
        break;
      case 'seek':
        player.seek(key.position);
        break;
      case 'skip': {
        const to = Math.max(0, positionMs + key.offset);
        player.seek(durationMs ? Math.min(durationMs, to) : to);
      }
    }
  }, []);

  React.useEffect(() => {
    const shell = window.aiostreamsDesktop;
    if (host !== 'shell' || !shell || !started) return;
    shell.send({
      type: 'now-playing',
      item: {
        title,
        subtitle,
        imdb: imdb ?? null,
        artwork,
        previous: hasPrevious,
        next: hasNext,
        discord,
      },
    });
  }, [
    host,
    started,
    title,
    subtitle,
    imdb,
    artwork,
    hasPrevious,
    hasNext,
    discord,
  ]);

  React.useEffect(() => {
    const shell = window.aiostreamsDesktop;
    if (host !== 'shell' || !shell) return;
    const unsubscribe = shell.subscribe((m) => {
      if (m.type === 'media-key') press(m.key);
    });
    return () => {
      unsubscribe();
      shell.send({ type: 'now-playing', item: null });
    };
  }, [host, press]);

  const session =
    host === 'browser' && 'mediaSession' in navigator
      ? navigator.mediaSession
      : null;

  React.useEffect(() => {
    if (!session) return;
    session.metadata = new MediaMetadata({
      title,
      artist: subtitle ?? '',
      artwork: artwork ? [{ src: artwork }] : [],
    });
    return () => {
      session.metadata = null;
    };
  }, [session, title, subtitle, artwork]);

  React.useEffect(() => {
    if (!session) return;
    const handlers: [MediaSessionAction, MediaSessionActionHandler | null][] = [
      ['play', () => press({ action: 'play' })],
      ['pause', () => press({ action: 'pause' })],
      ['stop', () => press({ action: 'stop' })],
      [
        'seekbackward',
        (d) => press({ action: 'skip', offset: -(d.seekOffset ?? 10) * 1000 }),
      ],
      [
        'seekforward',
        (d) => press({ action: 'skip', offset: (d.seekOffset ?? 10) * 1000 }),
      ],
      [
        'seekto',
        (d) => press({ action: 'seek', position: (d.seekTime ?? 0) * 1000 }),
      ],
      [
        'previoustrack',
        hasPrevious ? () => press({ action: 'previous' }) : null,
      ],
      ['nexttrack', hasNext ? () => press({ action: 'next' }) : null],
    ];
    for (const [action, handler] of handlers)
      setHandler(session, action, handler);
    return () => {
      for (const [action] of handlers) setHandler(session, action, null);
    };
  }, [session, press, hasPrevious, hasNext]);

  const told = React.useRef<{ at: number; positionMs: number } | null>(null);
  React.useEffect(() => {
    if (!session) return;
    told.current = null;
    session.playbackState = paused ? 'paused' : 'playing';
    return () => {
      session.playbackState = 'none';
    };
  }, [session, paused, rate]);

  React.useEffect(() => {
    if (!session || !durationMs) return;
    const last = told.current;
    const expected = last
      ? last.positionMs + (paused ? 0 : (Date.now() - last.at) * rate)
      : null;
    if (expected != null && Math.abs(expected - positionMs) < DRIFT_MS) return;
    told.current = { at: Date.now(), positionMs };
    session.setPositionState({
      duration: durationMs / 1000,
      position: Math.min(positionMs, durationMs) / 1000,
      playbackRate: rate,
    });
  }, [session, paused, positionMs, durationMs, rate]);
}
