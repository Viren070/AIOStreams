import React from 'react';
import { toast } from 'sonner';
import {
  BiCheck,
  BiChevronDown,
  BiChevronUp,
  BiDotsVerticalRounded,
  BiDownload,
  BiGridAlt,
  BiListUl,
} from 'react-icons/bi';
import { Badge } from '@aiostreams/ui/badge';
import { Button, IconButton } from '@aiostreams/ui/button';
import { Checkbox } from '@aiostreams/ui/checkbox';
import { DropdownMenu, DropdownMenuItem } from '@aiostreams/ui/dropdown-menu';
import { Skeleton } from '@aiostreams/ui/skeleton';
import { LuffyError } from '@aiostreams/ui/shared/luffy-error';
import {
  ConfirmationDialog,
  useConfirmationDialog,
} from '@aiostreams/ui/shared/confirmation-dialog';
import { cn } from '@aiostreams/ui/core/styling';
import { useSession } from '../lib/session';
import { useFeature } from '../lib/server-info';
import {
  useActivity,
  useClearHistory,
  useHistory,
  useOwnHistory,
  useOwnSessions,
  useOwnTotals,
  useSetPlayed,
} from '../lib/queries';
import { posterUrl, landscapeUrls } from '../lib/images';
import { clock, duration, episodeCode, relativeTime } from '../lib/format';
import { href, itemPath, navigate, to } from '../lib/paths';
import { PageBody } from '../components/layout';
import { SessionsRow } from '../components/sessions';
import { Artwork } from '../components/cards';
import { UserAvatar } from '../components/user-avatar';
import type { HistoryEntry, WebUser } from '../lib/types';

type View = 'days' | 'table';

const at = (e: HistoryEntry) => e.lastPlayedAt ?? e.sortAt;

