import React from 'react';
import { toast } from 'sonner';
import {
  BiBarChartAlt2,
  BiCopy,
  BiDotsVerticalRounded,
  BiErrorCircle,
  BiInfoCircle,
  BiLink,
  BiLinkExternal,
  BiPlay,
  BiRefresh,
  BiSearch,
} from 'react-icons/bi';
import { Button, IconButton } from '@aiostreams/ui/button';
import { DropdownMenu, DropdownMenuItem } from '@aiostreams/ui/dropdown-menu';
import { Modal } from '@aiostreams/ui/modal';
import { Skeleton } from '@aiostreams/ui/skeleton';
import { TextInput } from '@aiostreams/ui/text-input';
import { Tooltip } from '@aiostreams/ui/tooltip';
import { copyToClipboard } from '@aiostreams/ui/utils/clipboard';
import { useSession } from '../lib/session';
import { useFeature } from '../lib/server-info';
import {
  useItem,
  usePlaybackInfo,
  useRefreshPlaybackInfo,
  useSetPlayed,
} from '../lib/queries';
import {
  directUrl,
  externalPlayerTemplate,
  externalPlayerUrl,
} from '../lib/playback';
import {
  lastVersions,
  noticeSources,
  playableSources,
  usePlay,
} from '../lib/use-play';
import { playbackHost } from '../lib/hosts';
import { clock, itemSubtitle, itemTitle, ticksToMs } from '../lib/format';
import { cn } from '@aiostreams/ui/core/styling';
import { backdropUrl, landscapeUrl } from '../lib/images';
import { itemPath, navigate, to } from '../lib/paths';
import type { BaseItemDto, SourceInfo } from '../lib/types';

interface Request {
  item: BaseItemDto;
  startMs: number;
  /** From the player: the version playing, which a pick replaces. */
  playing?: string;
}

interface PickerValue {
  /** Lists the item's versions; nothing is resolved until this is called. */
  open(item: BaseItemDto, opts?: { startMs?: number; playing?: string }): void;
}

const PickerContext = React.createContext<PickerValue | null>(null);

/** Opens the picker once, then drops `pick` from the address. */
export function PickOnArrival({ itemId }: { itemId: string }) {
  const item = useItem(itemId);
  const picker = useVersionPicker();
  const opened = React.useRef(false);
  React.useEffect(() => {
    if (!item.data || opened.current) return;
    opened.current = true;
    picker.open(item.data, {
      startMs: ticksToMs(item.data.UserData?.PlaybackPositionTicks),
    });
    navigate(itemPath(item.data), { replace: true });
  }, [item.data, picker]);
  return null;
}

export function useVersionPicker(): PickerValue {
  const value = React.useContext(PickerContext);
  if (!value) throw new Error('useVersionPicker needs a VersionPickerProvider');
  return value;
}

export function VersionPickerProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [request, setRequest] = React.useState<Request | null>(null);
  const [external, setExternal] = React.useState<BaseItemDto | null>(null);
  const value = React.useMemo<PickerValue>(
    () => ({
      open: (item, opts) => {
        const startMs = opts?.startMs ?? 0;
        const last =
          startMs > 0 && !opts?.playing && playbackHost() !== 'android'
            ? lastVersions.get(item.Id!)
            : undefined;
        if (last) navigate(to.play(item.Id!, last, startMs));
        else setRequest({ item, startMs, playing: opts?.playing });
      },
    }),
    []
  );
  const item = request?.item;
  return (
    <PickerContext.Provider value={value}>
      {children}
      <Modal
        open={!!request}
        onOpenChange={(open) => !open && setRequest(null)}
        title={item ? itemTitle(item) : undefined}
        description={
          item?.Type === 'Episode'
            ? itemSubtitle(item)
            : item?.ProductionYear || undefined
        }
        contentClass="flex w-full max-w-4xl flex-col gap-0 overflow-hidden p-0 max-md:h-[100dvh] max-md:rounded-none max-md:border-0 md:max-h-[85vh]"
        headerClass="relative z-[1] px-4 pb-3 pr-14 pt-5 text-left max-md:pt-[calc(1.25rem+env(safe-area-inset-top))] sm:px-5 sm:pr-14"
        closeClass="z-[2] max-md:top-[calc(1rem+env(safe-area-inset-top))]"
      >
        {request && (
          <Versions
            key={request.item.Id}
            request={request}
            onDone={() => setRequest(null)}
            onExternal={() => {
              setExternal(request.item);
              setRequest(null);
            }}
          />
        )}
      </Modal>
      <ExternalPrompt item={external} onClose={() => setExternal(null)} />
    </PickerContext.Provider>
  );
}

