import React from 'react';
import {
  LuArrowLeft,
  LuCaptions,
  LuLoaderCircle,
  LuLock,
  LuPause,
  LuPlay,
  LuRotateCcw,
  LuRotateCw,
  LuSkipBack,
  LuSkipForward,
} from 'react-icons/lu';
import { LoadingSpinner } from '@aiostreams/ui/loading-spinner';
import { cn } from '@aiostreams/ui/core/styling';
import { clock, itemSubtitle, itemTitle } from '../../lib/format';
import { currentHost } from '../../lib/hosts';
import { appBridge } from '../../lib/hosts/shell/bridge';
import type { PlayerController } from '../../lib/playback/controller';
import { settings, useSetting } from '../../lib/settings';
import { delayLabel } from '../../lib/subtitles/delay';
import { useLatest } from '../../lib/use-latest';
import type { BaseItemDto, MediaSegmentDto } from '../../lib/types';
import { ControlButton, MiddleButton, PlayerAction } from './buttons';
import {
  ScrubReadout,
  SpeedPill,
  useNotice,
  useSeekFlash,
  useToggleFlash,
} from './feedback';
import { usePlayerGestures } from './gestures';
import { useBurstSeek, useFileDrop, useIdle, usePositionClock } from './hooks';
import { usePlayerKeys } from './keys';
import { ScreenLock } from './lock';
import { canFit, FIT_LABELS, OptionButtons } from './options';
import { SeekBar } from './seek-bar';
import { skipLabel, useSegmentSkip } from './segments';
import { useHeldSpeed } from './speed';
import { SyncByEar, SyncToLine } from './subtitle-sync';
import { Volume } from './volume';

const IDLE_MS = 2000;

interface Transport {
  name: string;
  label: string;
  icon: React.ReactNode;
  onClick?: () => void;
}

