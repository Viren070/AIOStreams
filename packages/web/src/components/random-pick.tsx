import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import React from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { BiInfoCircle, BiPlay, BiShuffle } from 'react-icons/bi';
import { Button } from '@aiostreams/ui/button';
import { Modal } from '@aiostreams/ui/modal';
import { LoadingSpinner } from '@aiostreams/ui/loading-spinner';
import { cn } from '@aiostreams/ui/core/styling';
import {
  duration,
  episodeCode,
  itemSubtitle,
  ticksToMs,
  unavailableKind,
} from '../lib/format';
import { landscapeUrl, posterUrl } from '../lib/images';
import { useRestoreFocus } from '../lib/input';
import { itemPath, navigate } from '../lib/paths';
import { useFetchNextUp } from '../lib/queries';
import { useSession } from '../lib/session';
import type { BaseItemDto, BaseItemDtoQueryResult } from '../lib/types';
import { useVersionPicker } from './version-picker';

export type RandomSource =
  | { kind: 'episode'; series: BaseItemDto }
  | { kind: 'favourite'; types: string };

interface Opening {
  open: boolean;
  source: RandomSource | null;
  id: number;
}

let opening: Opening = { open: false, source: null, id: 0 };
const listeners = new Set<() => void>();

function setOpening(next: Partial<Opening>): void {
  opening = { ...opening, ...next };
  for (const listener of listeners) listener();
}

export const openRandom = (source: RandomSource) =>
  setOpening({ open: true, source, id: opening.id + 1 });

const closeRandom = () => setOpening({ open: false });

function useOpening() {
  return React.useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    () => opening
  );
}

interface Draw {
  items: BaseItemDto[];
  pick: number;
}

/** Favourites fetched around a pick, which the reel shows on its way there. */
const WINDOW = 24;
const FRAMES = 14;
/** Each frame shows a little longer, so the reel slows as it lands. */
const frameMs = (i: number) => 45 + i * i * 1.6;
const IMAGE_WAIT_MS = 1500;
const CARD = { rolling: { scale: 1 }, landed: { scale: [1, 1.04, 1] } };

const random = (n: number) => Math.floor(Math.random() * n);

