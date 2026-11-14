import { t } from '@lingui/core/macro';
import React from 'react';
import { createPortal } from 'react-dom';
import { useReducedMotion } from 'motion/react';
import { cn } from '@aiostreams/ui/core/styling';
import { useSession } from '@/lib/jellyfin/session';
import { useItem } from '@/lib/jellyfin/queries';
import { currentHost } from '@/lib/hosts';
import { settings, useSetting, type TrailerSpot } from '@/lib/settings';
import { usePageShown } from '@/lib/page-shown';
import { usePlayback } from '@/lib/playback/session';
import { useParty } from '@/lib/party/party';
import { usePlayer } from '@/lib/playback/use-player';
import { usePlayhead } from '@/lib/playback/playhead';
import { videoEngine } from '@/lib/playback/video';
import { createLive, useLive } from '@/lib/live-value';
import { navigate, to } from '@/lib/paths';
import {
  trailerSource,
  trailersOf,
  useTrailerPlayback,
  type Trailer,
} from '@/lib/playback/trailers';
import type { EngineFactory, VideoFrame } from '@/lib/playback/engine';
import type { BaseItemDto } from '@/lib/jellyfin/types';
import { useLatest } from '@/hooks/use-latest';
import { pageRtl } from '@/lib/direction';
import { useWashShown } from '@/lib/artwork/background';
import { PlayerControls } from '@/features/player/controls';
import { OBJECT_FIT, usePlayerPage } from '@/app/player/page';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const boxOf = (el: HTMLElement): Box => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
};

/** The 16:9 box covering `box` round its middle, which a trailer fills whatever the player's fit. */
function coverOf(box: Box): Box {
  const width = Math.max(box.width, (box.height * 16) / 9);
  const height = (width * 9) / 16;
  return {
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height,
  };
}

function overlap(a: Box, b: Box): Box {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y),
  };
}

/** A position this far in, so frames are coming rather than the player only starting. */
const FLOWING_MS = 400;

const moved = (a: Box, b: Box) =>
  Math.abs(a.x - b.x) > 1 ||
  Math.abs(a.y - b.y) > 1 ||
  Math.abs(a.width - b.width) > 1 ||
  Math.abs(a.height - b.height) > 1;

/** A trailer over the whole window hides the pages, as the player does. */
const covering = createLive(false);

export const useTrailerCovers = () => useLive(covering);

const visibility = {
  subscribe(listener: () => void) {
    document.addEventListener('visibilitychange', listener);
    return () => document.removeEventListener('visibilitychange', listener);
  },
  get: () => document.visibilityState === 'visible',
};

const saveData = () =>
  !!(navigator as { connection?: { saveData?: boolean } }).connection?.saveData;

interface Probe {
  /** Where the trailer can play in a box of the page. */
  framed: boolean;
  /** Muting would mute the whole device. */
  ownVolume: boolean;
}

let probed: Probe | undefined;

function probe(): Probe {
  if (probed) return probed;
  const host = currentHost();
  if (host.play) return (probed = { framed: false, ownVolume: false });
  if (!host.player) return (probed = { framed: true, ownVolume: false });
  const engine = host.player(() => {}, {});
  return (probed = {
    framed: !!engine.setFrame,
    ownVolume: !!engine.ownVolume,
  });
}

/** Whether trailers may start by themselves in `spot` here and now. */
export function useTrailersOn(spot: TrailerSpot): boolean {
  const [on] = useSetting(settings.interface.trailer[spot]);
  const shown = usePageShown();
  const playback = usePlayback();
  const party = useParty();
  const still = useReducedMotion();
  const visible = React.useSyncExternalStore(
    visibility.subscribe,
    visibility.get
  );
  return (
    on &&
    shown &&
    visible &&
    !playback &&
    !party &&
    !still &&
    !saveData() &&
    probe().framed
  );
}

let stopShown: (() => void) | null = null;

/** One trailer plays at a time: a new one ends the last. */
function useOnlyOne(stop: () => void) {
  const latest = useLatest(stop);
  React.useEffect(() => {
    stopShown?.();
    const mine = () => latest.current();
    stopShown = mine;
    return () => {
      if (stopShown === mine) stopShown = null;
    };
  }, [latest]);
}