export function PlayerControls({
  item,
  player,
  segments: segmentItems,
  onBack,
  onVersions,
  onPrevious,
  onNext,
  loadingEpisode,
  offeringNext = false,
}: {
  item: BaseItemDto;
  player: PlayerController;
  segments: MediaSegmentDto[] | null | undefined;
  onBack(): void;
  onVersions?: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  loadingEpisode?: 'previous' | 'next' | null;
  offeringNext?: boolean;
}) {
  const { state } = player;
  const latest = useLatest(player);
  const tv = !!currentHost().tv;
  const root = React.useRef<HTMLDivElement>(null);
  const bottomBar = React.useRef<HTMLDivElement>(null);
  const { idle, hidden, wake, hide } = useIdle(IDLE_MS);
  const [touch, setTouch] = React.useState(
    () => matchMedia('(pointer: coarse)').matches
  );
  const [menus, setMenus] = React.useState(0);
  const onMenu = (open: boolean) => setMenus((n) => n + (open ? 1 : -1));
  const [locked, setLocked] = React.useState(false);
  const [picking, setPicking] = React.useState<{
    heardAtMs: number;
    resume: boolean;
  } | null>(null);
  const [byEar, setByEar] = React.useState(false);
  const [scrub, setScrub] = React.useState<{
    fromMs: number;
    toMs: number;
  } | null>(null);
  const scrubbing = React.useRef(scrub);
  // A player in its own window is watched there.
  const visible =
    !!player.external ||
    (!locked &&
      !hidden &&
      (!idle ||
        state.paused ||
        menus > 0 ||
        !state.started ||
        picking !== null ||
        byEar ||
        scrub !== null));
  useWindowButtons(visible);
  useFocusInside(root, visible, wake);
  useLiftSubtitles(player, bottomBar, visible);

  const [flash, showFlash] = useToggleFlash();
  const [seekFlash, showSeekFlash] = useSeekFlash();
  const [notice, showNotice] = useNotice();
  const togglePlay = () => {
    showFlash(latest.current.state.paused);
    latest.current.togglePlay();
  };

  const [seekStep] = useSetting(settings.seekStep);
  const burstSeek = useBurstSeek(player);
  const seekBy = (deltaMs: number) => {
    burstSeek(deltaMs);
    showSeekFlash(deltaMs);
  };
  const { segments, segment, fresh, skip } = useSegmentSkip({
    items: segmentItems,
    player,
    offeringNext,
    notice: showNotice,
  });
  const speed = useHeldSpeed(player);

  const positionNow = usePositionClock(state);
  const loadLines = React.useCallback(
    () => latest.current.subtitleLines?.() ?? Promise.resolve(null),
    [latest]
  );
  const pickLine = () => {
    const resume = !latest.current.state.paused;
    if (resume) latest.current.togglePlay();
    setPicking({ heardAtMs: positionNow(), resume });
  };
  const closePicker = () => {
    if (picking?.resume && latest.current.state.paused)
      latest.current.togglePlay();
    setPicking(null);
  };
  const closeByEar = React.useCallback(() => setByEar(false), []);

  const fileInput = React.useRef<HTMLInputElement>(null);
  const addSubtitleFile = (file: File) =>
    latest.current.subtitleFiles?.add(file).then(
      () => showNotice(`Added ${file.name}`),
      (e: Error) => showNotice(e.message)
    );
  const dragging = useFileDrop(
    player.subtitleFiles ? addSubtitleFile : undefined
  );

  const [fit, setFit] = useSetting(settings.videoFit);
  const shown = useLatest(visible);
  const gestures = usePlayerGestures({
    player,
    seekBy,
    seekStepMs: seekStep * 1000,
    notice: showNotice,
    onTap: () => (shown.current ? hide() : wake()),
    onClick: togglePlay,
    onDoubleClick: () => latest.current.toggleFullscreen?.(),
    hold: speed.start,
    onScrub: (deltaMs) => {
      const { positionMs, durationMs } = latest.current.state;
      const fromMs = scrubbing.current?.fromMs ?? positionMs;
      const to = Math.max(0, fromMs + deltaMs);
      scrubbing.current = {
        fromMs,
        toMs: durationMs ? Math.min(durationMs, to) : to,
      };
      setScrub(scrubbing.current);
    },
    onScrubEnd: (commit) => {
      const s = scrubbing.current;
      scrubbing.current = null;
      setScrub(null);
      if (commit && s && Math.abs(s.toMs - s.fromMs) >= 1000)
        latest.current.seek(s.toMs);
      wake();
    },
    onPinch: canFit(player)
      ? (out) => {
          const next = out ? 'crop' : 'fit';
          if (next === fit) return;
          setFit(next);
          showNotice(`Picture: ${FIT_LABELS[next]}`);
        }
      : undefined,
  });

  usePlayerKeys({
    player,
    root,
    visible,
    wake,
    hide,
    notice: showNotice,
    togglePlay,
    seekBy,
    onBack,
    onPrevious,
    onNext,
    skipSegment: skip,
    speedUp: speed.start,
  });

  const fade = visible ? 'opacity-100' : 'pointer-events-none opacity-0';
  const barFade = cn(
    'pointer-events-none',
    visible ? 'opacity-100 [&>*]:pointer-events-auto' : 'opacity-0'
  );
  const isEpisode = item.Type === 'Episode';
  const spinner = <LuLoaderCircle className="animate-spin" />;
  const buttons: Record<string, Transport | false> = {
    previous: isEpisode && {
      name: 'previous',
      label: 'Previous episode',
      icon: loadingEpisode === 'previous' ? spinner : <LuSkipBack />,
      onClick: onPrevious,
    },
    back: !touch && {
      name: 'back',
      label: `Back ${seekStep} seconds`,
      icon: <LuRotateCcw />,
      onClick: () => seekBy(-seekStep * 1000),
    },
    forward: !touch && {
      name: 'forward',
      label: `Forward ${seekStep} seconds`,
      icon: <LuRotateCw />,
      onClick: () => seekBy(seekStep * 1000),
    },
    next: isEpisode && {
      name: 'next',
      label: 'Next episode',
      icon: loadingEpisode === 'next' ? spinner : <LuSkipForward />,
      onClick: onNext,
    },
  };
  const middleShown = cn(
    !touch && 'lg:hidden',
    scrub ? 'pointer-events-none opacity-0' : fade
  );
  const middleButton = (b: Transport | false) =>
    !tv &&
    b && (
      <MiddleButton
        name={b.name}
        label={b.label}
        disabled={!b.onClick}
        onClick={b.onClick}
        className={middleShown}
      >
        {b.icon}
      </MiddleButton>
    );
  const barButton = (b: Transport | false) =>
    b && (
      <ControlButton
        name={b.name}
        label={b.label}
        disabled={!b.onClick}
        onClick={b.onClick}
      >
        {b.icon}
      </ControlButton>
    );
  const time = (
    <>
      {clock(state.positionMs)}
      {state.durationMs > 0 && (
        <span className="text-gray-400"> / {clock(state.durationMs)}</span>
      )}
    </>
  );

  return (
    <div
      ref={root}
      data-ui="player-controls"
      data-visible={visible || undefined}
      data-paused={state.paused || undefined}
      data-waiting={(state.waiting && !state.error) || undefined}
      // The next episode card moves above the bar as its peer.
      className={cn(
        'peer fixed inset-0 z-10 select-none',
        !visible && 'cursor-none'
      )}
      onFocus={wake}
      onPointerMove={wake}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        setTouch(e.pointerType === 'touch');
        // A tap on hidden controls must not press what appears under it.
        if (e.pointerType !== 'touch' || visible) wake();
      }}
    >
      <div className="absolute inset-0 touch-none" {...gestures} />

      <div
        data-ui="player-top-bar"
        className={cn(
          'absolute inset-x-0 top-0 flex items-center gap-3 bg-gradient-to-b from-black/80 to-transparent pb-12 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pt-[calc(0.75rem+env(safe-area-inset-top))] transition-opacity duration-300 sm:pl-[max(1.25rem,env(safe-area-inset-left))] sm:pr-[max(1.25rem,env(safe-area-inset-right))] sm:pt-[calc(1.25rem+env(safe-area-inset-top))]',
          barFade
        )}
      >
        <ControlButton name="exit" label="Back" onClick={onBack}>
          <LuArrowLeft />
        </ControlButton>
        <div
          data-ui="player-title"
          className="min-w-0 text-[length:var(--title)]"
        >
          <p className="truncate font-semibold">{itemTitle(item)}</p>
          {isEpisode && (
            <p className="truncate text-[0.875em] text-gray-300">
              {itemSubtitle(item)}
            </p>
          )}
        </div>
        {touch && !tv && (
          <ControlButton
            name="lock"
            label="Lock screen"
            className="ml-auto"
            onClick={() => {
              setLocked(true);
              hide();
            }}
          >
            <LuLock />
          </ControlButton>
        )}
      </div>

      <div
        data-ui="player-middle"
        className="pointer-events-none absolute inset-0 flex items-center justify-center gap-3 sm:gap-6"
      >
        {middleButton(buttons.previous)}
        {middleButton(buttons.back)}
        {state.waiting && !state.error ? (
          <LoadingSpinner containerClass="size-16 flex-none" iconClass="mr-0" />
        ) : (
          !tv && (
            <MiddleButton
              name="play"
              label={state.paused ? 'Play' : 'Pause'}
              big
              onClick={togglePlay}
              className={middleShown}
            >
              {state.paused ? <LuPlay /> : <LuPause />}
            </MiddleButton>
          )
        )}
        {middleButton(buttons.forward)}
        {middleButton(buttons.next)}
      </div>

      {!touch && <div className="contents max-lg:hidden">{flash}</div>}
      {seekFlash}
      {notice}
      {scrub && (
        <ScrubReadout
          fromMs={scrub.fromMs}
          toMs={scrub.toMs}
          durationMs={state.durationMs}
        />
      )}
      {speed.held && <SpeedPill rate={speed.held} />}
      {dragging && (
        <div
          data-ui="subtitle-drop"
          className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-black/60 p-6"
        >
          <div className="rounded-2xl border-2 border-dashed border-white/40 px-10 py-8 text-center">
            <LuCaptions className="mx-auto mb-2 text-4xl" />
            <p className="text-lg font-semibold">Drop to add subtitles</p>
          </div>
        </div>
      )}
      {player.subtitleFiles && (
        <input
          ref={fileInput}
          type="file"
          hidden
          accept={player.subtitleFiles.types.map((t) => `.${t}`).join(',')}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void addSubtitleFile(file);
          }}
        />
      )}
      {picking && player.setSubtitleDelay && (
        <SyncToLine
          heardAtMs={picking.heardAtMs}
          delayMs={state.subtitleDelayMs}
          load={loadLines}
          onPick={(ms) => {
            player.setSubtitleDelay?.(ms);
            closePicker();
            showNotice(`Subtitles ${delayLabel(ms).toLowerCase()}`);
          }}
          onClose={closePicker}
        />
      )}
      {byEar && player.setSubtitleDelay && state.subtitle && (
        <SyncByEar
          delayMs={state.subtitleDelayMs}
          now={positionNow}
          onApply={player.setSubtitleDelay}
          onClose={closeByEar}
        />
      )}

      {segment && !locked && (
        // Above the bottom bar, whose padding reaches over it.
        <div
          data-ui="skip-segment"
          data-type={segment.type}
          data-visible={visible || fresh || undefined}
          className={cn(
            'absolute right-[max(1rem,env(safe-area-inset-right))] z-20 transition-[bottom,opacity] duration-300 sm:right-[max(2rem,env(safe-area-inset-right))]',
            visible
              ? 'bottom-[calc(7rem+env(safe-area-inset-bottom))] sm:bottom-[calc(8rem+env(safe-area-inset-bottom))]'
              : 'bottom-[calc(2rem+env(safe-area-inset-bottom))]',
            !visible && !fresh && 'pointer-events-none opacity-0'
          )}
        >
          <PlayerAction
            primary
            className="shadow-lg"
            rightIcon={<LuSkipForward />}
            onClick={skip}
          >
            {skipLabel(segment)}
          </PlayerAction>
        </div>
      )}

      <div
        ref={bottomBar}
        data-ui="player-bottom-bar"
        className={cn(
          'absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent pb-[calc(0.5rem+env(safe-area-inset-bottom))] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pt-16 transition-opacity duration-300 sm:pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:pl-[max(1.25rem,env(safe-area-inset-left))] sm:pr-[max(1.25rem,env(safe-area-inset-right))]',
          barFade
        )}
      >
        <p
          data-ui="player-time"
          className="px-0.5 text-xs tabular-nums text-gray-200 sm:hidden"
        >
          {time}
        </p>
        <SeekBar
          positionMs={state.positionMs}
          durationMs={state.durationMs}
          bufferedMs={state.bufferedMs}
          segments={segments}
          chapters={player.chapters ?? []}
          previewMs={scrub?.toMs ?? null}
          handle={touch}
          onSeek={player.seek}
          onStep={(direction) => seekBy(direction * seekStep * 1000)}
        />
        <div className="flex items-center gap-1">
          <div className={cn('hidden items-center gap-1', !touch && 'lg:flex')}>
            <ControlButton
              name="play"
              label={state.paused ? 'Play' : 'Pause'}
              onClick={togglePlay}
            >
              {state.paused ? <LuPlay /> : <LuPause />}
            </ControlButton>
            {barButton(buttons.back)}
            {barButton(buttons.forward)}
            {barButton(buttons.previous)}
            {barButton(buttons.next)}
          </div>
          {!touch && !tv && <Volume player={player} />}
          <span
            data-ui="player-time"
            className="ml-2 hidden whitespace-nowrap text-[length:var(--time)] tabular-nums text-gray-200 sm:inline"
          >
            {time}
          </span>
          <OptionButtons
            player={player}
            onMenu={onMenu}
            onVersions={onVersions}
            onAddFile={() => fileInput.current?.click()}
            onSyncByEar={() => setByEar(true)}
            onSyncToLine={pickLine}
            notice={showNotice}
          />
        </div>
      </div>

      {locked && (
        <ScreenLock
          onUnlock={() => {
            setLocked(false);
            wake();
          }}
        />
      )}
    </div>
  );
}

