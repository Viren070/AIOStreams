import { t } from '@lingui/core/macro';
import React from 'react';
import { toast } from 'sonner';
import { Drawer } from '@aiostreams/ui/drawer';
import { Modal } from '@aiostreams/ui/modal';
import { useMediaQuery } from '@aiostreams/ui/hooks/media-query';
import { useQueryClient } from '@tanstack/react-query';
import {
  PRELOADED_MS,
  usePlaybackInfoOptions,
} from '@/lib/jellyfin/playback-info';
import { useItem } from '@/lib/jellyfin/queries';
import {
  downloadsHost,
  useAddDownloads,
  useFindDownloaded,
  type Download,
} from '@/lib/downloads';
import { chosenPlayer } from '@/lib/playback/player-choice';
import { party } from '@/lib/party/party';
import {
  findVersion,
  lastVersions,
  playableSources,
} from '@/lib/playback/sources';
import { usePlay } from '@/features/player/use-play';
import { currentHost } from '@/lib/hosts';
import { useRestoreFocus } from '@/lib/input';
import { airsLater, itemSubtitle, itemTitle, ticksToMs } from '@/lib/format';
import { itemPath, navigate, to } from '@/lib/paths';
import { settings, useSetting } from '@/lib/settings';
import type { BaseItemDto } from '@/lib/jellyfin/types';
import { type Request, Versions, focusSelf } from './version-list';
import { type Unaired, UnairedQuestion } from './unaired-question';
import { ExternalPrompt } from './external-prompt';

interface PickerValue {
  /** Lists the item's versions; nothing is resolved until this is called. */
  open(
    item: BaseItemDto,
    opts?: { startMs?: number; playing?: string; playlist?: string }
  ): void;
  /**
   * What Play does (see `useStraightPlay`); a hold does the other. A `version`
   * plays straight, in place of the one remembered.
   */
  play(
    item: BaseItemDto,
    opts?: {
      startMs?: number;
      held?: boolean;
      version?: string;
      replace?: boolean;
      playlist?: string;
    }
  ): void;
  /**
   * Downloads the items, the first one's pick deciding the rest, or with
   * `replace` gives that download another version.
   */
  download(items: BaseItemDto[], opts?: { replace?: Download }): void;
  /** Runs `go`, asking first about an episode that hasn't aired yet. */
  askIfUnaired(
    items: BaseItemDto[],
    go: () => void,
    action?: Unaired['action']
  ): void;
}

const PickerContext = React.createContext<PickerValue | null>(null);

const isLive = (item: BaseItemDto) =>
  item.Type === 'TvChannel' || item.Type === 'Program';

/** A channel or programme plays straight, in the version it last played. */
const rememberedVersion = (item: BaseItemDto, startMs: number) =>
  startMs > 0 || isLive(item) ? lastVersions.get(item.Id!) : undefined;

export function useStraightPlay(): (
  item: BaseItemDto,
  startMs: number
) => boolean {
  const [autoPlay] = useSetting(settings.playback.autoPlayFirst);
  return React.useCallback(
    (item, startMs) =>
      autoPlay || isLive(item) || !!rememberedVersion(item, startMs),
    [autoPlay]
  );
}

/** Opens the picker once, then drops `pick` from the address. */
export function PickOnArrival({
  itemId,
  playlist,
}: {
  itemId: string;
  playlist?: string;
}) {
  const item = useItem(itemId);
  const picker = useVersionPicker();
  const opened = React.useRef(false);
  React.useEffect(() => {
    if (!item.data || opened.current) return;
    opened.current = true;
    picker.open(item.data, {
      startMs: ticksToMs(item.data.UserData?.PlaybackPositionTicks),
      playlist,
    });
    navigate(itemPath(item.data), { replace: true });
  }, [item.data, picker, playlist]);
  return null;
}

