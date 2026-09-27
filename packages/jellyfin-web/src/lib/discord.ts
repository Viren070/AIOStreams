import React from 'react';
import { useItem } from './queries';
import { itemSubtitle, itemTitle } from './format';
import { useShareOnDiscord } from './settings';
import type { PlayerState } from './player';
import type { BaseItemDto } from './types';

/** How far a seek has to move the position before Discord is told. */
const DRIFT_MS = 5000;

/**
 * Shows what is playing on the user's Discord profile, when they turn it on.
 * The poster comes by IMDb id, since the server's own image address would
 * show everyone where the server is.
 */
export function useDiscordPresence(item: BaseItemDto, state: PlayerState) {
  const [enabled] = useShareOnDiscord();
  const show = useItem(item.SeriesId ?? item.Id!);
  const imdb = (item.Type === 'Episode' ? show.data : item)?.ProviderIds?.Imdb;
  const { started, paused, positionMs, durationMs } = state;
  const sent = React.useRef<{ key: string; mark: number } | null>(null);

  React.useEffect(() => {
    const shell = window.aiostreamsDesktop;
    if (!shell || !enabled || !started) return;
    // Playing, the start time stays put; paused, the position does.
    const mark = paused ? positionMs : Date.now() - positionMs;
    const key = [item.Id, paused, imdb].join('|');
    const last = sent.current;
    if (last?.key === key && Math.abs(last.mark - mark) < DRIFT_MS) return;
    sent.current = { key, mark };
    shell.send({
      type: 'presence',
      presence: {
        title: itemTitle(item),
        subtitle: itemSubtitle(item) || null,
        imdb: imdb ?? null,
        position: Math.round(positionMs),
        duration: durationMs ? Math.round(durationMs) : null,
        paused,
      },
    });
  }, [enabled, started, paused, positionMs, durationMs, item, imdb]);

  React.useEffect(() => {
    if (!enabled) return;
    return () => {
      sent.current = null;
      window.aiostreamsDesktop?.send({ type: 'presence', presence: null });
    };
  }, [enabled]);
}
