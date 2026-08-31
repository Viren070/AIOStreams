import React, { useState } from 'react';
import { toast } from 'sonner';
import { BiSearch, BiTrash, BiReset } from 'react-icons/bi';
import type { CommunityItem, CommunityKind } from '@aiostreams/core';
import { Card } from '@/components/ui/card';
import { Button, IconButton } from '@/components/ui/button';
import { TextInput } from '@/components/ui/text-input';
import { Switch } from '@/components/ui/switch';
import { Tooltip } from '@/components/ui/tooltip';
import { DashboardQueryBoundary } from '@/components/shared/dashboard-query-boundary';
import {
  ConfirmationDialog,
  useConfirmationDialog,
} from '@/components/shared/confirmation-dialog';
import {
  Pill,
  SegmentedControl,
  relativeTime,
} from '@/app/dashboard/streams/_components/shared';
import {
  useCommunityItems,
  useCommunityRemote,
  useDeleteItem,
  useResetLikes,
  useSetTrusted,
} from './queries';
import { KindPill, TagList } from './_components/shared';

const PAGE_SIZE = 50;

type KindFilter = 'all' | CommunityKind;

/** Other instances mirrored here; edited under Settings › Community, refreshed by the task. */
function RemoteSourcesCard() {
  const remote = useCommunityRemote();
  const sources = remote.data?.sources ?? [];
  return (
    <Card className="space-y-3 p-4">
      <div>
        <h3 className="text-sm font-semibold">Remote sources</h3>
        <p className="text-xs text-[--muted]">
          Approved items from other instances, shown read-only in the browsers.{' '}
          <a
            href="/dashboard/settings?tab=community"
            className="text-[--brand] hover:underline"
          >
            Edit the list in settings
          </a>
          ; run{' '}
          <a href="/dashboard/tasks" className="text-[--brand] hover:underline">
            Community remote refresh
          </a>{' '}
          from Tasks to fetch now.
        </p>
      </div>
      {sources.length === 0 ? (
        <p className="text-xs text-[--muted]">No remote sources configured.</p>
      ) : (
        <table className="w-full text-xs">
          <thead className="text-[--muted]">
            <tr className="text-left">
              <th className="py-1 pr-3">Source</th>
              <th className="py-1 pr-3">Items</th>
              <th className="py-1 pr-3">Last fetched</th>
              <th className="py-1">Status</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.url} className="border-t border-[--border]/40">
                <td className="max-w-[360px] truncate py-1 pr-3 font-mono">
                  {s.url}
                </td>
                <td className="py-1 pr-3">{s.count}</td>
                <td className="py-1 pr-3 text-[--muted]">
                  {s.lastFetchedAt ? relativeTime(s.lastFetchedAt) : 'never'}
                </td>
                <td
                  className={
                    s.error ? 'py-1 text-red-200' : 'py-1 text-green-300'
                  }
                >
                  {s.error ?? 'ok'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

export function CommunityPublishedPage() {
  const [kind, setKind] = useState<KindFilter>('all');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const items = useCommunityItems({
    status: 'approved',
    kind: kind === 'all' ? undefined : kind,
    search: search.trim() || undefined,
    limit: PAGE_SIZE,
    offset,
  });

  return (
    <div className="space-y-4">
      <RemoteSourcesCard />
      <div className="flex flex-wrap items-center gap-2">
        <TextInput
          value={search}
          onValueChange={(v) => {
            setSearch(v);
            setOffset(0);
          }}
          placeholder="Search name, description, author"
          leftIcon={<BiSearch />}
          className="w-full sm:w-72"
        />
        <SegmentedControl<KindFilter>
          value={kind}
          onChange={(v) => {
            setKind(v);
            setOffset(0);
          }}
          options={[
            { value: 'all', label: 'All' },
            { value: 'formatter', label: 'Formatters' },
            { value: 'template', label: 'Templates' },
          ]}
        />
      </div>

      <DashboardQueryBoundary
        query={items}
        errorTitle="Failed to load published items"
      >
        {(data) =>
          data.entries.length === 0 ? (
            <Card className="p-8">
              <p className="text-center text-sm text-[--muted]">
                Nothing published yet.
              </p>
            </Card>
          ) : (
            <>
              <Card className="overflow-hidden p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-[--subtle]/40 text-xs uppercase text-[--muted]">
                      <tr className="text-left">
                        <th className="p-3">Item</th>
                        <th className="p-3">Author</th>
                        <th className="p-3">Tags</th>
                        <th className="p-3">Likes</th>
                        <th className="p-3">Trusted</th>
                        <th className="p-3">Updated</th>
                        <th className="p-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {data.entries.map((entry) => (
                        <PublishedRow key={entry.id} item={entry} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
              {data.total > PAGE_SIZE && (
                <div className="flex items-center justify-between text-xs text-[--muted]">
                  <span>
                    {offset + 1}–{Math.min(offset + PAGE_SIZE, data.total)} of{' '}
                    {data.total}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      intent="gray-outline"
                      disabled={offset === 0}
                      onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                    >
                      Previous
                    </Button>
                    <Button
                      size="sm"
                      intent="gray-outline"
                      disabled={offset + PAGE_SIZE >= data.total}
                      onClick={() => setOffset(offset + PAGE_SIZE)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )
        }
      </DashboardQueryBoundary>
    </div>
  );
}

function PublishedRow({ item }: { item: CommunityItem }) {
  const remove = useDeleteItem();
  const resetLikes = useResetLikes();
  const setTrusted = useSetTrusted();

  const run = (p: Promise<unknown>, ok: string) =>
    p
      .then(() => toast.success(ok))
      .catch((e: any) => toast.error(e?.message ?? 'Failed'));

  const deleteDialog = useConfirmationDialog({
    title: 'Delete item',
    description: `Remove "${item.name}" from the community? People who installed it keep their copy.`,
    actionText: 'Delete',
    onConfirm: () => run(remove.mutateAsync(item.id), 'Deleted'),
  });
  const resetDialog = useConfirmationDialog({
    title: 'Reset likes',
    description: `Clear all ${item.likes} likes on "${item.name}"?`,
    actionText: 'Reset',
    onConfirm: () => run(resetLikes.mutateAsync(item.id), 'Likes reset'),
  });

  return (
    <tr className="border-t border-[--border]/50 hover:bg-[--subtle]/30">
      <ConfirmationDialog {...deleteDialog} />
      <ConfirmationDialog {...resetDialog} />
      <td className="p-3">
        <div className="flex items-center gap-2">
          <KindPill kind={item.kind} />
          <span className="font-medium">{item.name}</span>
          <Pill>v{item.version}</Pill>
          {item.draft && (
            <Pill className="border-yellow-400/30 bg-yellow-500/10 text-yellow-300">
              update pending
            </Pill>
          )}
        </div>
        {item.description && (
          <p className="mt-1 max-w-[420px] truncate text-xs text-[--muted]">
            {item.description}
          </p>
        )}
      </td>
      <td className="p-3 text-[--muted]">{item.author}</td>
      <td className="p-3">
        <TagList tags={item.tags ?? []} />
      </td>
      <td className="p-3">{item.likes}</td>
      <td className="p-3">
        {item.kind === 'template' ? (
          <Tooltip
            trigger={
              <span>
                <Switch
                  value={item.trusted}
                  onValueChange={(v) =>
                    run(
                      setTrusted.mutateAsync({ id: item.id, trusted: !!v }),
                      v
                        ? 'Marked trusted'
                        : 'Trust removed (takes effect on restart)'
                    )
                  }
                />
              </span>
            }
          >
            Trusted templates whitelist their regex patterns and synced URLs for
            every user. Removing trust takes effect on restart.
          </Tooltip>
        ) : (
          <span className="text-xs text-[--muted]">—</span>
        )}
      </td>
      <td className="p-3 text-xs text-[--muted]">
        {relativeTime(item.updatedAt)}
      </td>
      <td className="p-3 text-right">
        <div className="flex justify-end gap-1">
          <Tooltip
            trigger={
              <IconButton
                size="sm"
                intent="gray-subtle"
                icon={<BiReset />}
                aria-label="Reset likes"
                disabled={item.likes === 0}
                onClick={resetDialog.open}
              />
            }
          >
            Reset likes
          </Tooltip>
          <Tooltip
            trigger={
              <IconButton
                size="sm"
                intent="alert-subtle"
                icon={<BiTrash />}
                aria-label="Delete"
                onClick={deleteDialog.open}
              />
            }
          >
            Delete
          </Tooltip>
        </div>
      </td>
    </tr>
  );
}