/** Where `spot` was as the trailer began; any move ends it, as an app's video can't follow. */
function useSpotBox(spot: HTMLElement, onMoved: () => void): Box {
  const [box] = React.useState(() => boxOf(spot));
  const latest = useLatest(onMoved);
  React.useEffect(() => {
    let frame = 0;
    const check = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!spot.isConnected || moved(boxOf(spot), box)) latest.current();
      });
    };
    // A glide eases a scroll's jump back, so the spot can still be drawn in place.
    const scroll = (e: Event) => {
      const box = e.target === document ? document.scrollingElement : e.target;
      if (box instanceof Node && box.contains(spot)) latest.current();
      else check();
    };
    const observer = new ResizeObserver(check);
    observer.observe(spot);
    document.addEventListener('scroll', scroll, {
      capture: true,
      passive: true,
    });
    addEventListener('resize', check);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener('scroll', scroll, { capture: true });
      removeEventListener('resize', check);
    };
  }, [spot, box, latest]);
  return box;
}

const MASK = ['mask-image', '-webkit-mask-image'];

/**
 * The app's video lies beneath the page, which the page's background covers
 * but in `box`: what the page draws there itself still shows over it.
 */
function useVideoHole(box: Box | null, radius: number, soft: boolean) {
  React.useLayoutEffect(() => {
    const background = document.querySelector<HTMLElement>(
      '[data-ui=page-background]'
    );
    if (!box || !background) return;
    const view = background.getBoundingClientRect();
    const x = box.x - view.left;
    const y = box.y - view.top;
    const { width: w, height: h } = box;
    const r = Math.min(radius, w / 2, h / 2);
    /* eslint-disable lingui/no-unlocalized-strings -- SVG */
    const arc = (dx: number, dy: number) => `A${r} ${r} 0 0 1 ${dx} ${dy}`;
    const path =
      `M0 0H${view.width}V${view.height}H0Z` +
      `M${x + r} ${y}H${x + w - r}${arc(x + w, y + r)}V${y + h - r}` +
      `${arc(x + w - r, y + h)}H${x + r}${arc(x, y + h - r)}V${y + r}${arc(x + r, y)}Z`;
    const rtl = pageRtl();
    const down = h * FADE;
    const side = w * FADE;
    // The page's background, fading back in over the hole's bottom and start,
    // from a pixel past its edge so no seam shows there.
    const edges = soft
      ? `<defs><linearGradient id="d" x2="0" y2="1"><stop stop-opacity="0"/><stop offset="1"/></linearGradient>` +
        `<linearGradient id="s" x1="${rtl ? 0 : 1}" x2="${rtl ? 1 : 0}"><stop stop-opacity="0"/><stop offset="1"/></linearGradient></defs>` +
        `<rect x="${x - 1}" y="${y + h - down}" width="${w + 2}" height="${down + 1}" fill="url(#d)"/>` +
        `<rect x="${rtl ? x + w - side : x - 1}" y="${y - 1}" width="${side + 1}" height="${h + 2}" fill="url(#s)"/>`
      : '';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${view.width}" height="${view.height}"><path fill-rule="evenodd" d="${path}"/>${edges}</svg>`;
    /* eslint-enable lingui/no-unlocalized-strings */
    const mask = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
    for (const name of MASK) background.style.setProperty(name, mask);
    const html = document.documentElement;
    html.setAttribute('data-video-hole', '');
    return () => {
      for (const name of MASK) background.style.removeProperty(name);
      html.removeAttribute('data-video-hole');
    };
  }, [box, radius, soft]);
}

/** How much of a soft trailer's height and width its bottom and start fade over. */
const FADE = 0.5;

/** Fades a soft trailer's hole at its bottom and start, for an element drawn over `frame`. */
function fadeMask(frame: Box, hole: Box): React.CSSProperties {
  const rtl = pageRtl();
  const bottom = frame.y + frame.height - (hole.y + hole.height);
  const start = rtl
    ? frame.x + frame.width - (hole.x + hole.width)
    : hole.x - frame.x;
  /* eslint-disable lingui/no-unlocalized-strings -- CSS */
  const image =
    `linear-gradient(to top, transparent ${bottom}px, #000 ${bottom + hole.height * FADE}px), ` +
    `linear-gradient(${rtl ? 'to left' : 'to right'}, transparent ${start}px, #000 ${start + hole.width * FADE}px)`;
  /* eslint-enable lingui/no-unlocalized-strings */
  return {
    maskImage: image,
    WebkitMaskImage: image,
    maskComposite: 'intersect',
    WebkitMaskComposite: 'source-in',
  };
}

