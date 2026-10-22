import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import React from 'react';
import { toast } from 'sonner';
import {
  LuArrowDown,
  LuArrowUp,
  LuChevronLeft,
  LuEllipsisVertical,
  LuListVideo,
  LuLoaderCircle,
  LuPencil,
  LuPlay,
  LuPlus,
  LuTrash2,
} from 'react-icons/lu';
import { Button, IconButton } from '@aiostreams/ui/button';
import { Drawer } from '@aiostreams/ui/drawer';
import { DropdownMenu, DropdownMenuItem } from '@aiostreams/ui/dropdown-menu';
import { Modal } from '@aiostreams/ui/modal';
import { Skeleton } from '@aiostreams/ui/skeleton';
import { TextInput } from '@aiostreams/ui/text-input';
import { Tooltip } from '@aiostreams/ui/tooltip';
import {
  ConfirmationDialog,
  useConfirmationDialog,
} from '@aiostreams/ui/shared/confirmation-dialog';
import { cn } from '@aiostreams/ui/core/styling';
import { useSession } from '../lib/session';
import { mergeRows, useNextUp, useResume } from '../lib/queries';
import {
  lastPlaylist,
  playable,
  usePlaylistEdits,
  usePlaylistEntries,
  usePlaylists,
} from '../lib/playlists';
import { landscapeUrls, posterUrl } from '../lib/images';
import {
  duration,
  fullTitle,
  itemSubtitle,
  itemTitle,
  progressOf,
  ticksToMs,
} from '../lib/format';
import { focusDialog, useDialogStart, useRestoreFocus } from '../lib/input';
import type { BaseItemDto } from '../lib/types';
import { Artwork, ProgressBar, WatchedMark } from './cards';
import { useVersionPicker } from './version-picker';

const NAME_LENGTH = 200;
/** Suggestions offered under a playlist. */
const SUGGESTED = 8;

interface Sheet {
  open: boolean;
  playlist?: string;
  adding: BaseItemDto[] | null;
}

let sheet: Sheet = { open: false, adding: null };
const listeners = new Set<() => void>();

function setSheet(next: Partial<Sheet>): void {
  sheet = { ...sheet, ...next };
  for (const listener of listeners) listener();
}

export const openPlaylists = (playlist?: string) =>
  setSheet({ open: true, playlist });

export const openAddToPlaylist = (items: BaseItemDto[]) =>
  setSheet({ adding: items });

function useSheet() {
  return React.useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    () => sheet
  );
}

const resumeMs = (item: BaseItemDto) =>
  item.UserData?.Played ? 0 : ticksToMs(item.UserData?.PlaybackPositionTicks);

const countLabel = (count: number) =>
  plural(count, { one: '# title', other: '# titles' });

/** The sheet and the add dialog the pages open; the player has its own sheet. */
export function PlaylistsHost() {
  const { open, playlist, adding } = useSheet();
  const picker = useVersionPicker();
  return (
    <>
      <PlaylistSheet
        open={open}
        playlist={playlist}
        onClose={() => setSheet({ open: false })}
        onPlay={(entry, id) => {
          setSheet({ open: false });
          picker.play(entry, { startMs: resumeMs(entry), playlist: id });
        }}
      />
      <AddToPlaylist
        items={adding}
        onClose={() => setSheet({ adding: null })}
      />
    </>
  );
}

