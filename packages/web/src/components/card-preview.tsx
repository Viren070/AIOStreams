import { t } from '@lingui/core/macro';
import React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@aiostreams/ui/core/styling';
import { useSession } from '../lib/session';
import { useItem } from '../lib/queries';
import { currentHost } from '../lib/hosts';
import { backdropUrls, landscapeUrls, logoUrl } from '../lib/images';
import {
  duration,
  itemSubtitle,
  itemTitle,
  progressOf,
  remainingMs,
  ticksToMs,
} from '../lib/format';
import { Artwork, ProgressBar } from './cards';
import { CachedImage } from './cached-image';
import { Scores, scoresOf } from './scores';
import type { BaseItemDto } from '../lib/types';

const POINTER_REST_MS = 500;
const FOCUS_REST_MS = 800;
// A collection's card already shows all it has.
const previewed = ({ Type }: BaseItemDto) =>
  Type === 'Movie' || Type === 'Series' || Type === 'Episode';

interface Target {
  item: BaseItemDto;
  card: HTMLElement;
  byFocus: boolean;
}

interface Previews {
  rest(target: Target): void;
  /** Cancels only a waiting preview: an open one covers its card, so leaving the card enters it. */
  leave(): void;
  blur(): void;
}

const PreviewContext = React.createContext<Previews | null>(null);

export function useCardPreview(item: BaseItemDto) {
  const previews = React.useContext(PreviewContext);
  if (!previews || !previewed(item)) return undefined;
  return {
    // Not on enter, which rows scrolling under a still pointer also send.
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType === 'mouse')
        previews.rest({ item, card: e.currentTarget, byFocus: false });
    },
    onPointerLeave: previews.leave,
    onFocus: (e: React.FocusEvent<HTMLElement>) => {
      if ((e.target as Element).matches(':focus-visible'))
        previews.rest({ item, card: e.currentTarget, byFocus: true });
    },
    onBlur: previews.blur,
  };
}

export function CardPreviewHost({ children }: { children: React.ReactNode }) {
  const [shown, setShown] = React.useState<Target | null>(null);
  const shownRef = React.useRef(shown);
  shownRef.current = shown;
  const pending = React.useRef<Target | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  const previews = React.useMemo<Previews>(() => {
    const cancel = () => {
      clearTimeout(timer.current);
      pending.current = null;
    };
    return {
      rest(target) {
        const known = pending.current ?? shownRef.current;
        if (known?.item === target.item && known.card === target.card) return;
        cancel();
        setShown(null);
        pending.current = target;
        timer.current = setTimeout(
          () => {
            const next = pending.current;
            pending.current = null;
            if (next?.card.isConnected) setShown(next);
          },
          target.byFocus ? FOCUS_REST_MS : POINTER_REST_MS
        );
      },
      leave: cancel,
      blur() {
        cancel();
        setShown(null);
      },
    };
  }, []);
  React.useEffect(() => () => clearTimeout(timer.current), []);

  React.useEffect(() => {
    if (!shown) return;
    const close = () => setShown(null);
    // A remote's move scrolls after focus begins the next card's wait, which goes on.
    const wheel = () => {
      previews.leave();
      close();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('scroll', close, {
      capture: true,
      passive: true,
    });
    addEventListener('wheel', wheel, { passive: true });
    addEventListener('resize', close);
    addEventListener('keydown', key);
    return () => {
      document.removeEventListener('scroll', close, { capture: true });
      removeEventListener('wheel', wheel);
      removeEventListener('resize', close);
      removeEventListener('keydown', key);
    };
  }, [shown, previews]);

  return (
    <PreviewContext.Provider value={previews}>
      {children}
      {shown &&
        createPortal(
          <Preview target={shown} onClose={() => setShown(null)} />,
          document.body
        )}
    </PreviewContext.Provider>
  );
}

/** Centred over the whole card, its title too, inside its row and the window. */
function place(card: HTMLElement) {
  const frame = card.querySelector<HTMLElement>('[data-focus-frame]') ?? card;
  const r = frame.getBoundingClientRect();
  const whole = card.getBoundingClientRect();
  const row = card.closest('[data-ui=media-row]')?.getBoundingClientRect();
  const minX = Math.max(8, row?.left ?? 0);
  const maxX = Math.min(innerWidth - 8, row?.right ?? innerWidth);
  const width = Math.min(
    r.height > r.width
      ? (whole.height * 1.06 * 16) / 9
      : Math.min(Math.max(r.width * 1.35, r.height * 1.5, 320), 480),
    maxX - minX
  );
  const height = (width * 9) / 16;
  const left = Math.min(
    Math.max(r.left + r.width / 2 - width / 2, minX),
    maxX - width
  );
  const top = Math.min(
    Math.max(whole.top + whole.height / 2 - height / 2, 8),
    innerHeight - height - 8
  );
  return { left, top, width };
}

function Preview({ target, onClose }: { target: Target; onClose(): void }) {
  const [at] = React.useState(() => place(target.card));
  const tv = !!currentHost().tv;
  return (
    <div
      aria-hidden
      data-ui="card-preview"
      data-type={target.item.Type}
      style={at}
      className={cn(
        'fixed z-30 cursor-pointer overflow-hidden rounded-xl bg-gray-900 shadow-[0_24px_48px_-12px_rgb(0_0_0/0.85)] ring-1 ring-white/10',
        'duration-200 ease-out animate-in fade-in-0 zoom-in-90 motion-reduce:animate-none',
        target.byFocus &&
          'outline outline-[3px] outline-offset-2 outline-[var(--ring)]',
        tv && 'pointer-events-none'
      )}
      onPointerLeave={(e) => e.pointerType === 'mouse' && onClose()}
      onClick={() =>
        target.card.querySelector<HTMLElement>('a[href], button')?.click()
      }
      onContextMenu={(e) => {
        e.preventDefault();
        target.card.dispatchEvent(
          new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: e.clientX,
            clientY: e.clientY,
          })
        );
        onClose();
      }}
    >
      <PreviewBody listed={target.item} />
    </div>
  );
}