/**
 * The page's background over a trailer's box, faded out once it plays: the
 * page beneath is cut away at once, which would bare its edges.
 */
export function TrailerVeil({ shown }: { shown: boolean }) {
  return (
    <div
      className={cn(
        // A layer made as a fade starts can draw nothing for a frame.
        'absolute inset-0 bg-[--background] transition-opacity duration-500 will-change-[opacity]',
        shown && 'opacity-0'
      )}
    />
  );
}

/** Played out, failed or had nothing to play; or stopped as its spot moved or another began. */
export type TrailerEnd = 'over' | 'stopped';

export interface TrailerPreviewProps {
  item: BaseItemDto;
  /** The element whose box it fills, which must hold still. */
  spot: HTMLElement;
  /** Only what of the spot lies inside it shows. */
  within?: HTMLElement;
  radius?: number;
  /** Over the page, which draws nothing on it, as for a preview over other cards. */
  over?: boolean;
  /** Over the whole window with the player's controls, with sound. */
  full?: boolean;
  /** Fades out at its bottom and start into a background taken from artwork. */
  soft?: boolean;
  /** Whether the picture shows, so what covers it can fade. */
  onShown?: (shown: boolean, trailer: Trailer) => void;
  onEnded(end: TrailerEnd): void;
  onExitFull?: () => void;
}

/**
 * Plays the title's trailer in `spot`, beneath the page's own drawing there:
 * the app's player under a hole in the page's background, else a video or
 * embed behind the page. Trailers that won't play give way to the next.
 */