export function PlaylistSheet({
  open,
  playlist,
  playing,
  loadingId = null,
  onPlay,
  onClose,
}: {
  open: boolean;
  /** Opens on this playlist, else on the list of them. */
  playlist?: string;
  /** The title playing now, which its row says. */
  playing?: string;
  loadingId?: string | null;
  onPlay(entry: BaseItemDto, playlist: string): void;
  onClose(): void;
}) {
  const [shown, setShown] = React.useState(playlist ?? null);
  // Back goes to the list only when the playlist was opened from it.
  const [fromList, setFromList] = React.useState(false);
  const [left, setLeft] = React.useState<string | null>(null);
  const [opened, setOpened] = React.useState(false);
  if (open !== opened) {
    setOpened(open);
    if (open) {
      setShown(playlist ?? null);
      setFromList(false);
      setLeft(null);
    }
  }
  const toList = () => {
    setLeft(shown);
    setShown(null);
  };
  const restoreFocus = useRestoreFocus(open);
  return (
    <Drawer
      data-ui="dialog"
      data-name="playlists"
      open={open}
      onOpenChange={(next) => !next && onClose()}
      onEscapeKeyDown={(e) => {
        if (!shown || !fromList) return;
        e.preventDefault();
        toList();
      }}
      onOpenAutoFocus={focusDialog}
      onCloseAutoFocus={restoreFocus}
      title={t`Playlists`}
      headerClass="sr-only"
      side="right"
      size="md"
      contentClass="flex flex-col gap-0 overflow-hidden p-0"
      closeClass="end-2 top-[calc(0.75rem+env(safe-area-inset-top))]"
    >
      {shown ? (
        <PlaylistView
          key={shown}
          id={shown}
          playing={playing}
          loadingId={loadingId}
          onBack={toList}
          onPlay={(entry) => onPlay(entry, shown)}
        />
      ) : (
        <PlaylistIndex
          left={left}
          onOpen={(id) => {
            setFromList(true);
            setShown(id);
          }}
        />
      )}
    </Drawer>
  );
}

function Header({
  kicker,
  title,
  onBack,
}: {
  kicker: string;
  title?: string;
  onBack?: () => void;
}) {
  return (
    <div
      data-ui="playlists-header"
      className="flex items-center gap-2 px-4 pb-3 pe-12 pt-[calc(0.75rem+env(safe-area-inset-top))]"
    >
      {onBack && (
        <IconButton
          data-ui="playlists-back"
          size="sm"
          intent="gray-subtle"
          className="-ms-1 flex-none rounded-full"
          icon={<LuChevronLeft className="rtl:-scale-x-100" />}
          aria-label={t`All playlists`}
          onClick={onBack}
        />
      )}
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wider text-[--muted]">
          {kicker}
        </p>
        {title && <p className="truncate font-semibold">{title}</p>}
      </div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div data-nav-wait className="space-y-1 p-2">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex gap-3 p-2">
          <Skeleton className="aspect-video h-auto w-28 flex-none rounded-lg sm:w-32" />
          <div className="flex-1 space-y-2 pt-1">
            <Skeleton className="h-4 w-3/4 rounded" />
            <Skeleton className="h-3 w-1/3 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

function NameForm({
  initial = '',
  placeholder,
  action,
  onSave,
  onCancel,
}: {
  initial?: string;
  placeholder: string;
  action: string;
  onSave(name: string): Promise<unknown> | void;
  onCancel?: () => void;
}) {
  const [name, setName] = React.useState(initial);
  const [saving, setSaving] = React.useState(false);
  const trimmed = name.trim();
  return (
    <form
      data-ui="playlist-name-form"
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!trimmed || saving) return;
        setSaving(true);
        void Promise.resolve(onSave(trimmed)).then(
          () => {
            setSaving(false);
            setName('');
          },
          (error: Error) => {
            setSaving(false);
            toast.error(error.message);
          }
        );
      }}
    >
      <div className="min-w-0 flex-1">
        <TextInput
          data-ui="playlist-name"
          value={name}
          onValueChange={setName}
          placeholder={placeholder}
          maxLength={NAME_LENGTH}
          autoFocus={!!onCancel}
          className="rounded-full"
        />
      </div>
      <Button
        type="submit"
        intent="white"
        className="flex-none rounded-full"
        loading={saving}
        disabled={!trimmed}
      >
        {action}
      </Button>
      {onCancel && (
        <Button
          type="button"
          intent="gray-outline"
          className="flex-none rounded-full"
          onClick={onCancel}
        >
          <Trans>Cancel</Trans>
        </Button>
      )}
    </form>
  );
}