export function HistoryPage() {
  // Without the server's history, the signed-in user's own plays and sessions.
  const full = useFeature('history');
  const activity = useActivity(full);
  const ownSessions = useOwnSessions(!full);
  const users = activity.data?.users ?? [];
  const sessions = (full ? activity.data?.sessions : ownSessions.data) ?? [];
  const owners = users.filter((u) => u.counts);
  const [userId, setUserId] = React.useState<string | null>(null);
  const [localOnly, setLocalOnly] = React.useState(false);
  const [view, setView] = React.useState<View>('days');
  const fullHistory = useHistory(userId, localOnly, full);
  const ownHistory = useOwnHistory(!full);
  const history = full ? fullHistory : ownHistory;
  const entries = React.useMemo(
    () => history.data?.pages.flatMap((p) => p.items) ?? [],
    [history.data]
  );
  const names = React.useMemo(
    () => new Map(users.map((u) => [u.user.Id!, u.user.Name ?? ''])),
    [users]
  );

  const sentinel = React.useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = history;
  React.useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !isFetchingNextPage) void fetchNextPage();
      },
      { rootMargin: '600px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const selected = owners.find((u) => u.user.Id === userId);

  return (
    <PageBody>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">Activity</h1>
        {full && (
          <div className="flex items-center gap-2">
            <ExportButton />
            {selected && <ResetButton owner={selected} />}
          </div>
        )}
      </div>
      {!full && <OwnTotals />}

      <SessionsRow sessions={sessions} />

      {owners.length > 1 && (
        <UserChips
          owners={owners}
          users={users}
          selected={userId}
          onSelect={setUserId}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          className={cn(
            'flex gap-1 rounded-full bg-gray-900 p-1',
            !full && 'invisible'
          )}
        >
          {[
            { value: false, label: 'Everything' },
            { value: true, label: 'Played here' },
          ].map((o) => (
            <Button
              key={o.label}
              size="xs"
              intent={localOnly === o.value ? 'white' : 'gray-basic'}
              className="rounded-full"
              onClick={() => setLocalOnly(o.value)}
            >
              {o.label}
            </Button>
          ))}
        </div>
        <div className="flex gap-1 rounded-full bg-gray-900 p-1">
          <IconButton
            size="xs"
            intent={view === 'days' ? 'white' : 'gray-basic'}
            className="rounded-full"
            icon={<BiGridAlt />}
            aria-label="Group by day"
            onClick={() => setView('days')}
          />
          <IconButton
            size="xs"
            intent={view === 'table' ? 'white' : 'gray-basic'}
            className="rounded-full"
            icon={<BiListUl />}
            aria-label="Table"
            onClick={() => setView('table')}
          />
        </div>
      </div>

      {history.isError ? (
        <LuffyError title="Could not load the history" />
      ) : history.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : !entries.length ? (
        <p className="text-[--muted]">Nothing watched yet.</p>
      ) : view === 'days' ? (
        <Days entries={entries} names={userId ? null : names} />
      ) : (
        <HistoryTable entries={entries} names={userId ? null : names} />
      )}
      {isFetchingNextPage && <Skeleton className="h-24 w-full rounded-xl" />}
      <div ref={sentinel} />
    </PageBody>
  );
}

function count(n: number, one: string, many: string): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

function OwnTotals() {
  const t = useOwnTotals(true);
  const watched = [
    t.movies ? count(t.movies, 'movie', 'movies') : null,
    t.episodes ? count(t.episodes, 'episode', 'episodes') : null,
  ].filter(Boolean);
  const more = [
    t.inProgress ? `${t.inProgress.toLocaleString()} in progress` : null,
    t.favorites ? count(t.favorites, 'favourite', 'favourites') : null,
  ].filter(Boolean);
  const parts = [
    watched.length ? `${watched.join(' and ')} watched` : null,
    ...more,
  ].filter(Boolean);
  if (!parts.length) return null;
  return <p className="text-sm text-[--muted]">{parts.join(' · ')}</p>;
}

function UserChips({
  owners,
  users,
  selected,
  onSelect,
}: {
  owners: WebUser[];
  users: WebUser[];
  selected: string | null;
  onSelect: (userId: string | null) => void;
}) {
  if (owners.length < 2) return null;
  const sharing = (owner: WebUser) =>
    users
      .filter(
        (u) => u.historyOf === owner.user.Id && u.user.Id !== owner.user.Id
      )
      .map((u) => u.user.Name);
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        size="sm"
        intent={selected === null ? 'white' : 'gray-outline'}
        className="rounded-full"
        onClick={() => onSelect(null)}
      >
        Everyone
      </Button>
      {owners.map((owner) => {
        const shared = sharing(owner);
        return (
          <Button
            key={owner.user.Id}
            size="sm"
            intent={selected === owner.user.Id ? 'white' : 'gray-outline'}
            className="rounded-full"
            leftIcon={
              <UserAvatar
                name={owner.user.Name}
                src={owner.avatar}
                className="size-5 text-[10px]"
              />
            }
            onClick={() => onSelect(owner.user.Id!)}
          >
            {owner.user.Name}
            {shared.length > 0 && (
              <span className="ml-1 text-[--muted]">+ {shared.join(', ')}</span>
            )}
            <span className="ml-2 tabular-nums text-[--muted]">
              {owner.counts?.played ?? 0}
            </span>
          </Button>
        );
      })}
    </div>
  );
}

/** A day's plays, with a show's episodes folded into one tile. */
interface Tile {
  key: string;
  entries: HistoryEntry[];
  show: boolean;
}

interface Day {
  key: string;
  date: Date;
  tiles: Tile[];
  runtimeMs: number;
}

function groupByDay(entries: HistoryEntry[]): Day[] {
  const days = new Map<string, Day>();
  for (const entry of entries) {
    const date = new Date(at(entry));
    const key = date.toDateString();
    let day = days.get(key);
    if (!day) {
      day = { key, date, tiles: [], runtimeMs: 0 };
      days.set(key, day);
    }
    const show = entry.kind === 'episode' && !!entry.item.SeriesId;
    const tileKey = `${entry.userId}|${show ? entry.item.SeriesId : entry.itemKey}`;
    let tile = day.tiles.find((t) => t.key === tileKey);
    if (!tile) {
      tile = { key: tileKey, entries: [], show };
      day.tiles.push(tile);
    }
    tile.entries.push(entry);
    if (entry.played) day.runtimeMs += entry.durationMs;
  }
  return [...days.values()];
}

function Days({
  entries,
  names,
}: {
  entries: HistoryEntry[];
  names: Map<string, string> | null;
}) {
  const days = React.useMemo(() => groupByDay(entries), [entries]);
  return (
    <div className="space-y-8">
      {days.map((day) => (
        <section key={day.key} className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <h2 className="text-lg font-semibold">
              {day.date.toLocaleDateString(undefined, {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </h2>
            {day.runtimeMs > 0 && (
              <span className="text-sm text-[--muted]">
                {duration(day.runtimeMs)} watched
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {day.tiles.map((tile) => (
              <DayTile key={tile.key} tile={tile} names={names} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function DayTile({
  tile,
  names,
}: {
  tile: Tile;
  names: Map<string, string> | null;
}) {
  const { client } = useSession();
  const [open, setOpen] = React.useState(false);
  const first = tile.entries[0];
  const item = first.item;
  const sorted = [...tile.entries].sort(
    (a, b) =>
      (a.item.ParentIndexNumber ?? 0) - (b.item.ParentIndexNumber ?? 0) ||
      (a.item.IndexNumber ?? 0) - (b.item.IndexNumber ?? 0)
  );
  const many = sorted.length > 1;
  const titleHref = href(
    to.item(tile.show && item.SeriesId ? item.SeriesId : item.Id!)
  );
  const range = many
    ? `${episodeCode(sorted[0].item.ParentIndexNumber, sorted[0].item.IndexNumber)} – ${episodeCode(
        sorted[sorted.length - 1].item.ParentIndexNumber,
        sorted[sorted.length - 1].item.IndexNumber
      )}`
    : null;

  return (
    <div
      className={cn(
        'rounded-xl border border-white/5 bg-gray-950/60',
        open && 'md:col-span-2 2xl:col-span-3'
      )}
    >
      <div className="flex gap-3 p-3">
        <a href={titleHref} className="w-14 flex-none">
          <Poster src={posterUrl(client, item, { maxWidth: 200 })} />
        </a>
        <div className="min-w-0 flex-1 space-y-0.5">
          <a
            href={titleHref}
            className="block truncate font-semibold hover:underline"
          >
            {tile.show ? item.SeriesName || item.Name : item.Name}
          </a>
          {names && (
            <p className="truncate text-xs text-[--muted]">
              {names.get(first.userId)}
            </p>
          )}
          {tile.show && many && (
            <p className="text-sm">
              <span className="font-medium text-brand-300">
                {sorted.length} episodes
              </span>{' '}
              <span className="text-[--muted]">{range}</span>
            </p>
          )}
          {!many && <EntryLine entry={first} showName={tile.show} />}
        </div>
        <div className="flex flex-none flex-col items-end justify-between">
          {many ? (
            <IconButton
              size="xs"
              intent="gray-basic"
              icon={open ? <BiChevronUp /> : <BiChevronDown />}
              aria-label={open ? 'Hide episodes' : 'Show episodes'}
              onClick={() => setOpen((v) => !v)}
            />
          ) : (
            <EntryMenu entries={[first]} />
          )}
          {many && <EntryMenu entries={sorted} />}
        </div>
      </div>
      {open && (
        <div className="grid grid-cols-1 gap-2 border-t border-white/5 p-3 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((entry) => (
            <div
              key={entry.itemKey}
              className="flex items-center gap-3 rounded-lg bg-gray-900/60 p-2"
            >
              <a href={href(itemPath(entry.item))} className="w-24 flex-none">
                <div className="relative aspect-video overflow-hidden rounded-md bg-gray-900">
                  <Artwork
                    src={landscapeUrls(client, entry.item, { maxWidth: 300 })}
                    alt=""
                  />
                </div>
              </a>
              <div className="min-w-0 flex-1">
                <EntryLine entry={entry} showName />
              </div>
              <EntryMenu entries={[entry]} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EntryLine({
  entry,
  showName,
}: {
  entry: HistoryEntry;
  showName: boolean;
}) {
  const item = entry.item;
  const code = episodeCode(item.ParentIndexNumber, item.IndexNumber);
  return (
    <div className="min-w-0 space-y-0.5 text-sm">
      {showName && entry.kind === 'episode' && (
        <p className="truncate">
          <span className="font-medium text-brand-300">{code}</span> {item.Name}
        </p>
      )}
      <p className="flex flex-wrap items-center gap-x-2 text-xs text-[--muted]">
        <span>{relativeTime(at(entry))}</span>
        <Status entry={entry} />
        {entry.tracker && (
          <Badge size="sm" intent="gray">
            {entry.tracker}
          </Badge>
        )}
      </p>
    </div>
  );
}

function Status({ entry }: { entry: HistoryEntry }) {
  if (entry.played) {
    return (
      <span className="flex items-center gap-0.5 text-green-300">
        <BiCheck />
        {entry.playCount > 1 ? `Watched ×${entry.playCount}` : 'Watched'}
      </span>
    );
  }
  return (
    <span>
      {clock(entry.positionMs)}
      {entry.durationMs ? ` / ${clock(entry.durationMs)}` : ''}
    </span>
  );
}

function Poster({ src }: { src: string | null }) {
  return (
    <div className="relative aspect-[2/3] overflow-hidden rounded-md bg-gray-900">
      <Artwork src={src} alt="" />
    </div>
  );
}

/** Edits one entry, or every episode in a folded tile. */
function EntryMenu({ entries }: { entries: HistoryEntry[] }) {
  const { user } = useSession();
  const full = useFeature('history');
  const activity = useActivity(full);
  const setPlayed = useSetPlayed();
  const clear = useClearHistory();
  const owner = entries[0].userId;
  // Marking plays as that user, which its PIN guards.
  const locked =
    owner !== user.Id &&
    !!activity.data?.users.find((u) => u.user.Id === owner)?.locked;
  const watched = locked ? [] : entries.filter((e) => e.played);

  const unmark = async () => {
    for (const e of watched) {
      await setPlayed.mutateAsync({
        itemId: e.item.Id!,
        played: false,
        userId: e.userId,
      });
    }
    toast.success('Marked unwatched');
  };

  const remove = () =>
    clear.mutate(
      {
        userId: entries[0].userId,
        itemKeys: entries.map((e) => e.itemKey),
      },
      { onSuccess: () => toast.success('Removed from history') }
    );

  return (
    <DropdownMenu
      align="end"
      trigger={
        <IconButton
          size="xs"
          intent="gray-basic"
          icon={<BiDotsVerticalRounded />}
          aria-label="Actions"
        />
      }
    >
      {entries.length === 1 && (
        <DropdownMenuItem onClick={() => navigate(itemPath(entries[0].item))}>
          Open
        </DropdownMenuItem>
      )}
      {watched.length > 0 && (
        <DropdownMenuItem onClick={() => void unmark()}>
          Mark unwatched
        </DropdownMenuItem>
      )}
      {full && (
        <DropdownMenuItem onClick={remove} className="text-red-300">
          Remove from history
        </DropdownMenuItem>
      )}
    </DropdownMenu>
  );
}

function ResetButton({ owner }: { owner: WebUser }) {
  const clear = useClearHistory();
  const confirm = useConfirmationDialog({
    title: `Reset ${owner.user.Name}'s history`,
    description:
      'Watched marks and resume points are removed from this server. Favourites stay. Titles a tracker still lists come back when it next syncs.',
    actionText: 'Reset history',
    onConfirm: () =>
      clear.mutate(
        { userId: owner.user.Id! },
        {
          onSuccess: (r) =>
            toast.success(`Removed ${r.cleared} titles from the history`),
        }
      ),
  });
  return (
    <>
      <Button
        size="sm"
        intent="alert-subtle"
        className="rounded-full"
        loading={clear.isPending}
        onClick={confirm.open}
      >
        Reset
      </Button>
      <ConfirmationDialog {...confirm} />
    </>
  );
}

function ExportButton() {
  const { client } = useSession();
  const [busy, setBusy] = React.useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const data = await client.get<unknown>('/AIOStreams/History/Export');
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json',
      });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `watch-history-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button
      size="sm"
      intent="gray-outline"
      className="rounded-full"
      loading={busy}
      leftIcon={<BiDownload />}
      onClick={run}
    >
      Export
    </Button>
  );
}

/** The table view, which removes entries in bulk. */
function HistoryTable({
  entries,
  names,
}: {
  entries: HistoryEntry[];
  names: Map<string, string> | null;
}) {
  const { client } = useSession();
  // Removing, and so selecting, needs the server's history.
  const full = useFeature('history');
  const clear = useClearHistory();
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const keyOf = (e: HistoryEntry) => `${e.userId}|${e.itemKey}`;
  const toggle = (e: HistoryEntry) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (!next.delete(keyOf(e))) next.add(keyOf(e));
      return next;
    });
  const allPicked = entries.length > 0 && picked.size === entries.length;

  const removePicked = async () => {
    const byUser = new Map<string, string[]>();
    for (const e of entries) {
      if (!picked.has(keyOf(e))) continue;
      byUser.set(e.userId, [...(byUser.get(e.userId) ?? []), e.itemKey]);
    }
    let removed = 0;
    for (const [userId, itemKeys] of byUser) {
      removed += (await clear.mutateAsync({ userId, itemKeys })).cleared;
    }
    setPicked(new Set());
    toast.success(`Removed ${removed} from the history`);
  };

  return (
    <div className="space-y-3">
      {picked.size > 0 && (
        <div className="sticky top-[calc(0.5rem+env(safe-area-inset-top))] z-[5] flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-gray-950/95 p-3 backdrop-blur">
          <span className="text-sm">{picked.size} selected</span>
          <div className="flex gap-2">
            <Button
              size="sm"
              intent="gray-outline"
              className="rounded-full"
              onClick={() => setPicked(new Set())}
            >
              Clear selection
            </Button>
            <Button
              size="sm"
              intent="alert-subtle"
              className="rounded-full"
              loading={clear.isPending}
              onClick={() => void removePicked()}
            >
              Remove from history
            </Button>
          </div>
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-white/5">
        <table className="w-full text-sm">
          <thead className="bg-gray-900/60 text-left text-xs uppercase text-[--muted]">
            <tr>
              {full && (
                <th className="w-10 p-3">
                  <Checkbox
                    value={allPicked}
                    onValueChange={() =>
                      setPicked(
                        allPicked ? new Set() : new Set(entries.map(keyOf))
                      )
                    }
                    aria-label="Select all"
                  />
                </th>
              )}
              <th className="p-3">Title</th>
              {names && <th className="hidden p-3 sm:table-cell">User</th>}
              <th className="p-3">Status</th>
              <th className="hidden p-3 md:table-cell">When</th>
              {full && <th className="hidden p-3 md:table-cell">Source</th>}
              <th className="w-10 p-3" />
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const item = entry.item;
              return (
                <tr
                  key={keyOf(entry)}
                  className={cn(
                    'border-t border-white/5',
                    picked.has(keyOf(entry)) && 'bg-brand-500/5'
                  )}
                >
                  {full && (
                    <td className="p-3">
                      <Checkbox
                        value={picked.has(keyOf(entry))}
                        onValueChange={() => toggle(entry)}
                        aria-label="Select"
                      />
                    </td>
                  )}
                  <td className="p-3">
                    <a
                      href={href(itemPath(item))}
                      className="flex items-center gap-3 hover:underline"
                    >
                      <span className="w-8 flex-none">
                        <Poster
                          src={posterUrl(client, item, { maxWidth: 120 })}
                        />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium">
                          {entry.kind === 'episode'
                            ? item.SeriesName || item.Name
                            : item.Name}
                        </span>
                        {entry.kind === 'episode' && (
                          <span className="block truncate text-xs text-[--muted]">
                            {episodeCode(
                              item.ParentIndexNumber,
                              item.IndexNumber
                            )}{' '}
                            {item.Name}
                          </span>
                        )}
                        <span className="block text-xs text-[--muted] md:hidden">
                          {relativeTime(at(entry))}
                        </span>
                      </span>
                    </a>
                  </td>
                  {names && (
                    <td className="hidden p-3 text-[--muted] sm:table-cell">
                      {names.get(entry.userId)}
                    </td>
                  )}
                  <td className="whitespace-nowrap p-3 text-xs">
                    <Status entry={entry} />
                  </td>
                  <td className="hidden whitespace-nowrap p-3 text-xs text-[--muted] md:table-cell">
                    {new Date(at(entry)).toLocaleString(undefined, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </td>
                  {full && (
                    <td className="hidden p-3 text-xs text-[--muted] md:table-cell">
                      {entry.tracker ??
                        (entry.origin === 'local' ? 'Here' : '')}
                    </td>
                  )}
                  <td className="p-3">
                    <EntryMenu entries={[entry]} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
