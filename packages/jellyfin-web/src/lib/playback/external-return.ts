import React from 'react';
import { useRouterState } from '@tanstack/react-router';
import { toast } from 'sonner';
import { currentHost } from '../hosts';
import { itemPath } from '../paths';
import { PlaybackReporter } from './reporter';
import { useRefreshAll } from '../queries';
import { useSession } from '../session';
import { clock } from '../format';
import type { BaseItemDto, SourceInfo } from '../types';

/**
 * The item's page, marked with what played, for a player that reports where it
 * stopped: a browser tab reopens it by its address, the desktop app by its link.
 */
export function externalReturnUrl(
  item: BaseItemDto,
  source: SourceInfo
): string | undefined {
  const host = currentHost().name;
  if (host !== 'desktop' && host !== 'browser') return undefined;
  const path = itemPath(item);
  const marks = new URLSearchParams({ played: item.Id!, source: source.Id! });
  const marked = `${path}${path.includes('?') ? '&' : '?'}${marks}`;
  if (host === 'desktop') return `aiostreams://return${marked}`;
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#${marked}`;
}

const MARKS = ['played', 'source', 'position', 'lastPlayedUrl'];

/** Saves the position a player sent back, which lands before or after the hash depending on the player. */
export function useExternalReturn() {
  const { client } = useSession();
  const refreshAll = useRefreshAll();
  // A return to a page already open changes only the hash.
  const href = useRouterState({ select: (s) => s.location.href });
  React.useEffect(() => {
    const { hash } = window.location;
    const split = hash.includes('?') ? hash.indexOf('?') : hash.length;
    const hashPath = hash.slice(0, split);
    // A player that sees no query before the hash may start its own with another `?`.
    const hashQuery = hash.slice(split + 1).replace(/\?/g, '&');
    const query = new URLSearchParams(window.location.search);
    const inHash = new URLSearchParams(hashQuery);
    const read = (key: string) => query.get(key) ?? inHash.get(key);
    const itemId = read('played');
    const sourceId = read('source');
    if (!itemId || !sourceId) return;
    const ms = Number(read('position')) * 1000;

    for (const key of MARKS) inHash.delete(key);
    const rest = inHash.toString();
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${hashPath}${rest ? `?${rest}` : ''}`
    );
    if (!(ms > 0)) return;
    void new PlaybackReporter(
      client,
      { itemId, mediaSourceId: sourceId },
      () => ({ ms, paused: true })
    )
      .stop()
      .then(() => {
        void refreshAll();
        toast.success(`Saved your place at ${clock(ms)}`);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [href]);
}
