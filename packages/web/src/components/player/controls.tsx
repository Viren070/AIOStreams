import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
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
import { formatLocale } from '../../lib/i18n';
import { appBridge } from '../../lib/hosts/shell/bridge';
import type { PlayerController } from '../../lib/playback/controller';
import { settings, useSetting } from '../../lib/settings';
import { delayNotice, syncNotice } from '../../lib/subtitles/delay';
import { useLatest } from '../../lib/use-latest';
import type { BaseItemDto, MediaSegmentDto } from '../../lib/types';
import {
  ControlButton,
  ControlsShown,
  MiddleButton,
  PlayerAction,
} from './buttons';
import { EpisodesSheet } from './episodes';
import { PlaylistSheet } from '../playlists';
import {
  Notice,
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
import { fitLabel, OptionButtons } from './options';
import { SeekBar } from './seek-bar';
import { skipLabel, useSegmentSkip } from './segments';
import { useHeldSpeed } from './speed';
import { SyncByEar, SyncToLine } from './subtitle-sync';
import { Volume } from './volume';
import { usePlayhead, type Playhead } from '../../lib/playback/playhead';

const IDLE_MS = 5000;

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
  onEpisode,
  loadingEpisode = null,
  offeringNext = false,
  caption,
  steps,
  playlist,
  onParty,
}: {
  item: BaseItemDto;
  player: PlayerController;
  segments: MediaSegmentDto[] | null | undefined;
  onBack(): void;
  onVersions?: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onEpisode?: (episode: BaseItemDto) => void;
  loadingEpisode?: string | null;
  offeringNext?: boolean;
  /** Under the title, in place of an episode's own line. */
  caption?: string;
  /** What previous and next move between, where it isn't the show's episodes. */
  steps?: 'episode' | 'trailer' | 'playlist';
  playlist?: { id: string; onPlay(entry: BaseItemDto, playlist: string): void };
  onParty?: () => void;
}) {
  const { state } = player;
  const latest = useLatest(player);
  const tv = !!currentHost().tv;
  const root = React.useRef<HTMLDivElement>(null);
  const bottomBar = React.useRef<HTMLDivElement>(null);
  const { idle, hidden, wake, hide } = useIdle(IDLE_MS);
  // Some TVs' web views report a coarse pointer.
  const [touch, setTouch] = React.useState(
    () => !tv && matchMedia('(pointer: coarse)').matches
  );
  const [menus, setMenus] = React.useState(0);
  const onMenu = (open: boolean) => setMenus((n) => n + (open ? 1 : -1));
  const [locked, setLocked] = React.useState(false);
  const [picking, setPicking] = React.useState<{
    heardAtMs: number;
    resume: boolean;
  } | null>(null);
  const [byEar, setByEar] = React.useState(false);
  const [episodes, setEpisodes] = React.useState(false);
  const [listing, setListing] = React.useState(false);
  const [scrub, setScrub] = React.useState<{
    fromMs: number;
    toMs: number;
  } | null>(null);
  const scrubbing = React.useRef(scrub);
  // Until the first frame only Back works; a player in its own window is watched there.
  const ready = state.started || !!player.external;
  const visible =
    !!player.external ||
    (ready &&
      !locked &&
      !hidden &&
      (!idle ||
        state.paused ||
        menus > 0 ||
        picking !== null ||
        byEar ||
        episodes ||
        listing ||
        scrub !== null));
  // The video appears without the controls, unless it opens paused.
  React.useEffect(() => {
    if (ready && !latest.current.state.paused) hide();
  }, [ready, latest, hide]);
  useWindowButtons(visible);
  useFocusInside(root, visible, wake);
  useLiftSubtitles(player, bottomBar, visible);

  const [flash, showFlash] = useToggleFlash();
  const [seekFlash, showSeekFlash] = useSeekFlash();
  const [notice, showNotice] = useNotice();
  const syncOutcome = player.autoSync?.outcome;
  React.useEffect(() => {
    const text = syncOutcome && syncNotice(syncOutcome);
    if (text) showNotice(text, 'failed' in syncOutcome ? 4000 : 2000);
  }, [syncOutcome, showNotice]);
  const togglePlay = () => {
    showFlash(latest.current.state.paused);
    latest.current.togglePlay();
  };

  const [seekStep] = useSetting(settings.controls.seekStep);
  const [burstSeek, seekingTo] = useBurstSeek(player);
  const [seekPicture, setSeekPicture] = React.useState(true);
  const seekBy = (deltaMs: number, picture = true) => {
    setSeekPicture(picture);
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

  const positionNow = usePositionClock(player);
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
      () => {
        const { name } = file;
        showNotice(t`Added ${name}`);
      },
      (e: Error) => showNotice(e.message)
    );
  const dragging = useFileDrop(
    player.subtitleFiles ? addSubtitleFile : undefined
  );

  const [fit, setFit] = useSetting(settings.video.fit);
  const shown = useLatest(visible);
  const gestures = usePlayerGestures({
    player,
    seekBy: (deltaMs) => seekBy(deltaMs, false),
    seekStepMs: seekStep * 1000,
    notice: showNotice,
    onTap: () => (shown.current ? hide() : wake()),
    onClick: togglePlay,
    onDoubleClick: () => latest.current.toggleFullscreen?.(),
    hold: speed.start,
    onScrub: (deltaMs) => {
      const { state, playhead } = latest.current;
      const fromMs = scrubbing.current?.fromMs ?? playhead.positionMs;
      const { durationMs } = state;
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
    onPinch: player.fit
      ? (out) => {
          const next = out ? 'crop' : 'fit';
          if (next === fit) return;
          setFit(next);
          const label = fitLabel(next);
          showNotice(t`Picture: ${label}`);
        }
      : undefined,
  });

  usePlayerKeys({
    player,
    root,
    ready,
    visible,
    wake,
    hide,
    notice: showNotice,
    togglePlay,
    seekBy: (deltaMs) => seekBy(deltaMs, tv),
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
  const listsEpisodes = isEpisode && !!item.SeriesId && !!onEpisode;
  const stepping = steps ?? (isEpisode ? 'episode' : undefined);
  const stepLabels = {
    episode: [t`Previous episode`, t`Next episode`],
    trailer: [t`Previous trailer`, t`Next trailer`],
    playlist: [t`Previous`, t`Next`],
  };
  const stepSeconds = seekStep;
  const subtitle = caption ?? (isEpisode ? itemSubtitle(item) : undefined);
  const spinner = <LuLoaderCircle className="animate-spin" />;
  const buttons: Record<string, Transport | false> = {
    previous: !!stepping && {
      name: 'previous',
      label: stepLabels[stepping][0],
      icon: loadingEpisode === 'previous' ? spinner : <LuSkipBack />,
      onClick: onPrevious,
    },
    // A remote's arrows skip with the controls hidden, and the seek bar's with them up.
    back: !touch &&
      !tv && {
        name: 'back',
        label: plural(stepSeconds, {
          one: 'Back # second',
          other: 'Back # seconds',
        }),
        icon: <LuRotateCcw />,
        onClick: () => seekBy(-seekStep * 1000),
      },
    forward: !touch &&
      !tv && {
        name: 'forward',
        label: plural(stepSeconds, {
          one: 'Forward # second',
          other: 'Forward # seconds',
        }),
        icon: <LuRotateCw />,
        onClick: () => seekBy(seekStep * 1000),
      },
    next: !!stepping && {
      name: 'next',
      label: stepLabels[stepping][1],
      icon: loadingEpisode === 'next' ? spinner : <LuSkipForward />,
      onClick: onNext,
    },
  };
  // Where the middle buttons don't show.
  const inBar = tv ? 'flex' : !touch && 'lg:flex';
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
  const shownAt = scrub?.toMs ?? seekingTo;
  const timeProps = { playhead: player.playhead, live: visible, atMs: shownAt };

  if (!ready)
    return (
      <div
        data-ui="player-controls"
        data-loading
        className="fixed inset-0 z-10 select-none"
        onContextMenu={(e) => e.preventDefault()}
      >
        {!tv && (
          // Late, so a quick start never flashes it.
          <div className="absolute start-[max(0.75rem,env(safe-area-inset-left))] top-[calc(0.75rem+env(safe-area-inset-top))] [animation:fade-in_300ms_ease-out_1.5s_both] sm:start-[max(1.25rem,env(safe-area-inset-left))] sm:top-[calc(1.25rem+env(safe-area-inset-top))]">
            <ControlButton name="exit" label={t`Back`} onClick={onBack}>
              <LuArrowLeft className="rtl:-scale-x-100" />
            </ControlButton>
          </div>
        )}
      </div>
    );

  const controls = (
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
        setTouch(!tv && e.pointerType === 'touch');
        // A tap on hidden controls must not press what appears under it.
        if (e.pointerType !== 'touch' || visible) wake();
      }}
    >
      <div className="absolute inset-0 touch-none" {...gestures} />

      <div
        data-ui="player-top-bar"
        className={cn(
          'absolute inset-x-0 top-0 flex items-center gap-3 bg-gradient-to-b from-black/80 to-transparent pb-12 ps-[max(0.75rem,env(safe-area-inset-left))] pe-[max(0.75rem,env(safe-area-inset-right))] pt-[calc(0.75rem+env(safe-area-inset-top))] transition-opacity duration-300 sm:ps-[max(1.25rem,env(safe-area-inset-left))] sm:pe-[max(1.25rem,env(safe-area-inset-right))] sm:pt-[calc(1.25rem+env(safe-area-inset-top))]',
          barFade
        )}
      >
        <ControlButton name="exit" label={t`Back`} onClick={onBack}>
          <LuArrowLeft className="rtl:-scale-x-100" />
        </ControlButton>
        <div
          data-ui="player-title"
          className="min-w-0 text-[length:var(--title)]"
        >
          <p data-name="name" className="truncate font-semibold">
            {itemTitle(item)}
          </p>
          {subtitle && (
            <p
              data-name="detail"
              className="truncate text-[0.875em] text-gray-300"
            >
              {subtitle}
            </p>
          )}
        </div>
        {touch && !tv && (
          <ControlButton
            name="lock"
            label={t`Lock screen`}
            className="ms-auto"
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
          <LoadingSpinner containerClass="size-16 flex-none" iconClass="me-0" />
        ) : (
          !tv && (
            <MiddleButton
              name="play"
              label={state.paused ? t`Play` : t`Pause`}
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
      {notice ||
        (player.autoSync?.waiting && <Notice text={t`Syncing subtitles…`} />)}
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
            <p className="text-lg font-semibold">
              <Trans>Drop to add subtitles</Trans>
            </p>
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
            showNotice(delayNotice(ms));
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
            'absolute end-[max(1rem,env(safe-area-inset-right))] z-20 transition-[bottom,opacity] duration-300 sm:end-[max(2rem,env(safe-area-inset-right))]',
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
          'absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent pb-[calc(0.5rem+env(safe-area-inset-bottom))] ps-[max(0.75rem,env(safe-area-inset-left))] pe-[max(0.75rem,env(safe-area-inset-right))] pt-16 transition-opacity duration-300 sm:pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:ps-[max(1.25rem,env(safe-area-inset-left))] sm:pe-[max(1.25rem,env(safe-area-inset-right))]',
          barFade
        )}
      >
        <div
          data-ui="player-info"
          className="flex items-center justify-between gap-3 px-0.5 pb-1"
        >
          <PlayerTime {...timeProps} durationMs={state.durationMs} />
          <EndsAt
            {...timeProps}
            durationMs={state.durationMs}
            rate={state.rate}
          />
        </div>
        <SeekBar
          playhead={player.playhead}
          live={visible}
          durationMs={state.durationMs}
          segments={segments}
          chapters={player.chapters ?? []}
          previewMs={shownAt}
          previewPicture={!!scrub || seekPicture}
          handle={touch}
          thumbnails={player.thumbnails}
          onSeek={player.seek}
          onStep={(direction) => seekBy(direction * seekStep * 1000, tv)}
          onTogglePlay={togglePlay}
        />
        <div className="flex items-center gap-1">
          <div className={cn('hidden items-center gap-1', inBar)}>
            <ControlButton
              name="play"
              label={state.paused ? t`Play` : t`Pause`}
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
          <OptionButtons
            player={player}
            onMenu={onMenu}
            onVersions={onVersions}
            onEpisodes={listsEpisodes ? () => setEpisodes(true) : undefined}
            onPlaylist={playlist ? () => setListing(true) : undefined}
            onAddFile={() => fileInput.current?.click()}
            onSyncByEar={() => setByEar(true)}
            onSyncToLine={pickLine}
            onParty={onParty}
            notice={showNotice}
          />
        </div>
      </div>

      {listsEpisodes && (
        <EpisodesSheet
          item={item}
          open={episodes}
          loadingId={loadingEpisode}
          onPlay={onEpisode}
          onClose={() => setEpisodes(false)}
        />
      )}

      {playlist && (
        <PlaylistSheet
          open={listing}
          playlist={playlist.id}
          playing={item.Id!}
          loadingId={loadingEpisode}
          onPlay={(entry, id) => {
            setListing(false);
            if (entry.Id !== item.Id || id !== playlist.id)
              playlist.onPlay(entry, id);
          }}
          onClose={() => setListing(false)}
        />
      )}

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
  return (
    <ControlsShown.Provider value={visible}>{controls}</ControlsShown.Provider>
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

const TIME = 'text-xs tabular-nums sm:text-[length:var(--time)]';

const SOFT_FOCUS =
  '[html:not([data-pointer-focus])_&:focus-visible]:bg-white/20 [html:not([data-pointer-focus])_&:focus-visible]:text-white';

interface TimeProps {
  playhead: Playhead;
  live: boolean;
  /** Shown in place of the playhead, as a seek is under way. */
  atMs: number | null;
}

function usePlayedMs({ playhead, live, atMs }: TimeProps): number {
  const seconds = usePlayhead(
    playhead,
    (h) => Math.floor(h.positionMs / 1000),
    live
  );
  return atMs ?? seconds * 1000;
}

function PlayerTime({
  durationMs,
  ...props
}: TimeProps & { durationMs: number }) {
  const at = usePlayedMs(props);
  const [left, setLeft] = useSetting(settings.controls.timeLeft);
  const showLeft = left && durationMs > 0;
  return (
    <button
      type="button"
      data-ui="player-time"
      data-focus="own"
      dir="ltr"
      title={showLeft ? t`Show time played` : t`Show time left`}
      className={cn(
        TIME,
        '-mx-1.5 rounded-md px-1.5 py-0.5 text-gray-200 transition-colors hover:text-white',
        SOFT_FOCUS
      )}
      onClick={() => setLeft(!left)}
    >
      {showLeft ? `-${clock(durationMs - at)}` : clock(at)}
      {durationMs > 0 && (
        <span className="text-gray-400"> / {clock(durationMs)}</span>
      )}
    </button>
  );
}

function EndsAt({
  durationMs,
  rate,
  ...props
}: TimeProps & { durationMs: number; rate: number }) {
  const at = usePlayedMs(props);
  // The end moves on while paused.
  const [, tick] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    if (!props.live) return;
    const timer = window.setInterval(tick, 30_000);
    return () => window.clearInterval(timer);
  }, [props.live]);
  if (durationMs <= 0) return null;
  const endsAt = new Date(
    Date.now() + Math.max(0, durationMs - at) / (rate || 1)
  ).toLocaleTimeString(formatLocale(), { hour: 'numeric', minute: '2-digit' });
  return (
    <p
      data-ui="player-ends"
      className={cn(TIME, 'whitespace-nowrap text-gray-400')}
    >
      {t`Ends at ${endsAt}`}
    </p>
  );
}
