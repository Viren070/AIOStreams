import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import React from 'react';
import { toast } from 'sonner';
import {
  BiBarChartAlt2,
  BiCopy,
  BiDotsVerticalRounded,
  BiDownload,
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
import { Drawer } from '@aiostreams/ui/drawer';
import { Modal } from '@aiostreams/ui/modal';
import { useMediaQuery } from '@aiostreams/ui/hooks/media-query';
import { Skeleton } from '@aiostreams/ui/skeleton';
import { TextInput } from '@aiostreams/ui/text-input';
import { Tooltip } from '@aiostreams/ui/tooltip';
import { copyToClipboard } from '@aiostreams/ui/utils/clipboard';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '../lib/session';
import { useFeature } from '../lib/server-info';
import {
  useItem,
  usePlaybackInfo,
  usePlaybackInfoOptions,
  useRefreshPlaybackInfo,
  useSetPlayed,
} from '../lib/queries';
import { directUrl } from '../lib/playback/stream';
import {
  downloadable,
  downloadsHost,
  useAddDownloads,
  useFindDownloaded,
  useReplaceVersion,
  type Download,
} from '../lib/downloads';
import { chosenPlayer } from '../lib/playback/player-choice';
import { party } from '../lib/party/party';
import {
  lastVersions,
  noticeSources,
  playableSources,
  usePlay,
} from '../lib/playback/play';
import { currentHost } from '../lib/hosts';
import { focusOn, keyboardFocus, useRestoreFocus } from '../lib/input';
import { clock, itemSubtitle, itemTitle, ticksToMs } from '../lib/format';
import { cn } from '@aiostreams/ui/core/styling';
import { backdropUrl, landscapeUrl } from '../lib/images';
import { itemPath, navigate, to } from '../lib/paths';
import { settings, useSetting } from '../lib/settings';
import type { BaseItemDto, SourceInfo } from '../lib/types';
import { compileQuery, versionText } from '../lib/versions';
import { matchBadges } from '../lib/badges';
import { CachedImage } from './cached-image';
import { BadgeChip, useBadges } from './version-badges';

interface Request {
  item: BaseItemDto;
  startMs: number;
  /** From the player: the version playing, which a pick replaces. */
  playing?: string;
  /** A pick downloads `items`, which start with `item`, or replaces `replace`'s version. */
  download?: { items: BaseItemDto[]; replace?: Download };
}

interface PickerValue {
  /** Lists the item's versions; nothing is resolved until this is called. */
  open(item: BaseItemDto, opts?: { startMs?: number; playing?: string }): void;
  /** What Play does (see `useStraightPlay`); a hold does the other. */
  play(item: BaseItemDto, opts?: { startMs?: number; held?: boolean }): void;
  /**
   * Downloads the items, the first one's pick deciding the rest, or with
   * `replace` gives that download another version.
   */
  download(items: BaseItemDto[], opts?: { replace?: Download }): void;
}

const PickerContext = React.createContext<PickerValue | null>(null);

const rememberedVersion = (item: BaseItemDto, startMs: number) =>
  startMs > 0 ? lastVersions.get(item.Id!) : undefined;

export function useStraightPlay(): (
  item: BaseItemDto,
  startMs: number
) => boolean {
  const [autoPlay] = useSetting(settings.playback.autoPlayFirst);
  return React.useCallback(
    (item, startMs) => autoPlay || !!rememberedVersion(item, startMs),
    [autoPlay]
  );
}

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
  const straight = useStraightPlay();
  const queryClient = useQueryClient();
  const infoOptions = usePlaybackInfoOptions();
  const playVersion = usePlay();
  const addDownloads = useAddDownloads();
  const downloaded = useFindDownloaded();
  const [autoPick] = useSetting(settings.playback.autoPlayFirst);
  const latest = React.useRef({
    straight,
    queryClient,
    infoOptions,
    playVersion,
    addDownloads,
    downloaded,
    autoPick,
  });
  latest.current = {
    straight,
    queryClient,
    infoOptions,
    playVersion,
    addDownloads,
    downloaded,
    autoPick,
  };

  const value = React.useMemo<PickerValue>(() => {
    // The version last played when resuming, else the first; the list when none plays.
    const playStraight = async (item: BaseItemDto, startMs: number) => {
      const { queryClient, infoOptions, playVersion } = latest.current;
      const last = rememberedVersion(item, startMs);
      // The player page finds the version itself, and lists them if it is gone.
      if (
        last &&
        !currentHost().play &&
        chosenPlayer().kind !== 'link' &&
        party.state()?.status !== 'live'
      ) {
        navigate(to.play(item.Id!, last, startMs));
        return;
      }
      const notice = toast.loading(t`Finding a version…`);
      try {
        const info = await queryClient.fetchQuery(infoOptions(item.Id!));
        const sources = playableSources(info);
        const source = sources.find((s) => s.Id === last) ?? sources[0];
        if (!source) setRequest({ item, startMs });
        else
          await playVersion(item, {
            source,
            startMs,
            onExternal: () => setExternal(item),
          });
      } catch {
        setRequest({ item, startMs });
      } finally {
        setTimeout(() => toast.dismiss(notice));
      }
    };
    return {
      open: (item, opts) =>
        setRequest({
          item,
          startMs: opts?.startMs ?? 0,
          playing: opts?.playing,
        }),
      play: (item, opts) => {
        const startMs = opts?.startMs ?? 0;
        // Holding still lists the versions.
        const local = !opts?.held && latest.current.downloaded(item);
        if (local && chosenPlayer().kind !== 'link') {
          navigate(to.play(item.Id!, local.source!.Id!, startMs));
          return;
        }
        if (latest.current.straight(item, startMs) !== !!opts?.held)
          void playStraight(item, startMs);
        else setRequest({ item, startMs });
      },
      download: (items, opts) => {
        if (!items.length || !downloadsHost()) return;
        // As Play does, the setting skips the list and takes the first version.
        if (latest.current.autoPick && !opts?.replace)
          void latest.current.addDownloads(items);
        else
          setRequest({
            item: items[0],
            startMs: 0,
            download: { items, replace: opts?.replace },
          });
      },
    };
  }, []);
  const item = request?.item;
  const open = !!request;
  // A sheet over the player, or where a short screen leaves a dialog no room.
  const short = useMediaQuery('(max-height: 500px)');
  // Kept while it closes, so it leaves the way it came.
  const [sheet, setSheet] = React.useState(false);
  const wantSheet = !!request?.playing || short;
  if (request && sheet !== wantSheet) setSheet(wantSheet);
  const restoreFocus = useRestoreFocus(open);
  const versions = request && (
    <Versions
      key={request.item.Id}
      request={request}
      compact={sheet}
      onDone={() => setRequest(null)}
      onExternal={() => {
        setExternal(request.item);
        setRequest(null);
      }}
    />
  );
  return (
    <PickerContext.Provider value={value}>
      {children}
      {sheet ? (
        <Drawer
          data-ui="dialog"
          data-name="versions"
          open={open}
          onOpenChange={(open) => !open && setRequest(null)}
          onCloseAutoFocus={restoreFocus}
          title={item ? itemTitle(item) : t`Versions`}
          headerClass="sr-only"
          side="right"
          size="md"
          contentClass="flex flex-col gap-0 overflow-hidden p-0"
          closeClass="end-2 top-[calc(0.75rem+env(safe-area-inset-top))]"
        >
          {versions}
        </Drawer>
      ) : (
        <Modal
          data-ui="dialog"
          data-name="versions"
          open={open}
          onOpenChange={(open) => !open && setRequest(null)}
          onCloseAutoFocus={restoreFocus}
          title={item ? itemTitle(item) : undefined}
          description={
            item?.Type === 'Episode'
              ? itemSubtitle(item)
              : item?.ProductionYear || undefined
          }
          contentClass="flex w-full max-w-4xl flex-col gap-0 overflow-hidden p-0 max-md:h-[100dvh] max-md:rounded-none max-md:border-0 md:max-h-[85vh]"
          headerClass="relative z-[1] px-4 pb-3 pe-14 pt-5 text-start max-md:pt-[calc(1.25rem+env(safe-area-inset-top))] sm:px-5 sm:pe-14"
          closeClass="z-[2] max-md:top-[calc(1rem+env(safe-area-inset-top))]"
        >
          {versions}
        </Modal>
      )}
      <ExternalPrompt item={external} onClose={() => setExternal(null)} />
    </PickerContext.Provider>
  );
}

