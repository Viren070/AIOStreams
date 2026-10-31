import { t } from '@lingui/core/macro';
import React from 'react';
import {
  LuLoaderCircle,
  LuMaximize2,
  LuPause,
  LuPlay,
  LuX,
} from 'react-icons/lu';
import { cn } from '@aiostreams/ui/core/styling';
import { itemSubtitle, itemTitle } from '../../lib/format';
import { appBridge } from '../../lib/hosts/shell/bridge';
import { overlayOpen } from '../../lib/input/focus';
import type { PlayerController } from '../../lib/playback/controller';
import { usePlayhead } from '../../lib/playback/playhead';
import type { BaseItemDto } from '../../lib/types';

export const MINI_CARD =
  'fixed bottom-[calc(var(--nav-bar)+0.75rem)] end-[calc(0.75rem+env(safe-area-inset-right))] z-40 flex w-[min(24rem,calc(100vw-1.5rem))] select-none items-center gap-3 overflow-hidden rounded-xl border border-white/10 bg-gray-950/95 p-2 pe-1 shadow-lg backdrop-blur';

export const MINI_VIDEO = 'aspect-video w-32 flex-none bg-black';

function useNativeVideoArea(
  slot: React.RefObject<HTMLDivElement | null>,
  enabled: boolean
) {
  React.useLayoutEffect(() => {
    const el = slot.current;
    const bridge = appBridge();
    if (!enabled || !el || !bridge) return;
    let sent = '';
    let frame = 0;
    const report = () => {
      frame = 0;
      const box = el.getBoundingClientRect();
      const scale = window.devicePixelRatio || 1;
      const message = {
        x: Math.round(box.left * scale),
        y: Math.round(box.top * scale),
        width: Math.round(box.width * scale),
        height: Math.round(box.height * scale),
        viewportWidth: Math.round(window.innerWidth * scale),
        viewportHeight: Math.round(window.innerHeight * scale),
        hidden: overlayOpen(),
      };
      const next = JSON.stringify(message);
      if (next === sent) return;
      sent = next;
      bridge.send({ type: 'player-mini', ...message });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(report);
    };
    report();
    const resize = new ResizeObserver(schedule);
    resize.observe(el);
    window.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    const overlays = new MutationObserver(schedule);
    overlays.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-state'],
    });
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      overlays.disconnect();
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      bridge.send({ type: 'player-mini' });
    };
  }, [slot, enabled]);
}

export function MiniPlayerBar({
  item,
  player,
  hostPlayer,
  failure,
  onExpand,
  onClose,
}: {
  item: BaseItemDto;
  player: PlayerController;
  hostPlayer: boolean;
  failure?: string;
  onExpand(): void;
  onClose(): void;
}) {
  const slot = React.useRef<HTMLDivElement>(null);
  useNativeVideoArea(slot, hostPlayer);
  const { state, playhead } = player;
  const { durationMs } = state;
  const progress = usePlayhead(playhead, (head) =>
    durationMs > 0
      ? Math.min(100, Math.round((head.positionMs / durationMs) * 1000) / 10)
      : 0
  );
  const detail = failure
    ? t`Playback failed: ${failure}`
    : item.Type === 'Episode'
      ? itemSubtitle(item)
      : undefined;
  const button =
    'flex size-10 flex-none items-center justify-center rounded-full text-xl text-white/85 transition hover:bg-white/10 hover:text-white';
  return (
    <>
      {hostPlayer && (
        <div
          ref={slot}
          data-ui="mini-player-video"
          className={cn(MINI_VIDEO, 'cursor-pointer')}
          onClick={onExpand}
        />
      )}
      <button
        type="button"
        data-ui="mini-player-title"
        className="min-w-0 flex-1 text-start"
        onClick={onExpand}
      >
        <p className="truncate text-sm font-semibold">{itemTitle(item)}</p>
        {detail && <p className="truncate text-xs text-gray-300">{detail}</p>}
      </button>
      {!failure && (
        <button
          type="button"
          data-ui="mini-player-button"
          data-name="play"
          aria-label={state.paused ? t`Play` : t`Pause`}
          title={state.paused ? t`Play` : t`Pause`}
          className={button}
          onClick={() => player.togglePlay()}
        >
          {state.waiting ? (
            <LuLoaderCircle className="animate-spin" />
          ) : state.paused ? (
            <LuPlay />
          ) : (
            <LuPause />
          )}
        </button>
      )}
      <button
        type="button"
        data-ui="mini-player-button"
        data-name="expand"
        aria-label={t`Open player`}
        title={t`Open player`}
        className={button}
        onClick={onExpand}
      >
        <LuMaximize2 />
      </button>
      <button
        type="button"
        data-ui="mini-player-button"
        data-name="close"
        aria-label={t`Close`}
        title={t`Close`}
        className={button}
        onClick={onClose}
      >
        <LuX />
      </button>
      <div
        data-ui="mini-player-progress"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-white/10"
      >
        <div
          className="h-full bg-[--brand]"
          style={{ width: `${progress}%` }}
        />
      </div>
    </>
  );
}