function shuffled<T>(list: T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Any but `previous`, where there is another. */
function pickFrom(items: BaseItemDto[], previous?: string): number {
  const others = items.flatMap((item, i) => (item.Id === previous ? [] : i));
  return others.length ? others[random(others.length)] : 0;
}

/** A show's episodes, or favourites that fit in one window, are fetched once per opening. */
function useRoll(source: RandomSource) {
  const { client, user } = useSession();
  return React.useMemo(() => {
    let pool: BaseItemDto[] | null = null;
    let total = 0;
    const favourites = (start: number) =>
      client.get<BaseItemDtoQueryResult>('/Items', {
        userId: user.Id,
        StartIndex: start,
        Limit: WINDOW,
        IncludeItemTypes:
          source.kind === 'favourite' ? source.types : undefined,
        Recursive: true,
        Filters: 'IsFavorite',
        EnableTotalRecordCount: true,
      });
    return async (previous?: string): Promise<Draw> => {
      if (!pool && !total) {
        if (source.kind === 'episode') {
          const { Items = [] } = await client.get<BaseItemDtoQueryResult>(
            `/Shows/${source.series.Id}/Episodes`,
            { userId: user.Id }
          );
          pool = Items.filter(
            (e) => !unavailableKind(e) && e.ParentIndexNumber !== 0
          );
        } else {
          const first = await favourites(0);
          total = first.TotalRecordCount ?? first.Items?.length ?? 0;
          if (total <= WINDOW) pool = first.Items ?? [];
        }
      }
      if (pool) return { items: pool, pick: pickFrom(pool, previous) };
      const at = random(total);
      const start = Math.min(Math.max(0, at - WINDOW / 2), total - WINDOW);
      const items = (await favourites(start)).Items ?? [];
      const pick = Math.min(at - start, items.length - 1);
      return {
        items,
        pick: items[pick]?.Id === previous ? pickFrom(items, previous) : pick,
      };
    };
  }, [client, user.Id, source]);
}

function heading(source: RandomSource | null) {
  if (source?.kind === 'episode')
    return {
      title: t`Random episode`,
      description: source.series.Name ?? undefined,
    };
  return {
    title: t`Random favourite`,
    description:
      source?.types === 'Movie'
        ? t`Movies`
        : source?.types === 'Series'
          ? t`Shows`
          : undefined,
  };
}

export function RandomPick() {
  const { open, source, id } = useOpening();
  const restoreFocus = useRestoreFocus(open);
  // Run once the dialog has handed focus back, so a dialog it opens returns there.
  const pending = React.useRef<(() => void) | null>(null);
  const act = React.useCallback((run: () => void) => {
    pending.current = run;
    closeRandom();
  }, []);
  return (
    <Modal
      data-ui="dialog"
      data-name="random"
      open={open}
      onOpenChange={(next) => !next && closeRandom()}
      onCloseAutoFocus={(e) => {
        restoreFocus(e);
        const run = pending.current;
        pending.current = null;
        run?.();
      }}
      {...heading(source)}
      contentClass="max-w-lg"
    >
      {source && <Picker key={id} source={source} act={act} />}
    </Modal>
  );
}

function Picker({
  source,
  act,
}: {
  source: RandomSource;
  act: (run: () => void) => void;
}) {
  const { client } = useSession();
  const picker = useVersionPicker();
  const fetchNextUp = useFetchNextUp();
  const roll = useRoll(source);
  const still = useReducedMotion();
  const poster = source.kind === 'favourite';
  const imageOf = React.useCallback(
    (item: BaseItemDto) =>
      (poster
        ? posterUrl(client, item, { maxWidth: 320 })
        : landscapeUrl(client, item, { maxWidth: 560 })) ?? undefined,
    [client, poster]
  );
  const [draw, setDraw] = React.useState<Draw | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [shown, setShown] = React.useState<BaseItemDto | null>(null);
  // The last frame whose image is ready, kept while the next one loads.
  const [frameSrc, setFrameSrc] = React.useState<string>();
  const [landed, setLanded] = React.useState(false);

  const start = React.useCallback(
    (previous?: string) => {
      setFailed(false);
      setLanded(false);
      roll(previous).then(setDraw, () => setFailed(true));
    },
    [roll]
  );
  React.useEffect(() => start(), [start]);

  React.useEffect(() => {
    if (!draw?.items.length) return;
    const target = draw.items[draw.pick];
    const others = shuffled(draw.items.filter((_, i) => i !== draw.pick));
    const frames =
      still || !others.length
        ? []
        : Array.from({ length: FRAMES }, (_, i) => others[i % others.length]);
    const ready = new Set<string>();
    const load = (item: BaseItemDto) => {
      const url = imageOf(item);
      if (!url) return Promise.resolve();
      const image = new Image();
      image.src = url;
      return image.decode().then(
        () => void ready.add(url),
        () => {}
      );
    };
    frames.forEach(load);
    let timer = 0;
    let i = 0;
    let stopped = false;
    const step = () => {
      if (stopped) return;
      if (i < frames.length) {
        const frame = frames[i];
        const url = imageOf(frame);
        setShown(frame);
        if (url && ready.has(url)) setFrameSrc(url);
        timer = window.setTimeout(step, frameMs(i++));
        return;
      }
      setShown(target);
      setLanded(true);
    };
    void Promise.race([
      load(target),
      new Promise((resolve) => setTimeout(resolve, IMAGE_WAIT_MS)),
    ]).then(step);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [draw, still, imageOf]);

  const play = React.useRef<HTMLButtonElement>(null);
  const focused = React.useRef(false);
  React.useEffect(() => {
    if (!landed || focused.current) return;
    focused.current = true;
    play.current?.focus({ preventScroll: true });
  }, [landed]);

  const target = landed ? shown : null;
  const resumeMs = ticksToMs(target?.UserData?.PlaybackPositionTicks);
  const image = target ? imageOf(target) : frameSrc;
  const empty = !!draw && !draw.items.length;

  if (failed)
    return (
      <div className="space-y-4">
        <p className="text-sm text-[--muted]">
          <Trans>Could not pick one.</Trans>
        </p>
        <div className="flex justify-end">
          <Button
            intent="white"
            className="rounded-full"
            onClick={() => start()}
          >
            <Trans>Try again</Trans>
          </Button>
        </div>
      </div>
    );
  if (empty)
    return (
      <p className="text-sm text-[--muted]">
        {source.kind === 'episode'
          ? t`This show has no episodes to pick from yet.`
          : t`Nothing marked as a favourite yet.`}
      </p>
    );

  const onPlay = () => {
    if (!target) return;
    if (target.Type !== 'Series')
      return act(() => picker.play(target, { startMs: resumeMs }));
    act(
      () =>
        void fetchNextUp(target.Id!).then(
          (next) =>
            next
              ? picker.play(next, {
                  startMs: ticksToMs(next.UserData?.PlaybackPositionTicks),
                })
              : navigate(itemPath(target)),
          () => navigate(itemPath(target))
        )
    );
  };

  return (
    <div data-ui="random" className="space-y-4">
      <motion.div
        data-ui="random-card"
        data-landed={landed || undefined}
        variants={CARD}
        animate={landed && !still ? 'landed' : 'rolling'}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className={cn(
          'relative mx-auto overflow-hidden rounded-xl bg-white/5 ring-1 ring-white/10',
          poster ? 'aspect-[2/3] w-40 sm:w-48' : 'aspect-video w-full',
          landed &&
            'shadow-[0_0_24px_-6px] shadow-brand-500/40 ring-2 ring-brand-500'
        )}
      >
        {image ? (
          <img
            src={image}
            alt=""
            className="absolute inset-0 size-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-4xl text-white/20">
            <BiShuffle />
          </div>
        )}
        {!draw && (
          <div className="absolute inset-0 grid place-items-center">
            <LoadingSpinner />
          </div>
        )}
      </motion.div>
      {target ? (
        <motion.div
          data-ui="random-details"
          initial={still ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="min-h-[4.5rem] space-y-1 text-center"
        >
          <p
            data-ui="random-title"
            className="text-lg font-semibold leading-snug"
          >
            {target.Name}
          </p>
          <p className="text-sm text-[--muted]">{detailLine(target)}</p>
          {target.Overview && (
            <p className="line-clamp-3 pt-1 text-start text-sm text-gray-300">
              {target.Overview}
            </p>
          )}
        </motion.div>
      ) : (
        <p
          data-ui="random-reel-title"
          aria-hidden
          className="min-h-[4.5rem] truncate text-center text-sm text-[--muted]"
        >
          {shown &&
            (shown.Type === 'Episode' ? itemSubtitle(shown) : shown.Name)}
        </p>
      )}
      <div
        data-ui="random-actions"
        className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"
      >
        <Button
          data-name="again"
          intent="gray-subtle"
          className="rounded-full"
          leftIcon={<BiShuffle />}
          disabled={!draw || draw.items.length < 2}
          onClick={() => {
            setFrameSrc(image);
            start(shown?.Id);
          }}
        >
          <Trans>Pick again</Trans>
        </Button>
        <Button
          data-name="open"
          intent="gray-outline"
          className="rounded-full"
          leftIcon={<BiInfoCircle />}
          disabled={!target}
          onClick={() => target && act(() => navigate(itemPath(target)))}
        >
          <Trans>Open</Trans>
        </Button>
        <Button
          ref={play}
          data-name="play"
          intent="white"
          className="rounded-full"
          leftIcon={<BiPlay className="text-lg" />}
          disabled={!target}
          onClick={onPlay}
        >
          {resumeMs ? t`Resume` : t`Play`}
        </Button>
      </div>
    </div>
  );
}

function detailLine(item: BaseItemDto): string {
  const runtime = duration(ticksToMs(item.RunTimeTicks));
  const first =
    item.Type === 'Episode'
      ? episodeCode(item.ParentIndexNumber, item.IndexNumber)
      : item.ProductionYear
        ? String(item.ProductionYear)
        : '';
  return [first, item.Type !== 'Series' && runtime].filter(Boolean).join(' · ');
}