/** With the setting on, asks for the item's versions before Play does. */
export function usePreloadVersions(item: BaseItemDto | undefined) {
  const [preload] = useSetting(settings.playback.preloadVersions);
  const queryClient = useQueryClient();
  const infoOptions = usePlaybackInfoOptions();
  const downloaded = useFindDownloaded();
  const id = item?.Id;
  const local = !!item && !!downloaded(item);
  React.useEffect(() => {
    if (preload && id && !local)
      void queryClient.prefetchQuery({
        ...infoOptions(id),
        staleTime: PRELOADED_MS,
      });
  }, [preload, id, local, queryClient, infoOptions]);
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
  const [unaired, setUnaired] = React.useState<Unaired | null>(null);
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
    const playStraight = async (
      item: BaseItemDto,
      startMs: number,
      opts: { version?: string; replace?: boolean; playlist?: string } = {}
    ) => {
      const { queryClient, infoOptions, playVersion } = latest.current;
      const { replace, playlist } = opts;
      const last = opts.version
        ? { id: opts.version }
        : rememberedVersion(item, startMs);
      // The player page finds the version itself, and lists them if it is gone.
      if (
        !currentHost().play &&
        chosenPlayer().kind !== 'link' &&
        party.state()?.status !== 'live'
      ) {
        navigate(to.play(item.Id!, last?.id ?? '', startMs, playlist), {
          replace,
        });
        return;
      }
      const notice = toast.loading(t`Finding a version…`);
      try {
        const info = await queryClient.fetchQuery(infoOptions(item.Id!));
        const sources = playableSources(info);
        const source = findVersion(sources, last) ?? sources[0];
        if (!source) setRequest({ item, startMs, replace, playlist });
        else
          await playVersion(item, {
            source,
            startMs,
            replace,
            playlist,
            onExternal: () => setExternal(item),
          });
      } catch {
        setRequest({ item, startMs, replace, playlist });
      } finally {
        setTimeout(() => toast.dismiss(notice));
      }
    };
    const askIfUnaired = (
      items: BaseItemDto[],
      go: () => void,
      action: Unaired['action'] = 'play'
    ) => {
      const item = items.find(airsLater);
      if (item) setUnaired({ item, go, action });
      else go();
    };
    return {
      askIfUnaired,
      open: (item, opts) =>
        askIfUnaired(opts?.playing ? [] : [item], () =>
          setRequest({
            item,
            startMs: opts?.startMs ?? 0,
            playing: opts?.playing,
            playlist: opts?.playlist,
          })
        ),
      play: (item, opts) => {
        const startMs = opts?.startMs ?? 0;
        const version = opts?.version;
        const replace = opts?.replace;
        const playlist = opts?.playlist;
        // Holding still lists the versions.
        const local = !opts?.held && latest.current.downloaded(item);
        if (
          local &&
          chosenPlayer().kind !== 'link' &&
          (!version || version === local.source!.Id)
        ) {
          navigate(to.play(item.Id!, local.source!.Id!, startMs, playlist), {
            replace,
          });
          return;
        }
        askIfUnaired([item], () => {
          if (
            version ||
            latest.current.straight(item, startMs) !== !!opts?.held
          )
            void playStraight(item, startMs, { version, replace, playlist });
          else setRequest({ item, startMs, replace, playlist });
        });
      },
      download: (items, opts) => {
        if (!items.length || !downloadsHost()) return;
        askIfUnaired(
          opts?.replace ? [] : items,
          () => {
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
          'download'
        );
      },
    };
  }, []);
  const item = request?.item;
  const open = !!request;
  // A sheet over the player, or where a short screen leaves a dialog no room.
  const short = useMediaQuery('(max-height: 500px)');
  const touch = useMediaQuery('(pointer: coarse)') && !currentHost().tv;
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
          onOpenAutoFocus={touch ? focusSelf : undefined}
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
          onOpenAutoFocus={touch ? focusSelf : undefined}
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
      <UnairedQuestion asking={unaired} onClose={() => setUnaired(null)} />
    </PickerContext.Provider>
  );
}