const FILTER_FROM = 8;

/** Versions drawn at a time; more come as the list nears its end. */
const PAGE = 40;

function Versions({
  request,
  onDone,
  onExternal,
  compact,
}: {
  request: Request;
  onDone: () => void;
  onExternal: () => void;
  /** In a narrow sheet, however wide the screen. */
  compact: boolean;
}) {
  const { client } = useSession();
  const { item } = request;
  const info = usePlaybackInfo(
    item.Id!,
    request.playing ? { kept: true } : { listing: true }
  );
  const refresh = useRefreshPlaybackInfo(item.Id!);
  const refreshing = info.isFetching || refresh.isPending;
  const canRefresh = useFeature('refreshVersions');
  const play = usePlay();
  const queryClient = useQueryClient();
  const infoOptions = usePlaybackInfoOptions();
  const addDownloads = useAddDownloads();
  const replaceVersion = useReplaceVersion();
  const download = request.download;
  const [startMs, setStartMs] = React.useState(request.startMs);
  const [filter, setFilter] = React.useState('');
  const [quickFilters] = useSetting(settings.playback.quickFilters);
  const [quickName, setQuickName] = React.useState<string | null>(null);
  const badges = useBadges();
  const sources = React.useMemo(
    () =>
      playableSources(info.data).filter((s) => !download || downloadable(s)),
    [info.data, download]
  );
  const texts = React.useMemo(
    () => new Map(sources.map((s) => [s, versionText(s)])),
    [sources]
  );
  const shownBadges = React.useMemo(
    () => new Map(sources.map((s) => [s, matchBadges(texts.get(s)!, badges)])),
    [sources, texts, badges]
  );
  const quick = React.useMemo(
    () =>
      quickFilters.map((q) => {
        const test = compileQuery(q.query, q.fields);
        const count = test
          ? sources.filter((s) => test(texts.get(s)!)).length
          : 0;
        return { ...q, test, count };
      }),
    [quickFilters, sources, texts]
  );
  const chosen = quick.find((q) => q.name === quickName);
  const typed = React.useMemo(() => compileQuery(filter), [filter]);
  const filtered = !!filter.trim() || !!chosen;
  const notices = noticeSources(info.data);
  const shown = sources.filter((s) => {
    const text = texts.get(s)!;
    return (!chosen || !!chosen.test?.(text)) && !!typed?.(text);
  });
  const pageKey = `${quickName ?? ''}|${filter}`;
  const [paged, setPaged] = React.useState({ key: pageKey, limit: PAGE });
  const limit = paged.key === pageKey ? paged.limit : PAGE;
  const partial = limit < shown.length;
  const more = React.useRef<HTMLDivElement>(null);
  const art =
    backdropUrl(client, item, { maxWidth: 896 }) ??
    landscapeUrl(client, item, { maxWidth: 896 });
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
  // Keys start on the actions above while the versions load, then once on the
  // first version, so a filter changing what shows leaves them where they are.
  const firstShown = shown[0]?.Id;
  const placed = React.useRef(false);
  React.useEffect(() => {
    if (!firstShown || placed.current) return;
    // After the dialog puts focus on its first button.
    const timer = setTimeout(() => {
      placed.current = true;
      const list = listRef.current;
      const at = keyboardFocus();
      const first = list?.querySelector<HTMLElement>('[data-ui=version-play]');
      if (!firstShown || !list || !first || !at || list.contains(at)) return;
      if (list.closest('[role=dialog]')?.contains(at)) focusOn(first);
    });
    return () => clearTimeout(timer);
  }, [firstShown]);
  React.useEffect(() => {
    const list = listRef.current;
    const end = more.current;
    if (!partial || !list || !end) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[entries.length - 1].isIntersecting)
          setPaged({ key: pageKey, limit: limit + PAGE });
      },
      // eslint-disable-next-line lingui/no-unlocalized-strings -- a root margin
      { root: list, rootMargin: '0px 0px 150% 0px' }
    );
    observer.observe(end);
    return () => observer.disconnect();
  }, [partial, limit, pageKey]);

  const start = (source: SourceInfo) => {
    if (download) {
      onDone();
      if (download.replace) replaceVersion(download.replace, source);
      else void addDownloads(download.items, source);
      return;
    }
    // The player's cached answer may predate this list and lack the version.
    queryClient.removeQueries({
      queryKey: infoOptions(item.Id!, source.Id ?? undefined).queryKey,
      exact: true,
    });
    onDone();
    play(item, {
      source,
      startMs,
      replace: !!request.playing,
      onExternal,
    }).catch((e: Error) => toast.error(e.message));
  };
  const retry = () =>
    refresh.mutate(undefined, {
      onError: (e) => toast.error(e.message),
    });

  const found = sources.length;
  const count = info.data
    ? plural(found, { one: '# version', other: '# versions' })
    : t`Finding versions`;
  const filterHint = info.data
    ? plural(found, {
        one: 'Filter # version',
        other: 'Filter # versions',
      })
    : t`Finding versions`;
  const others = download ? download.items.length - 1 : 0;
  const filtering = sources.length >= FILTER_FROM && !currentHost().tv;
  const loadError = info.error?.message ?? '';
  const searchAgain = canRefresh && (
    <Tooltip
      trigger={
        <IconButton
          data-ui="versions-action"
          data-name="search-again"
          size="sm"
          intent="gray-subtle"
          className="rounded-full"
          icon={<BiRefresh className={cn(refreshing && 'animate-spin')} />}
          aria-label={t`Search again`}
          disabled={refreshing}
          onClick={retry}
        />
      }
    >
      <Trans>Search again</Trans>
    </Tooltip>
  );
  const downloadHint = download && (
    <p data-ui="versions-download-hint" className="text-sm text-gray-300">
      {download.items.length > 1
        ? plural(others, {
            one: 'Pick the version to download. The other episode gets the same release where it has it.',
            other:
              'Pick the version to download. The other # episodes get the same release where they have it.',
          })
        : t`Pick the version to download.`}
    </p>
  );
  const quickRow = !!quick.length && !!sources.length && (
    <div
      data-ui="versions-quick"
      data-nav-group
      data-nav-enter="[role=tab][aria-selected=true]"
      role="tablist"
      aria-label={t`Quick filters`}
      className="-m-1 flex gap-1.5 overflow-x-auto p-1 [scrollbar-width:none]"
    >
      <Button
        data-ui="versions-quick-filter"
        role="tab"
        size="sm"
        intent={chosen ? 'gray-subtle' : 'white'}
        className="flex-none rounded-full"
        aria-selected={!chosen}
        tabIndex={chosen ? -1 : 0}
        onFocus={() => setQuickName(null)}
        onClick={() => setQuickName(null)}
      >
        <Trans>All</Trans>
      </Button>
      {quick.map((q) => (
        <Button
          key={q.name}
          data-ui="versions-quick-filter"
          role="tab"
          size="sm"
          intent={chosen === q ? 'white' : 'gray-subtle'}
          className="flex-none rounded-full"
          aria-selected={chosen === q}
          tabIndex={chosen === q ? 0 : -1}
          data-count={q.count}
          data-empty={!q.count || undefined}
          disabled={!q.count && chosen !== q}
          onFocus={() => setQuickName(q.name)}
          onClick={() => setQuickName(q.name)}
        >
          {q.name}
          <span className="ms-1.5 opacity-60">{q.count}</span>
        </Button>
      ))}
    </div>
  );
  const resumeAt = clock(request.startMs);
  // A version switched to while playing carries on where it was.
  const resumeToggle = request.startMs > 0 && !request.playing && (
    <div
      data-ui="versions-start"
      className="grid grid-cols-2 gap-1 rounded-full bg-black/40 p-1"
    >
      <Button
        size="sm"
        intent={startMs ? 'white' : 'gray-basic'}
        className="rounded-full"
        onClick={() => setStartMs(request.startMs)}
      >
        <Trans>Resume from {resumeAt}</Trans>
      </Button>
      <Button
        size="sm"
        intent={startMs ? 'gray-basic' : 'white'}
        className="rounded-full"
        onClick={() => setStartMs(0)}
      >
        <Trans>From the start</Trans>
      </Button>
    </div>
  );

  return (
    <>
      {art && !compact && (
        <div
          aria-hidden
          data-ui="versions-banner"
          className="pointer-events-none absolute inset-x-0 top-0 overflow-hidden"
          style={{ height: artHeight }}
        >
          <CachedImage
            src={art}
            alt=""
            className="absolute inset-x-0 top-0 aspect-video min-h-full w-full object-cover opacity-25"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-[--paper]/30 via-[--paper]/70 to-[--paper]" />
        </div>
      )}
      {compact ? (
        <div
          data-ui="versions-header"
          className="space-y-2 px-3 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top))]"
        >
          <div className="flex items-center gap-2 pe-9">
            {filtering ? (
              <div className="min-w-0 flex-1">
                <TextInput
                  data-ui="versions-filter"
                  value={filter}
                  onValueChange={setFilter}
                  placeholder={filterHint}
                  leftIcon={<BiSearch />}
                  className="rounded-full"
                />
              </div>
            ) : (
              <p
                data-ui="versions-count"
                className="me-auto text-sm text-[--muted]"
              >
                {count}
              </p>
            )}
            {searchAgain}
          </div>
          {quickRow}
          {downloadHint}
          {resumeToggle}
        </div>
      ) : (
        <div
          data-ui="versions-header"
          className="relative z-[1] space-y-3 px-4 pb-3 sm:px-5"
        >
          <div className="flex flex-wrap items-center gap-2">
            <p
              data-ui="versions-count"
              className="me-auto text-sm text-[--muted]"
            >
              {count}
            </p>
            <Button
              data-ui="versions-action"
              data-name="details"
              size="sm"
              intent="gray-subtle"
              className="rounded-full"
              leftIcon={<BiInfoCircle />}
              onClick={() => {
                onDone();
                navigate(itemPath(item));
              }}
            >
              <Trans>Details</Trans>
            </Button>
            {searchAgain}
          </div>
          {downloadHint}
          {resumeToggle}
          {filtering && (
            <TextInput
              data-ui="versions-filter"
              value={filter}
              onValueChange={setFilter}
              placeholder={t`Filter versions`}
              leftIcon={<BiSearch />}
              className="rounded-full"
            />
          )}
          {quickRow}
        </div>
      )}

      <div
        ref={listRef}
        data-ui="versions-list"
        data-nav-group
        className={cn(
          'relative z-[1] min-h-0 flex-1 space-y-2 overflow-y-auto border-t border-white/5 px-3 pb-5 pt-3 max-md:pb-[calc(1.25rem+env(safe-area-inset-bottom))]',
          !compact && 'sm:px-5',
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
              <Trans>Could not load the versions: {loadError}</Trans>
            </p>
            <Button
              size="sm"
              intent="gray-outline"
              className="rounded-full"
              loading={refreshing}
              onClick={retry}
            >
              <Trans>Try again</Trans>
            </Button>
          </div>
        )}
        {info.data && !sources.length && (
          <p className="py-6 text-center text-sm text-[--muted]">
            <Trans>No versions were found.</Trans>
          </p>
        )}
        {!!sources.length && !shown.length && (
          <p className="py-6 text-center text-sm text-[--muted]">
            {typed ? (
              <Trans>No versions match.</Trans>
            ) : (
              <Trans>That pattern is not a valid regular expression.</Trans>
            )}
          </p>
        )}

        {shown.slice(0, limit).map((source) => {
          const link = directUrl(client, item.Id!, source);
          const actions = [
            ...(!download && downloadable(source)
              ? [
                  {
                    name: 'download',
                    label: t`Download`,
                    icon: <BiDownload />,
                    run: () => {
                      onDone();
                      void addDownloads([item], source);
                    },
                  },
                ]
              : []),
            // A TV has nowhere to paste it.
            ...(currentHost().tv
              ? []
              : [
                  {
                    name: 'copy-link',
                    label: t`Copy stream link`,
                    icon: <BiCopy />,
                    run: () =>
                      copyToClipboard(link, {
                        onSuccess: () => toast.success(t`Stream link copied`),
                        onError: () => toast.error(t`Could not copy the link`),
                      }),
                  },
                ]),
          ];
          return (
            <div
              key={source.Id}
              data-ui="version"
              data-playing={source.Id === request.playing || undefined}
              data-cached={source.aiostreams?.cached || undefined}
              className="group/version relative flex items-start rounded-xl border border-white/5 bg-white/[0.03] transition-colors [contain-intrinsic-size:auto_7rem] [content-visibility:auto] hover:border-white/10 hover:bg-white/[0.06]"
            >
              <button
                type="button"
                data-ui="version-play"
                // Inside the card's border, where an outline would ring it twice.
                data-focus="own"
                onClick={() => start(source)}
                className="flex min-w-0 flex-1 items-start gap-3 rounded-xl p-3 text-start focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[--ring]"
              >
                <span
                  data-ui="version-play-icon"
                  className={cn(
                    'hidden size-9 flex-none items-center justify-center rounded-full bg-white/10 text-white transition-colors group-hover/version:bg-white group-hover/version:text-black',
                    !compact && 'sm:flex'
                  )}
                >
                  {download ? (
                    <BiDownload className="text-xl" />
                  ) : (
                    <BiPlay className="text-xl" />
                  )}
                </span>
                <span className="min-w-0 flex-1 space-y-1">
                  {/* Room for the menu, so only the first line gives way. */}
                  <span
                    aria-hidden
                    className={cn(
                      'float-right rtl:float-left ms-2 h-6 w-8',
                      !compact && 'sm:hidden'
                    )}
                  />
                  {source.Id === request.playing && (
                    <span
                      data-ui="version-playing"
                      className="mb-1 inline-block rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-black"
                    >
                      <Trans>Playing</Trans>
                    </span>
                  )}
                  <span
                    data-ui="version-name"
                    className={cn(
                      'block whitespace-pre-line text-sm font-medium [overflow-wrap:anywhere]',
                      !compact && 'sm:text-base'
                    )}
                  >
                    {source.aiostreams?.name || source.Name}
                  </span>
                  {source.aiostreams?.description && (
                    <span
                      data-ui="version-description"
                      className={cn(
                        'block whitespace-pre-line text-xs text-gray-300 [overflow-wrap:anywhere]',
                        !compact && 'sm:text-sm'
                      )}
                    >
                      {source.aiostreams.description}
                    </span>
                  )}
                  {!!shownBadges.get(source)?.length && (
                    <span
                      data-ui="version-badges"
                      className="flex flex-wrap gap-1 pt-1"
                    >
                      {shownBadges.get(source)!.map((badge) => (
                        <BadgeChip
                          key={badge.image ?? badge.label}
                          badge={badge}
                        />
                      ))}
                    </span>
                  )}
                </span>
              </button>
              {!!actions.length && (
                <div
                  className={cn(
                    'absolute end-1.5 top-1.5',
                    !compact && 'sm:hidden'
                  )}
                >
                  <DropdownMenu
                    data-ui="version-menu"
                    align="end"
                    trigger={
                      <IconButton
                        size="sm"
                        intent="gray-basic"
                        className="rounded-full"
                        icon={<BiDotsVerticalRounded />}
                        aria-label={t`More`}
                      />
                    }
                  >
                    {actions.map((a) => (
                      <DropdownMenuItem
                        key={a.label}
                        data-name={a.name}
                        onClick={a.run}
                      >
                        {a.icon}
                        {a.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenu>
                </div>
              )}
              {!!actions.length && (
                <div
                  className={cn(
                    'hidden flex-none gap-1 p-2',
                    !compact && 'sm:flex'
                  )}
                >
                  {actions.map((a) => (
                    <Tooltip
                      key={a.label}
                      trigger={
                        <IconButton
                          data-ui="version-action"
                          data-name={a.name}
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
              )}
            </div>
          );
        })}

        {partial && <div ref={more} aria-hidden className="h-px" />}
        {!filtered &&
          !partial &&
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
  // Other servers send the text in the name, the first line being its title.
  const [head = '', ...rest] = (notice.Name ?? '').split('\n');
  const { name, description, type, externalUrl } = notice.aiostreams ?? {
    name: head,
    description: rest.join('\n'),
    type: 'info',
  };
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
              aria-label={t`Open link`}
              onClick={() => window.open(externalUrl, '_blank', 'noopener')}
            />
          }
        >
          <Trans>Open link</Trans>
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
      data-ui="dialog"
      data-name="external-player"
      open={!!item}
      onOpenChange={(open) => !open && onClose()}
      title={t`Playing in your player`}
      description={t`Your player does not report back, so mark it as watched once you finish.`}
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
              <Trans>Not now</Trans>
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
              <Trans>Mark as watched</Trans>
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