function PreviewBody({ listed }: { listed: BaseItemDto }) {
  const { client } = useSession();
  // A row's items leave out the overview and genres, but hold the latest watch state.
  const item = {
    ...(useItem(listed.Id ?? '').data ?? listed),
    UserData: listed.UserData,
  };
  const logo = logoUrl(client, item, { maxWidth: 480 });
  const [failedLogo, setFailedLogo] = React.useState<string>();
  const episode = item.Type === 'Episode';
  // A show's progress and running time aren't one video's.
  const series = item.Type === 'Series';
  const progress = progressOf(item);
  const leftMs = progress && !series ? remainingMs(item) : 0;
  const left = leftMs ? duration(leftMs) : '';
  const runtime = series ? '' : duration(ticksToMs(item.RunTimeTicks));
  const parts: [string, React.ReactNode][] = [
    ['year', !episode && item.ProductionYear],
    ['score', scoresOf(item).length ? <Scores item={item} max={3} /> : null],
    ['length', left ? t`${left} left` : runtime],
    ['rating', item.OfficialRating],
  ];
  const meta = parts.filter(([, part]) => part);
  const genres = episode ? '' : (item.Genres ?? []).slice(0, 3).join(' · ');

  return (
    <div className="relative aspect-video">
      <Artwork
        // A thumb usually has the title in it, which the logo would repeat.
        src={(width) =>
          (episode ? landscapeUrls : backdropUrls)(client, item, {
            maxWidth: width,
          })
        }
        alt=""
      />
      {/* Past the box's clip: at a fractional size the shade can stop a row short. */}
      <div className="absolute -inset-px bg-gradient-to-t from-black/95 via-black/55 to-black/0" />
      <div className="absolute inset-x-0 bottom-0 space-y-1.5 px-4 pb-4">
        {logo && failedLogo !== logo ? (
          <CachedImage
            data-ui="card-preview-logo"
            src={logo}
            alt={itemTitle(item)}
            onError={() => setFailedLogo(logo)}
            className="max-h-10 w-auto max-w-[60%] object-contain object-left rtl:object-right"
          />
        ) : (
          <p
            data-ui="card-preview-title"
            className="line-clamp-1 text-lg font-bold"
          >
            {itemTitle(item)}
          </p>
        )}
        {episode && (
          <p
            data-ui="card-preview-episode"
            className="line-clamp-1 text-sm font-semibold"
          >
            {itemSubtitle(item)}
          </p>
        )}
        {meta.length > 0 && (
          <div
            data-ui="card-preview-meta"
            className="flex flex-wrap items-center gap-x-2 text-xs text-gray-300"
          >
            {meta.map(([name, part], i) => (
              <React.Fragment key={name}>
                {i > 0 && (
                  <span data-ui="meta-separator" className="text-gray-500">
                    •
                  </span>
                )}
                <span data-name={name}>{part}</span>
              </React.Fragment>
            ))}
          </div>
        )}
        {genres && (
          <p
            data-ui="card-preview-genres"
            className="line-clamp-1 text-xs text-gray-400"
          >
            {genres}
          </p>
        )}
        {item.Overview && (
          <p
            data-ui="card-preview-overview"
            className="line-clamp-2 text-xs text-gray-300"
          >
            {item.Overview}
          </p>
        )}
      </div>
      {progress != null && progress > 0 && <ProgressBar percent={progress} />}
    </div>
  );
}