const FILTER_FROM = 8;

function sourceText(source: SourceInfo): string {
  return [
    source.aiostreams?.name || source.Name,
    source.aiostreams?.description,
  ]
    .filter(Boolean)
    .join('\n');
}

function Versions({
  request,
  onDone,
  onExternal,
}: {
  request: Request;
  onDone: () => void;
  onExternal: () => void;
}) {
  const { client } = useSession();
  const { item } = request;
  const info = usePlaybackInfo(item.Id!, { listing: true });
  const refresh = useRefreshPlaybackInfo(item.Id!);
  const refreshing = info.isFetching || refresh.isPending;
  const canRefresh = useFeature('refreshVersions');
  const play = usePlay();
  const template = externalPlayerTemplate();
  const [startMs, setStartMs] = React.useState(request.startMs);
  const [filter, setFilter] = React.useState('');
  const sources = playableSources(info.data);
  const notices = noticeSources(info.data);
  const terms = filter.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = terms.length
    ? sources.filter((s) => {
        const text = sourceText(s).toLowerCase();
        return terms.every((t) => text.includes(t));
      })
    : sources;
  const art =
    backdropUrl(client, item, { maxWidth: 1280 }) ??
    landscapeUrl(client, item, { maxWidth: 1280 });
  // The art ends where the list starts, however tall the header above it grows.
  const listRef = React.useRef<HTMLDivElement>(null);
  const [artHeight, setArtHeight] = React.useState<number>();
  React.useLayoutEffect(() => {
    const list = listRef.current;
    if (!list?.parentElement) return;
    const update = () => setArtHeight(list.offsetTop);
    const observer = new ResizeObserver(update);
    for (const el of Array.from(list.parentElement.children)) {
      if (el === list) break;
      observer.observe(el);
    }
    update();
    return () => observer.disconnect();
  }, []);

  const start = (source: SourceInfo) => {
    onDone();
    play(item, { source, startMs, replace: !!request.playing }).catch(
      (e: Error) => toast.error(e.message)
    );
  };
  const retry = () =>
    refresh.mutate(undefined, {
      onError: (e) => toast.error(e.message),
    });

  return (
    <>
      {art && (
        <div
          aria-hidden
          data-ui="versions-banner"
          className="pointer-events-none absolute inset-x-0 top-0 overflow-hidden"
          style={{ height: artHeight }}
        >
          <img
            src={art}
            alt=""
            className="absolute inset-x-0 top-0 aspect-video min-h-full w-full object-cover opacity-25"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-[--paper]/30 via-[--paper]/70 to-[--paper]" />
        </div>
      )}
      <div
        data-ui="versions-header"
        className="relative z-[1] space-y-3 px-4 pb-3 sm:px-5"
      >
        <div className="flex flex-wrap items-center gap-2">
          <p
            data-ui="versions-count"
            className="mr-auto text-sm text-[--muted]"
          >
            {info.data
              ? sources.length === 1
                ? '1 version'
                : `${sources.length} versions`
              : 'Finding versions'}
          </p>
          <Button
            size="sm"
            intent="gray-subtle"
            className="rounded-full"
            leftIcon={<BiInfoCircle />}
            onClick={() => {
              onDone();
              navigate(itemPath(item));
            }}
          >
            Details
          </Button>
          {canRefresh && (
            <Tooltip
              trigger={
                <IconButton
                  size="sm"
                  intent="gray-subtle"
                  className="rounded-full"
                  icon={
                    <BiRefresh className={cn(refreshing && 'animate-spin')} />
                  }
                  aria-label="Search again"
                  disabled={refreshing}
                  onClick={retry}
                />
              }
            >
              Search again
            </Tooltip>
          )}
        </div>
        {request.startMs > 0 && (
          <div className="grid grid-cols-2 gap-1 rounded-full bg-black/40 p-1">
            <Button
              size="sm"
              intent={startMs ? 'white' : 'gray-basic'}
              className="rounded-full"
              onClick={() => setStartMs(request.startMs)}
            >
              Resume from {clock(request.startMs)}
            </Button>
            <Button
              size="sm"
              intent={startMs ? 'gray-basic' : 'white'}
              className="rounded-full"
              onClick={() => setStartMs(0)}
            >
              From the start
            </Button>
          </div>
        )}
        {sources.length >= FILTER_FROM && (
          <TextInput
            value={filter}
            onValueChange={setFilter}
            placeholder="Filter versions"
            leftIcon={<BiSearch />}
            className="rounded-full"
          />
        )}
      </div>

      <div
        ref={listRef}
        data-ui="versions-list"
        className={cn(
          'relative z-[1] min-h-0 flex-1 space-y-2 overflow-y-auto border-t border-white/5 px-3 pb-5 pt-3 max-md:pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:px-5',
          info.isLoading && 'overflow-hidden'
        )}
      >
        {/* A phone's picker fills the screen, so it takes more to fill it. */}
        {info.isLoading &&
          Array.from({ length: 10 }, (_, i) => (
            <Skeleton
              key={i}
              className={cn('h-24 w-full rounded-xl', i >= 4 && 'md:hidden')}
            />
          ))}
        {info.isError && !info.data && (
          <div className="space-y-3 rounded-xl border border-red-500/20 bg-red-950/20 p-3">
            <p className="select-text text-sm text-red-300 [overflow-wrap:anywhere]">
              Could not load the versions: {info.error.message}
            </p>
            <Button
              size="sm"
              intent="gray-outline"
              className="rounded-full"
              loading={refreshing}
              onClick={retry}
            >
              Try again
            </Button>
          </div>
        )}
        {info.data && !sources.length && (
          <p className="py-6 text-center text-sm text-[--muted]">
            No versions were found.
          </p>
        )}
        {!!sources.length && !shown.length && (
          <p className="py-6 text-center text-sm text-[--muted]">
            No versions match.
          </p>
        )}

        {shown.map((source) => {
          const link = directUrl(client, item.Id!, source);
          const actions = [
            ...(template
              ? [
                  {
                    label: 'Open in external player',
                    icon: <BiLinkExternal />,
                    run: () => {
                      window.location.href = externalPlayerUrl(template, link);
                      onExternal();
                    },
                  },
                ]
              : []),
            {
              label: 'Copy stream link',
              icon: <BiCopy />,
              run: () =>
                copyToClipboard(link, {
                  onSuccess: () => toast.success('Stream link copied'),
                  onError: () => toast.error('Could not copy the link'),
                }),
            },
          ];
          return (
            <div
              key={source.Id}
              data-ui="version"
              data-playing={source.Id === request.playing || undefined}
              data-cached={source.aiostreams?.cached || undefined}
              className="group/version relative flex items-start rounded-xl border border-white/5 bg-white/[0.03] transition-colors hover:border-white/10 hover:bg-white/[0.06]"
            >
              <button
                type="button"
                onClick={() => start(source)}
                className="flex min-w-0 flex-1 items-start gap-3 rounded-xl p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-white/60"
              >
                <span className="hidden size-9 flex-none items-center justify-center rounded-full bg-white/10 text-white transition-colors group-hover/version:bg-white group-hover/version:text-black sm:flex">
                  <BiPlay className="text-xl" />
                </span>
                <span className="min-w-0 flex-1 space-y-1">
                  {/* Room for the menu, so only the first line gives way. */}
                  <span
                    aria-hidden
                    className="float-right ml-2 h-6 w-8 sm:hidden"
                  />
                  {source.Id === request.playing && (
                    <span
                      data-ui="version-playing"
                      className="mb-1 inline-block rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-black"
                    >
                      Playing
                    </span>
                  )}
                  <span
                    data-ui="version-name"
                    className="block whitespace-pre-line text-sm font-medium [overflow-wrap:anywhere] sm:text-base"
                  >
                    {source.aiostreams?.name || source.Name}
                  </span>
                  {source.aiostreams?.description && (
                    <span
                      data-ui="version-description"
                      className="block whitespace-pre-line text-xs text-gray-300 [overflow-wrap:anywhere] sm:text-sm"
                    >
                      {source.aiostreams.description}
                    </span>
                  )}
                </span>
              </button>
              <div className="absolute right-1.5 top-1.5 sm:hidden">
                <DropdownMenu
                  align="end"
                  trigger={
                    <IconButton
                      size="sm"
                      intent="gray-basic"
                      className="rounded-full"
                      icon={<BiDotsVerticalRounded />}
                      aria-label="More"
                    />
                  }
                >
                  {actions.map((a) => (
                    <DropdownMenuItem key={a.label} onClick={a.run}>
                      {a.icon}
                      {a.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenu>
              </div>
              <div className="hidden flex-none gap-1 p-2 sm:flex">
                {actions.map((a) => (
                  <Tooltip
                    key={a.label}
                    trigger={
                      <IconButton
                        size="sm"
                        intent="gray-basic"
                        className="rounded-full"
                        icon={a.icon}
                        aria-label={a.label}
                        onClick={a.run}
                      />
                    }
                  >
                    {a.label}
                  </Tooltip>
                ))}
              </div>
            </div>
          );
        })}

        {!terms.length &&
          notices.map((notice) => <Notice key={notice.Id} notice={notice} />)}
      </div>
    </>
  );
}

const NOTICE_ICONS: Record<string, React.ReactNode> = {
  error: <BiErrorCircle />,
  statistic: <BiBarChartAlt2 />,
  external: <BiLink />,
};

/** An addon message, pipeline error or statistic: text, and a link at most. */
function Notice({ notice }: { notice: SourceInfo }) {
  const { name, description, type, externalUrl } = notice.aiostreams!;
  const error = type === 'error';
  return (
    <div
      data-ui="version-notice"
      data-type={type}
      className={cn(
        'flex items-start gap-3 rounded-xl border p-3',
        error
          ? 'border-red-500/20 bg-red-950/20'
          : 'border-dashed border-white/10'
      )}
    >
      <span
        className={cn(
          'mt-0.5 flex-none text-lg',
          error ? 'text-red-300' : 'text-[--muted]'
        )}
      >
        {NOTICE_ICONS[type] ?? <BiInfoCircle />}
      </span>
      <div className="min-w-0 flex-1 select-text space-y-1 whitespace-pre-line text-sm [overflow-wrap:anywhere]">
        {name.trim() && (
          <p className={cn('font-medium', error && 'text-red-300')}>
            {name.trim()}
          </p>
        )}
        {description.trim() && (
          <p className="text-[--muted]">{description.trim()}</p>
        )}
      </div>
      {externalUrl && (
        <Tooltip
          trigger={
            <IconButton
              size="sm"
              intent="gray-basic"
              className="flex-none rounded-full"
              icon={<BiLinkExternal />}
              aria-label="Open link"
              onClick={() => window.open(externalUrl, '_blank', 'noopener')}
            />
          }
        >
          Open link
        </Tooltip>
      )}
    </div>
  );
}

/** An external player reports nothing back, so the user marks it themselves. */
function ExternalPrompt({
  item,
  onClose,
}: {
  item: BaseItemDto | null;
  onClose: () => void;
}) {
  const setPlayed = useSetPlayed();
  return (
    <Modal
      open={!!item}
      onOpenChange={(open) => !open && onClose()}
      title="Playing in your player"
      description="Your player does not report back, so mark it as watched once you finish."
      contentClass="max-w-md"
    >
      {item && (
        <>
          <p className="text-lg font-semibold">{itemTitle(item)}</p>
          {item.Type === 'Episode' && (
            <p className="text-sm text-[--muted]">{itemSubtitle(item)}</p>
          )}
          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <Button
              intent="gray-outline"
              className="rounded-full"
              onClick={onClose}
            >
              Not now
            </Button>
            <Button
              intent="white"
              className="rounded-full"
              loading={setPlayed.isPending}
              onClick={() =>
                setPlayed.mutate(
                  { itemId: item.Id!, played: true },
                  { onSuccess: onClose }
                )
              }
            >
              Mark as watched
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