export function TrailerPreview(props: TrailerPreviewProps) {
  const { item, spot, full = false } = props;
  const details = useItem(item.Id ?? '');
  const known = details.data ?? (item.RemoteTrailers ? item : undefined);
  const trailers = React.useMemo(
    () => (known ? trailersOf(known) : []),
    [known]
  );
  const [at, setAt] = React.useState(0);
  const trailer = trailers[at];
  const playback = useTrailerPlayback(trailer?.url);
  const [sound] = useSetting(settings.interface.trailerSound);
  const muted = !full && !sound;
  const ended = useLatest(props.onEnded);
  useOnlyOne(() => ended.current('stopped'));
  const box = useSpotBox(spot, () => !full && ended.current('stopped'));
  const [clip] = React.useState(() =>
    props.within ? boxOf(props.within) : null
  );
  const frame = React.useMemo(() => coverOf(box), [box]);
  const hole = React.useMemo(
    () => (clip ? overlap(box, clip) : box),
    [box, clip]
  );
  const next = React.useCallback(() => setAt((i) => i + 1), []);
  const washShown = useWashShown();
  const soft = !!props.soft && washShown;

  const none =
    details.isError || (!!known && !trailer) || (muted && probe().ownVolume);
  const unplayable = playback.isError || playback.data?.kind === 'external';
  React.useEffect(() => {
    if (none) ended.current('over');
  }, [none, ended]);
  React.useEffect(() => {
    if (unplayable) next();
  }, [unplayable, next]);

  const found = playback.data;
  // An embed has no controls of the page's, so its own page plays it whole.
  React.useEffect(() => {
    if (!full || found?.kind !== 'embed' || !item.Id) return;
    props.onExitFull?.();
    navigate(to.trailer(item.Id, at));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [full, found]);

  if (none || !trailer || !found) return null;
  const common = {
    frame,
    hole,
    radius: props.radius ?? 0,
    over: !!props.over,
    soft,
    muted,
    onShown: (shown: boolean) => props.onShown?.(shown, trailer),
    onFailed: next,
    onEnded: () => ended.current('over'),
  };
  if (found.kind === 'embed')
    return <EmbeddedPreview key={trailer.url} id={found.id} {...common} />;
  if (found.kind !== 'video') return null;
  return (
    <PlayedPreview
      key={trailer.url}
      {...common}
      item={item}
      trailer={trailer}
      url={found.url}
      originalLanguage={found.originalLanguage}
      host={currentHost().player}
      full={full}
      onExitFull={props.onExitFull}
      onPrevious={at > 0 ? () => setAt(at - 1) : undefined}
      onNext={at < trailers.length - 1 ? next : undefined}
      several={trailers.length > 1}
    />
  );
}

interface PreviewProps {
  /** Where the video goes, which only `hole` shows. */
  frame: Box;
  hole: Box;
  radius: number;
  over: boolean;
  muted: boolean;
  soft: boolean;
  onShown?: (shown: boolean) => void;
  onFailed(): void;
  onEnded(): void;
}

function useShown(shown: boolean, onShown?: (shown: boolean) => void) {
  const latest = useLatest(onShown);
  React.useEffect(() => {
    latest.current?.(shown);
    return () => {
      if (shown) latest.current?.(false);
    };
  }, [shown, latest]);
}

function PlayedPreview({
  item,
  trailer,
  url,
  originalLanguage,
  host,
  frame,
  hole,
  radius,
  over,
  muted,
  soft,
  full,
  several,
  onShown,
  onFailed,
  onEnded,
  onExitFull,
  onPrevious,
  onNext,
}: PreviewProps & {
  item: BaseItemDto;
  trailer: Trailer;
  url: string;
  originalLanguage: string | undefined;
  host: EngineFactory | undefined;
  full: boolean;
  several: boolean;
  onExitFull?: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
}) {
  const { client } = useSession();
  const video = React.useRef<HTMLVideoElement>(null);
  const [engines] = React.useState(() => [host ?? videoEngine(video)]);
  const source = React.useMemo(
    () => trailerSource(url, originalLanguage),
    [url, originalLanguage]
  );
  const [fit] = useSetting(settings.video.fit);
  // Without it, the app's player keeps the last style it was sent.
  const [subtitleStyle] = useSetting(settings.subtitle.style);
  const player = usePlayer(engines, {
    client,
    item,
    url,
    source,
    subtitleStyle,
    startMs: 0,
    onEnded,
    fit: full ? undefined : 'crop',
    muted,
    thumbnails: full,
  });
  const { started, error } = player.state;
  const flowing = usePlayhead(
    player.playhead,
    (head) => head.positionMs >= FLOWING_MS
  );
  const shown = started && flowing && !error;
  useShown(shown, onShown);
  const failed = useLatest(onFailed);
  React.useEffect(() => {
    if (error) failed.current();
  }, [error, failed]);

  // Drawn a pixel past the hole, so rounding never leaves a seam.
  const placed = React.useMemo<VideoFrame | null>(
    () =>
      full
        ? null
        : {
            x: frame.x - 1,
            y: frame.y - 1,
            width: frame.width + 2,
            height: frame.height + 2,
            draggable: false,
            // Over the page only once it plays, as it shows black until then.
            hidden: !over || !shown,
            animate: false,
            radius: over ? radius : 0,
            bottomRadius: over ? radius : 0,
            subtitles: false,
          },
    [full, frame, over, shown, radius]
  );
  const setFrame = useLatest(player.setFrame);
  React.useEffect(() => {
    if (host) setFrame.current?.(placed);
  }, [host, placed, setFrame]);
  React.useEffect(
    () => () => {
      if (host) setFrame.current?.(null);
    },
    [host, setFrame]
  );
  useVideoHole(host && shown && !full && !over ? hole : null, radius, soft);
  usePlayerPage(full);
  React.useEffect(() => {
    if (!full) return;
    covering.set(true);
    return () => covering.set(false);
  }, [full]);

  const back = () => onExitFull?.();
  return (
    <>
      {!host &&
        createPortal(
          <video
            ref={video}
            data-ui="trailer-preview-video"
            autoPlay
            playsInline
            style={
              full
                ? undefined
                : {
                    left: frame.x,
                    top: frame.y,
                    width: frame.width,
                    height: frame.height,
                    clipPath: clipTo(frame, hole, radius),
                    ...(soft && fadeMask(frame, hole)),
                  }
            }
            className={cn(
              'pointer-events-none fixed',
              full
                ? ['inset-0 z-40 h-full w-full bg-black', OBJECT_FIT[fit]]
                : [
                    over ? 'z-[31]' : '-z-[5]',
                    'object-cover transition-opacity duration-500',
                    !shown && 'opacity-0',
                  ]
            )}
          />,
          document.body
        )}
      {full &&
        createPortal(
          <div
            data-page="player"
            data-name="trailer"
            className="fixed inset-0 z-40"
          >
            <PlayerControls
              item={item}
              player={player}
              onBack={back}
              caption={trailer.name}
              steps={several ? 'trailer' : undefined}
              onPrevious={onPrevious}
              onNext={onNext}
              showAtOpen
            />
          </div>,
          document.body
        )}
    </>
  );
}

/** Shows only `hole` of a video drawn over `frame`. */
function clipTo(frame: Box, hole: Box, radius: number): string {
  const top = hole.y - frame.y;
  const left = hole.x - frame.x;
  const right = frame.x + frame.width - (hole.x + hole.width);
  const bottom = frame.y + frame.height - (hole.y + hole.height);
  // eslint-disable-next-line lingui/no-unlocalized-strings -- CSS
  return `inset(${top}px ${right}px ${bottom}px ${left}px round ${radius}px)`;
}

const EMBED_ORIGIN = 'https://www.youtube-nocookie.com';

/** YouTube's states, as its embed posts them. */
const PLAYING = 1;
const ENDED = 0;

/** A YouTube embed without its controls, cropped to fill the box. */
function EmbeddedPreview({
  id,
  frame: video,
  hole,
  radius,
  over,
  muted,
  soft,
  onShown,
  onFailed,
  onEnded,
}: PreviewProps & { id: string }) {
  const frame = React.useRef<HTMLIFrameElement>(null);
  const [playing, setPlaying] = React.useState(false);
  useShown(playing, onShown);
  const latest = useLatest({ onFailed, onEnded });
  React.useEffect(() => {
    const listen = (e: MessageEvent) => {
      if (
        e.origin !== EMBED_ORIGIN ||
        e.source !== frame.current?.contentWindow
      )
        return;
      let data: { event?: string; info?: unknown };
      try {
        data = JSON.parse(String(e.data));
      } catch {
        return;
      }
      const state =
        data.event === 'onStateChange'
          ? data.info
          : data.event === 'infoDelivery'
            ? (data.info as { playerState?: number } | undefined)?.playerState
            : undefined;
      if (state === PLAYING) setPlaying(true);
      else if (state === ENDED) latest.current.onEnded();
      if (data.event === 'onError') latest.current.onFailed();
    };
    addEventListener('message', listen);
    return () => removeEventListener('message', listen);
  }, [latest]);
  const query = new URLSearchParams({
    autoplay: '1',
    mute: muted ? '1' : '0',
    controls: '0',
    disablekb: '1',
    playsinline: '1',
    rel: '0',
    iv_load_policy: '3',
    enablejsapi: '1',
    origin: location.origin,
  });
  return createPortal(
    <div
      data-ui="trailer-preview-embed"
      style={{
        left: hole.x,
        top: hole.y,
        width: hole.width,
        height: hole.height,
        borderRadius: radius,
        ...(soft && fadeMask(hole, hole)),
      }}
      className={cn(
        'pointer-events-none fixed overflow-hidden transition-opacity duration-500',
        over ? 'z-[31]' : '-z-[5]',
        !playing && 'opacity-0'
      )}
    >
      <iframe
        ref={frame}
        title={t`Trailer`}
        src={`${EMBED_ORIGIN}/embed/${id}?${query}`}
        allow="autoplay; encrypted-media"
        referrerPolicy="strict-origin-when-cross-origin"
        tabIndex={-1}
        onLoad={() =>
          frame.current?.contentWindow?.postMessage(
            JSON.stringify({ event: 'listening', id, channel: 'widget' }),
            EMBED_ORIGIN
          )
        }
        style={{
          width: video.width,
          height: video.height,
          left: video.x - hole.x,
          top: video.y - hole.y,
        }}
        className="absolute border-0"
      />
    </div>,
    document.body
  );
}