/** Hides macOS's window buttons, drawn over the video, with the controls. */
function useWindowButtons(visible: boolean) {
  React.useEffect(() => {
    const shell = appBridge();
    if (shell?.platform === 'macos')
      shell.send({ type: 'window-buttons', visible });
  }, [visible]);
  React.useEffect(
    () => () => {
      const shell = appBridge();
      if (shell?.platform === 'macos')
        shell.send({ type: 'window-buttons', visible: true });
    },
    []
  );
}

/** Hidden controls let go of focus, so the arrow keys seek again. */
function useFocusInside(
  root: React.RefObject<HTMLElement | null>,
  visible: boolean,
  wake: () => void
) {
  React.useEffect(() => {
    const el = document.activeElement;
    if (!visible && el instanceof HTMLElement && root.current?.contains(el))
      el.blur();
  }, [visible, root]);
  // The page takes the arrows before the controls see them.
  React.useEffect(() => {
    const onKey = () => {
      if (root.current?.contains(document.activeElement)) wake();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [wake, root]);
}

function useLiftSubtitles(
  player: PlayerController,
  bottomBar: React.RefObject<HTMLElement | null>,
  visible: boolean
) {
  const latest = useLatest(player);
  React.useEffect(() => {
    const lift = () => {
      const tops = Array.from(bottomBar.current?.children ?? [])
        .map((child) => child.getBoundingClientRect())
        .filter((r) => r.height > 0)
        .map((r) => r.top);
      latest.current.liftSubtitles?.(
        visible && tops.length ? 1 - Math.min(...tops) / innerHeight : 0
      );
    };
    lift();
    if (!visible) return;
    window.addEventListener('resize', lift);
    return () => window.removeEventListener('resize', lift);
  }, [visible, latest, bottomBar]);
  React.useEffect(() => () => latest.current.liftSubtitles?.(0), [latest]);
}
