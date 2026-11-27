import React from 'react';
import { useLatest } from '@/hooks/use-latest';
import { appLog } from '@/lib/hosts/shell/bridge';
import type { PlayerController } from './controller';

/**
 * Plays the fallback the resolver kept for a trailer whose stream failed:
 * the failure clears while the fallback is asked for, and the address it
 * returns reloads the player. `failed` hears the error that used the
 * fallback up, or the one that had no fallback at all.
 */
export function useTrailerFallback(
  player: PlayerController,
  setUrl: (url: string) => void,
  fallbackUrl: (() => Promise<string | null>) | undefined,
  failed: (error: string) => void
): void {
  const error = player.state.error;
  const tried = React.useRef(false);
  const latest = useLatest({ player, setUrl, fallbackUrl, failed });
  React.useEffect(() => {
    if (!error) return;
    const { player, setUrl, fallbackUrl, failed } = latest.current;
    // Without a fallback, or once it has been tried, the error stands.
    if (!fallbackUrl || tried.current) return failed(error);
    tried.current = true;
    // Why the fallback was asked for: a stream that would not start, or a
    // version the TV cannot play at all.
    appLog('info', `trailer: ${error}; trying the muxed stream`);
    // The trailer shows as loading while the fallback is asked for.
    player.restart();
    void fallbackUrl().then(
      (next) => (next ? setUrl(next) : failed(error)),
      () => failed(error)
    );
  }, [error, latest]);
}