function PlaylistIndex({
  left,
  onOpen,
}: {
  /** The playlist just left, which keys come back to. */
  left: string | null;
  onOpen(id: string): void;
}) {
  const { client } = useSession();
  const playlists = usePlaylists();
  const edits = usePlaylistEdits();
  const list = playlists.data ?? [];
  const box = React.useRef<HTMLDivElement>(null);
  useDialogStart(box, !playlists.isLoading);
  const start = list.some((p) => p.Id === left) ? left : list[0]?.Id;
  return (
    <>
      <Header kicker={t`Playlists`} />
      <div className="border-t border-white/5 px-4 py-3">
        <NameForm
          placeholder={t`New playlist`}
          action={t`Create`}
          onSave={(name) => edits.create(name, []).then(onOpen)}
        />
      </div>
      {playlists.isLoading ? (
        <ListSkeleton />
      ) : (
        <div
          ref={box}
          data-ui="playlists-list"
          data-nav-group
          className="min-h-0 flex-1 space-y-1 overflow-y-auto border-t border-white/5 p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]"
        >
          {playlists.isError && !list.length && (
            <p className="py-6 text-center text-sm text-[--muted]">
              <Trans>Could not load the playlists.</Trans>
            </p>
          )}
          {playlists.isSuccess && !list.length && (
            <p className="px-2 py-6 text-center text-sm text-[--muted]">
              <Trans>
                No playlists yet. Make one here, or add a title to one from its
                menu.
              </Trans>
            </p>
          )}
          {list.map((playlist) => {
            const cover = posterUrl(client, playlist, { maxWidth: 64 });
            const count = playlist.ChildCount ?? 0;
            return (
              <button
                key={playlist.Id}
                data-nav-start={playlist.Id === start || undefined}
                type="button"
                data-ui="playlists-entry"
                data-focus="own"
                onClick={() => onOpen(playlist.Id!)}
                className="flex w-full items-center gap-3 rounded-xl p-2 text-start outline-none transition-colors hover:bg-white/5 focus-visible:bg-white/10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[--ring] [[data-tv]_&]:focus-visible:ring-[3px]"
              >
                <span className="relative flex aspect-[2/3] w-12 flex-none items-center justify-center overflow-hidden rounded-md bg-gray-900 ring-1 ring-white/5">
                  {cover ? (
                    <Artwork src={cover} alt="" />
                  ) : (
                    <LuListVideo className="text-xl text-[--muted]" />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">
                    {playlist.Name}
                  </span>
                  <span className="block text-xs text-[--muted]">
                    {countLabel(count)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

function EntryThumb({ item }: { item: BaseItemDto }) {
  const { client } = useSession();
  const progress = progressOf(item);
  return (
    <div
      data-ui="playlist-entry-image"
      className="relative aspect-video w-28 flex-none overflow-hidden rounded-lg bg-gray-900 ring-1 ring-white/5 sm:w-32"
    >
      <Artwork
        src={(width) => landscapeUrls(client, item, { maxWidth: width })}
        alt={itemTitle(item)}
      />
      {item.UserData?.Played && <WatchedMark />}
      {!item.UserData?.Played && progress != null && progress > 0 && (
        <ProgressBar percent={progress} />
      )}
    </div>
  );
}

/** A movie's year and length, or an episode's code and name. */
function entryLine(item: BaseItemDto): string {
  if (item.Type === 'Episode') return itemSubtitle(item);
  return [item.ProductionYear, duration(ticksToMs(item.RunTimeTicks))]
    .filter(Boolean)
    .join(' · ');
}

function EntryText({ item, note }: { item: BaseItemDto; note?: string }) {
  return (
    <span className="min-w-0 flex-1 py-0.5">
      <span className="line-clamp-2 text-sm font-semibold">
        {itemTitle(item)}
      </span>
      <span className="mt-1 block truncate text-xs text-[--muted]">
        {note ? (
          <span className="font-medium text-white">{note}</span>
        ) : (
          entryLine(item)
        )}
      </span>
    </span>
  );
}

function PlaylistView({
  id,
  playing,
  loadingId,
  onBack,
  onPlay,
}: {
  id: string;
  playing?: string;
  loadingId: string | null;
  onBack(): void;
  onPlay(entry: BaseItemDto): void;
}) {
  const playlists = usePlaylists();
  const entries = usePlaylistEntries(id);
  const edits = usePlaylistEdits();
  const [renaming, setRenaming] = React.useState(false);
  const name = playlists.data?.find((p) => p.Id === id)?.Name ?? '';
  const list = entries.data ?? [];
  const runtime = duration(
    list.reduce((ms, e) => ms + ticksToMs(e.RunTimeTicks), 0)
  );
  const first =
    list.find((e) => playable(e) && !e.UserData?.Played) ?? list.find(playable);
  const confirmDelete = useConfirmationDialog({
    title: t`Delete ${name}`,
    description: t`The playlist goes; the titles in it stay.`,
    actionText: t`Delete`,
    onConfirm: () =>
      void edits
        .delete(id)
        .then(onBack, (error: Error) => toast.error(error.message)),
  });
  const failed = (error: Error) => toast.error(error.message);
  const listRef = React.useRef<HTMLDivElement>(null);
  const hasPlaying = !!playing && list.some((e) => e.Id === playing);
  useDialogStart(listRef, !entries.isLoading);
  React.useEffect(() => {
    if (!hasPlaying) return;
    const timer = setTimeout(() => {
      const box = listRef.current;
      const row = box?.querySelector<HTMLElement>('[data-current]');
      if (box && row)
        box.scrollTop =
          row.offsetTop - (box.clientHeight - row.offsetHeight) / 2;
    });
    return () => clearTimeout(timer);
  }, [hasPlaying]);

  return (
    <>
      <Header kicker={t`Playlist`} title={name || undefined} onBack={onBack} />
      <div
        data-ui="playlist-actions"
        className="space-y-3 border-t border-white/5 px-4 py-3"
      >
        {renaming ? (
          <NameForm
            initial={name}
            placeholder={t`Name`}
            action={t`Save`}
            onSave={(next) =>
              edits.rename(id, next).then(() => setRenaming(false))
            }
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <div className="flex items-center gap-2">
            <Button
              data-ui="playlist-action"
              data-name="play"
              data-nav-start={!hasPlaying || undefined}
              intent="white"
              className="rounded-full"
              leftIcon={<LuPlay />}
              disabled={!first}
              onClick={() => first && onPlay(first)}
            >
              <Trans>Play</Trans>
            </Button>
            <p className="me-auto truncate text-sm text-[--muted]">
              {entries.data &&
                [countLabel(list.length), runtime].filter(Boolean).join(' · ')}
            </p>
            <Tooltip
              trigger={
                <IconButton
                  data-ui="playlist-action"
                  data-name="rename"
                  size="sm"
                  intent="gray-subtle"
                  className="rounded-full"
                  icon={<LuPencil />}
                  aria-label={t`Rename`}
                  onClick={() => setRenaming(true)}
                />
              }
            >
              <Trans>Rename</Trans>
            </Tooltip>
            <Tooltip
              trigger={
                <IconButton
                  data-ui="playlist-action"
                  data-name="delete"
                  size="sm"
                  intent="alert-subtle"
                  className="rounded-full"
                  icon={<LuTrash2 />}
                  aria-label={t`Delete playlist`}
                  onClick={confirmDelete.open}
                />
              }
            >
              <Trans>Delete playlist</Trans>
            </Tooltip>
          </div>
        )}
      </div>
      {entries.isLoading ? (
        <ListSkeleton />
      ) : (
        <div
          ref={listRef}
          data-ui="playlist-entries"
          className="relative min-h-0 flex-1 overflow-y-auto border-t border-white/5 p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]"
        >
          {entries.isError && !list.length && (
            <p className="py-6 text-center text-sm text-[--muted]">
              <Trans>Could not load this playlist.</Trans>
            </p>
          )}
          {entries.isSuccess && !list.length && (
            <p className="px-2 py-6 text-center text-sm text-[--muted]">
              <Trans>
                Nothing here yet. Add titles from their menu, or from the
                suggestions below.
              </Trans>
            </p>
          )}
          <div data-nav-group className="space-y-1">
            {list.map((entry, i) => (
              <EntryRow
                key={entry.PlaylistItemId ?? entry.Id}
                entry={entry}
                current={entry.Id === playing}
                loading={loadingId === entry.Id}
                onPlay={() => onPlay(entry)}
                onMoveUp={
                  i > 0
                    ? () => void edits.move(id, entry, i - 1).catch(failed)
                    : undefined
                }
                onMoveDown={
                  i < list.length - 1
                    ? () => void edits.move(id, entry, i + 1).catch(failed)
                    : undefined
                }
                onRemove={() => void edits.remove(id, entry).catch(failed)}
              />
            ))}
          </div>
          {entries.isSuccess && <Suggestions id={id} entries={list} />}
        </div>
      )}
      <ConfirmationDialog {...confirmDelete} />
    </>
  );
}

const ROW =
  'flex w-full min-w-0 flex-1 items-start gap-3 rounded-xl p-2 text-start outline-none transition-colors hover:bg-white/5 focus-visible:bg-white/10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[--ring] disabled:pointer-events-none [[data-tv]_&]:focus-visible:ring-[3px]';

function EntryRow({
  entry,
  current,
  loading,
  onPlay,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  entry: BaseItemDto;
  current: boolean;
  loading: boolean;
  onPlay(): void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onRemove(): void;
}) {
  return (
    <div
      data-ui="playlist-entry"
      data-current={current || undefined}
      className={cn(
        'flex items-start gap-1 rounded-xl',
        current && 'bg-white/10'
      )}
    >
      <button
        type="button"
        data-ui="playlist-entry-play"
        data-focus="own"
        data-nav-start={current || undefined}
        aria-current={current || undefined}
        disabled={!playable(entry)}
        onClick={onPlay}
        className={ROW}
      >
        <EntryThumb item={entry} />
        <EntryText item={entry} note={current ? t`Playing` : undefined} />
        {loading && (
          <LuLoaderCircle className="mt-1 flex-none animate-spin text-lg" />
        )}
      </button>
      <DropdownMenu
        data-ui="playlist-entry-menu"
        align="end"
        trigger={
          <IconButton
            size="sm"
            intent="gray-basic"
            className="mt-2 flex-none rounded-full"
            icon={<LuEllipsisVertical />}
            aria-label={t`More`}
          />
        }
      >
        {onMoveUp && (
          <DropdownMenuItem data-name="move-up" onClick={onMoveUp}>
            <LuArrowUp />
            <Trans>Move up</Trans>
          </DropdownMenuItem>
        )}
        {onMoveDown && (
          <DropdownMenuItem data-name="move-down" onClick={onMoveDown}>
            <LuArrowDown />
            <Trans>Move down</Trans>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem data-name="remove" onClick={onRemove}>
          <LuTrash2 />
          <Trans>Remove from playlist</Trans>
        </DropdownMenuItem>
      </DropdownMenu>
    </div>
  );
}

/** What the user is part way through or would watch next, which isn't in the playlist yet. */
function Suggestions({ id, entries }: { id: string; entries: BaseItemDto[] }) {
  const resume = useResume();
  const nextUp = useNextUp();
  const edits = usePlaylistEdits();
  const [adding, setAdding] = React.useState<string | null>(null);
  const suggested = React.useMemo(() => {
    const listed = new Set(entries.map((e) => e.Id));
    return mergeRows(resume.data?.Items, nextUp.data?.Items)
      .filter((item) => playable(item) && !listed.has(item.Id))
      .slice(0, SUGGESTED);
  }, [entries, resume.data, nextUp.data]);
  if (!suggested.length) return null;
  return (
    <div data-ui="playlist-suggestions" className="mt-4 space-y-1">
      <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wider text-[--muted]">
        <Trans>Add from Continue watching</Trans>
      </p>
      <div data-nav-group className="space-y-1">
        {suggested.map((item) => (
          <button
            key={item.Id}
            type="button"
            data-ui="playlist-suggestion"
            data-focus="own"
            disabled={adding !== null}
            onClick={() => {
              setAdding(item.Id!);
              edits
                .add(id, [item.Id!])
                .catch((error: Error) => toast.error(error.message))
                .finally(() => setAdding(null));
            }}
            className={ROW}
          >
            <EntryThumb item={item} />
            <EntryText item={item} />
            <span
              aria-hidden
              className="mt-1 flex size-8 flex-none items-center justify-center rounded-full bg-white/10 text-lg"
            >
              {adding === item.Id ? (
                <LuLoaderCircle className="animate-spin" />
              ) : (
                <LuPlus />
              )}
            </span>
            <span className="sr-only">
              <Trans>Add to this playlist</Trans>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function AddToPlaylist({
  items,
  onClose,
}: {
  items: BaseItemDto[] | null;
  onClose(): void;
}) {
  const { client, user } = useSession();
  const open = !!items?.length;
  const playlists = usePlaylists(open);
  const edits = usePlaylistEdits();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<{
    id: string;
    name: string;
    fresh: boolean;
  } | null>(null);
  const [shownFor, setShownFor] = React.useState(items);
  if (items !== shownFor) {
    setShownFor(items);
    setDone(null);
  }
  const restoreFocus = useRestoreFocus(open);
  const box = React.useRef<HTMLDivElement>(null);
  useDialogStart(box, open && !done && !playlists.isLoading);
  const last = open ? lastPlaylist.get(user.Id!) : null;
  const list = React.useMemo(() => {
    const all = playlists.data ?? [];
    const recent = all.find((p) => p.Id === last);
    return recent ? [recent, ...all.filter((p) => p !== recent)] : all;
  }, [playlists.data, last]);
  const addTo = (playlist: BaseItemDto) => {
    if (!items || busy) return;
    const name = playlist.Name ?? '';
    setBusy(playlist.Id!);
    edits
      .add(
        playlist.Id!,
        items.map((i) => i.Id!)
      )
      .then(
        (fresh) => setDone({ id: playlist.Id!, name, fresh }),
        () => toast.error(t`Could not add to ${name}`)
      )
      .finally(() => setBusy(null));
  };
  const name = done?.name ?? '';
  return (
    <Modal
      data-ui="dialog"
      data-name="add-to-playlist"
      open={open}
      onOpenChange={(next) => !next && onClose()}
      onOpenAutoFocus={focusDialog}
      onCloseAutoFocus={restoreFocus}
      title={t`Add to playlist`}
      description={items?.length === 1 ? fullTitle(items[0]) : undefined}
      contentClass="max-w-md"
    >
      {done ? (
        <>
          <p data-ui="add-to-playlist-done" className="text-lg font-semibold">
            {done.fresh ? t`Added to ${name}` : t`Already in ${name}`}
          </p>
          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <Button
              data-ui="add-to-playlist-action"
              data-name="open"
              intent="gray-outline"
              className="rounded-full"
              onClick={() => {
                onClose();
                openPlaylists(done.id);
              }}
            >
              <Trans>Open playlist</Trans>
            </Button>
            <Button
              data-ui="add-to-playlist-action"
              data-name="done"
              intent="white"
              className="rounded-full"
              autoFocus
              onClick={onClose}
            >
              <Trans>Done</Trans>
            </Button>
          </div>
        </>
      ) : (
        <>
          <NameForm
            placeholder={t`New playlist`}
            action={t`Create`}
            onSave={(name) =>
              edits
                .create(
                  name,
                  (items ?? []).map((i) => i.Id!)
                )
                .then((id) => setDone({ id, name, fresh: true }))
            }
          />
          <div
            ref={box}
            data-nav-group
            className="-mx-2 max-h-[50vh] space-y-1 overflow-y-auto"
          >
            {playlists.isLoading && (
              <Skeleton className="mx-2 h-14 rounded-xl" />
            )}
            {list.map((playlist, i) => {
              const cover = posterUrl(client, playlist, { maxWidth: 48 });
              return (
                <button
                  key={playlist.Id}
                  type="button"
                  data-ui="add-to-playlist-entry"
                  data-focus="own"
                  data-nav-start={i === 0 || undefined}
                  disabled={!!busy}
                  onClick={() => addTo(playlist)}
                  className="flex w-full items-center gap-3 rounded-xl p-2 text-start outline-none transition-colors hover:bg-white/5 focus-visible:bg-white/10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[--ring] disabled:opacity-60 [[data-tv]_&]:focus-visible:ring-[3px]"
                >
                  <span className="relative flex aspect-[2/3] w-9 flex-none items-center justify-center overflow-hidden rounded bg-gray-900 ring-1 ring-white/5">
                    {cover ? (
                      <Artwork src={cover} alt="" />
                    ) : (
                      <LuListVideo className="text-[--muted]" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {playlist.Name}
                    </span>
                    <span className="block text-xs text-[--muted]">
                      {countLabel(playlist.ChildCount ?? 0)}
                    </span>
                  </span>
                  {busy === playlist.Id && (
                    <LuLoaderCircle className="flex-none animate-spin" />
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </Modal>
  );
}
