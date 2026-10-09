import React from 'react';
import { settings, useSetting } from '../../lib/settings';
import { useLatest } from '../../lib/use-latest';
import type { PlayerController } from '../../lib/playback/controller';

/** `start` gives the function that lets go, or false when the speed can't change. */
export function useHeldSpeed(player: PlayerController) {
  const [rate] = useSetting(settings.holdRate);
  const latest = useLatest({ player, rate });
  const [held, setHeld] = React.useState<number | null>(null);
  const before = React.useRef<number | null>(null);

  const release = React.useCallback(() => {
    if (before.current === null) return;
    latest.current.player.setRate?.(before.current);
    before.current = null;
    setHeld(null);
  }, [latest]);

  const start = React.useCallback((): (() => void) | false => {
    const { player, rate } = latest.current;
    if (!player.setRate || player.state.paused || before.current !== null)
      return false;
    before.current = player.state.rate;
    player.setRate(rate);
    setHeld(rate);
    return release;
  }, [latest, release]);

  React.useEffect(() => release, [release]);
  return { held, start };
}
