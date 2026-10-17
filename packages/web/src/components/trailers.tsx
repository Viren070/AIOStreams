import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import React from 'react';
import { BiMoviePlay } from 'react-icons/bi';
import { LuPlay } from 'react-icons/lu';
import { Button } from '@aiostreams/ui/button';
import { Drawer } from '@aiostreams/ui/drawer';
import { focusOn, keyboardFocus, useRestoreFocus } from '../lib/input';
import { useSession } from '../lib/session';
import { backdropUrl } from '../lib/images';
import { navigate, to } from '../lib/paths';
import {
  trailersOf,
  usePrefetchTrailer,
  youTubeId,
  type Trailer,
} from '../lib/playback/trailers';
import type { BaseItemDto } from '../lib/types';

export function TrailerButton({ item }: { item: BaseItemDto }) {
  const trailers = React.useMemo(() => trailersOf(item), [item]);
  const [listing, setListing] = React.useState(false);
  const prefetch = usePrefetchTrailer();
  if (!trailers.length) return null;
  const play = (index: number) => navigate(to.trailer(item.Id!, index));
  const count = trailers.length;
  return (
    <>
      <Button
        data-ui="item-action"
        data-name="trailer"
        intent="gray-outline"
        className="rounded-full"
        leftIcon={<BiMoviePlay className="text-lg" />}
        onFocus={() => prefetch(trailers[0].url)}
        onPointerEnter={() => prefetch(trailers[0].url)}
        onClick={() => (trailers.length > 1 ? setListing(true) : play(0))}
      >
        {plural(count, { one: 'Trailer', other: 'Trailers' })}
      </Button>
      {trailers.length > 1 && (
        <TrailersSheet
          item={item}
          trailers={trailers}
          open={listing}
          onPlay={(index) => {
            setListing(false);
            play(index);
          }}
          onClose={() => setListing(false)}
        />
      )}
    </>
  );
}

function TrailersSheet({
  item,
  trailers,
  open,
  onPlay,
  onClose,
}: {
  item: BaseItemDto;
  trailers: Trailer[];
  open: boolean;
  onPlay(index: number): void;
  onClose(): void;
}) {
  const { client } = useSession();
  const list = React.useRef<HTMLDivElement>(null);
  const restoreFocus = useRestoreFocus(open);
  const prefetch = usePrefetchTrailer();
  const backdrop = backdropUrl(client, item, { maxWidth: 320 });

  // After the dialog focuses its first button.
  React.useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      const row = list.current?.querySelector<HTMLElement>('button');
      const at = keyboardFocus();
      if (row && at && list.current?.closest('[role=dialog]')?.contains(at))
        focusOn(row);
    });
    return () => clearTimeout(timer);
  }, [open]);

  return (
    <Drawer
      data-ui="dialog"
      data-name="trailers"
      open={open}
      onOpenChange={(next) => !next && onClose()}
      onCloseAutoFocus={restoreFocus}
      title={t`Trailers`}
      headerClass="sr-only"
      side="right"
      size="md"
      contentClass="flex flex-col gap-0 overflow-hidden p-0"
      closeClass="end-2 top-[calc(0.75rem+env(safe-area-inset-top))]"
    >
      <div className="min-w-0 px-4 pb-3 pe-12 pt-[calc(0.75rem+env(safe-area-inset-top))]">
        <p className="text-xs font-semibold uppercase tracking-wider text-[--muted]">
          <Trans>Trailers</Trans>
        </p>
        <p className="truncate font-semibold">{item.Name}</p>
      </div>
      <div
        ref={list}
        data-ui="trailers-list"
        data-nav-group
        className="min-h-0 flex-1 space-y-1 overflow-y-auto border-t border-white/5 p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]"
      >
        {trailers.map((trailer, i) => {
          const id = youTubeId(trailer.url);
          return (
            <button
              key={trailer.url}
              type="button"
              data-ui="trailer"
              data-focus="own"
              onClick={() => onPlay(i)}
              onFocus={() => prefetch(trailer.url)}
              onPointerEnter={() => prefetch(trailer.url)}
              className="group/trailer flex w-full items-center gap-3 rounded-xl p-2 text-start outline-none transition-colors hover:bg-white/5 focus-visible:bg-white/10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[--ring] [[data-tv]_&]:focus-visible:ring-[3px]"
            >
              <div className="relative aspect-video w-32 flex-none overflow-hidden rounded-lg bg-gray-900 sm:w-36">
                {(id || backdrop) && (
                  <img
                    src={
                      id
                        ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg`
                        : backdrop!
                    }
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                )}
                <span className="absolute inset-0 flex items-center justify-center bg-black/30 text-2xl opacity-0 transition-opacity group-hover/trailer:opacity-100 group-focus-visible/trailer:opacity-100">
                  <LuPlay />
                </span>
              </div>
              <p className="line-clamp-2 min-w-0 flex-1 text-sm font-semibold">
                {trailer.name}
              </p>
            </button>
          );
        })}
      </div>
    </Drawer>
  );
}
