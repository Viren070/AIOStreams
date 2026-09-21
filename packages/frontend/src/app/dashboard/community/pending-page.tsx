import React, { useState } from 'react';
import { toast } from 'sonner';
import { BiBlock, BiCheck, BiTrash, BiX } from 'react-icons/bi';
import type { CommunityItem, TemplateReviewSummary } from '@aiostreams/core';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DashboardQueryBoundary } from '@/components/shared/dashboard-query-boundary';
import {
  ConfirmationDialog,
  useConfirmationDialog,
} from '@/components/shared/confirmation-dialog';
import { Pill, relativeTime } from '@/app/dashboard/streams/_components/shared';
import {
  useAddBlock,
  useApproveDraft,
  useApproveItem,
  useCommunityItems,
  useDeleteItem,
  useRejectDraft,
  useRejectItem,
} from './queries';
import {
  KindPill,
  PayloadView,
  ReasonModal,
  ReviewSummaryView,
  TagList,
} from './_components/shared';

/**
 * Everything waiting on an admin: new submissions and pending updates to
 * already-published items. An update keeps the live version published until
 * it is approved.
 */
export function CommunityPendingPage() {
  const items = useCommunityItems({ pending: true, limit: 200 });

  return (
    <div className="space-y-4">
      <p className="text-xs text-[--muted]">
        Approving a template does not whitelist its regex patterns or synced
        URLs; users apply it under their own access level unless you approve it
        as trusted.
      </p>
      <DashboardQueryBoundary
        query={items}
        errorTitle="Failed to load the review queue"
      >
        {(data) =>
          data.entries.length === 0 ? (
            <Card className="p-8">
              <p className="text-center text-sm text-[--muted]">
                Nothing waiting for review.
              </p>
            </Card>
          ) : (
            <div className="space-y-4">
              {data.entries.map((entry) => (
                <ReviewCard key={entry.id} item={entry} />
              ))}
            </div>
          )
        }
      </DashboardQueryBoundary>
    </div>
  );
}

function ReviewCard({ item }: { item: CommunityItem }) {
  const approve = useApproveItem();
  const reject = useRejectItem();
  const approveDraft = useApproveDraft();
  const rejectDraft = useRejectDraft();
  const remove = useDeleteItem();
  const block = useAddBlock();
  const [trusted, setTrusted] = useState(false);
  const [rejecting, setRejecting] = useState<'item' | 'draft' | null>(null);

  const isUpdate = item.status === 'approved' && !!item.draft;
  const shown = isUpdate && item.draft ? item.draft : item;

  const run = (p: Promise<unknown>, ok: string) =>
    p
      .then(() => toast.success(ok))
      .catch((e: any) => toast.error(e?.message ?? 'Failed'));

  const deleteDialog = useConfirmationDialog({
    title: 'Delete submission',
    description: `Delete "${item.name}" entirely? This cannot be undone.`,
    actionText: 'Delete',
    onConfirm: () => run(remove.mutateAsync(item.id), 'Deleted'),
  });
  const blockOwnerDialog = useConfirmationDialog({
    title: 'Block uploader',
    description:
      'Blocks the configuration that uploaded this from sharing or liking anything else. The item itself stays as it is.',
    actionText: 'Block',
    onConfirm: () =>
      run(
        block.mutateAsync({
          itemId: item.id,
          kind: 'owner',
          reason: `blocked via ${item.name}`,
        }),
        'Uploader blocked'
      ),
  });
  const blockIpDialog = useConfirmationDialog({
    title: 'Block network address',
    description:
      'Blocks the address this was uploaded from. Shared addresses (mobile carriers, VPNs, CGNAT) will block other people too.',
    actionText: 'Block address',
    onConfirm: () =>
      run(
        block.mutateAsync({
          itemId: item.id,
          kind: 'ip',
          reason: `blocked via ${item.name}`,
        }),
        'Address blocked'
      ),
  });

  return (
    <Card className="space-y-4 p-4">
      <ConfirmationDialog {...deleteDialog} />
      <ConfirmationDialog {...blockOwnerDialog} />
      <ConfirmationDialog {...blockIpDialog} />
      <ReasonModal
        open={rejecting !== null}
        onOpenChange={(open) => !open && setRejecting(null)}
        title={rejecting === 'draft' ? 'Reject update' : 'Reject submission'}
        actionText="Reject"
        pending={reject.isPending || rejectDraft.isPending}
        onConfirm={(reason) => {
          const p =
            rejecting === 'draft'
              ? rejectDraft.mutateAsync({ id: item.id, reason })
              : reject.mutateAsync({ id: item.id, reason });
          run(p, 'Rejected').finally(() => setRejecting(null));
        }}
      />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <KindPill kind={item.kind} />
            <h3 className="text-base font-semibold">{shown.name}</h3>
            <Pill>v{shown.version}</Pill>
            {isUpdate && (
              <Pill className="border-yellow-400/30 bg-yellow-500/10 text-yellow-300">
                update to v{item.version}
              </Pill>
            )}
            {item.status === 'rejected' && (
              <Pill className="border-red-400/30 bg-red-500/10 text-red-200">
                previously rejected
              </Pill>
            )}
          </div>
          <p className="text-xs text-[--muted]">
            by {shown.author} · submitted{' '}
            {relativeTime(
              isUpdate && item.draft ? item.draft.submittedAt : item.createdAt
            )}
            {item.likes > 0 && ` · ${item.likes} likes`}
          </p>
          {shown.description && (
            <p className="whitespace-pre-wrap text-sm">{shown.description}</p>
          )}
          <TagList tags={shown.tags ?? []} />
        </div>
      </div>

      {isUpdate && item.draft && (
        <ChangedFields live={item} draft={item.draft} />
      )}

      {item.kind === 'template' && shown.reviewSummary ? (
        <ReviewSummaryView
          summary={shown.reviewSummary as TemplateReviewSummary}
        />
      ) : null}

      <PayloadView kind={item.kind} payload={shown.payload} />

      <div className="flex flex-wrap items-center gap-2 border-t border-[--border]/50 pt-3">
        {item.kind === 'template' && !isUpdate && (
          <label className="mr-2 flex items-center gap-2 text-xs text-[--muted]">
            <Checkbox value={trusted} onValueChange={(v) => setTrusted(!!v)} />
            Approve as trusted (whitelists its regex patterns and synced URLs;
            takes a restart to undo)
          </label>
        )}
        <Button
          size="sm"
          intent="success"
          leftIcon={<BiCheck />}
          loading={approve.isPending || approveDraft.isPending}
          onClick={() =>
            run(
              isUpdate
                ? approveDraft.mutateAsync(item.id)
                : approve.mutateAsync({
                    id: item.id,
                    trusted: item.kind === 'template' ? trusted : undefined,
                  }),
              isUpdate ? 'Update published' : 'Published'
            )
          }
        >
          {isUpdate ? 'Approve update' : 'Approve'}
        </Button>
        <Button
          size="sm"
          intent="alert-subtle"
          leftIcon={<BiX />}
          onClick={() => setRejecting(isUpdate ? 'draft' : 'item')}
        >
          {isUpdate ? 'Reject update' : 'Reject'}
        </Button>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button
            size="sm"
            intent="gray-outline"
            leftIcon={<BiBlock />}
            onClick={blockOwnerDialog.open}
          >
            Block uploader
          </Button>
          <Button
            size="sm"
            intent="gray-outline"
            leftIcon={<BiBlock />}
            onClick={blockIpDialog.open}
          >
            Block address
          </Button>
          <Button
            size="sm"
            intent="alert-subtle"
            leftIcon={<BiTrash />}
            onClick={deleteDialog.open}
          >
            Delete
          </Button>
        </div>
      </div>
    </Card>
  );
}

function ChangedFields({
  live,
  draft,
}: {
  live: CommunityItem;
  draft: NonNullable<CommunityItem['draft']>;
}) {
  const rows: Array<[string, string, string]> = [];
  const push = (label: string, a: string, b: string) => {
    if (a !== b) rows.push([label, a, b]);
  };
  push('Name', live.name, draft.name);
  push('Description', live.description, draft.description);
  push('Author', live.author, draft.author);
  push('Tags', (live.tags ?? []).join(', '), (draft.tags ?? []).join(', '));
  if (live.kind === 'formatter') {
    const a = (live.payload ?? {}) as { name?: string; description?: string };
    const b = (draft.payload ?? {}) as { name?: string; description?: string };
    push('Name template', a.name ?? '', b.name ?? '');
    push('Description template', a.description ?? '', b.description ?? '');
  } else if (JSON.stringify(live.payload) !== JSON.stringify(draft.payload)) {
    rows.push(['Config', 'published version', 'changed, see JSON below']);
  }
  if (rows.length === 0) {
    return (
      <p className="text-xs text-[--muted]">
        Only the version changed; the payload and metadata are identical.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded border border-[--border]/60">
      <table className="w-full text-xs">
        <thead className="bg-[--subtle]/40 uppercase text-[--muted]">
          <tr className="text-left">
            <th className="p-2">Field</th>
            <th className="p-2">Published</th>
            <th className="p-2">Proposed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, a, b]) => (
            <tr key={label} className="border-t border-[--border]/40">
              <td className="p-2 font-medium">{label}</td>
              <td className="max-w-[240px] whitespace-pre-wrap break-words p-2 text-[--muted]">
                {a || '—'}
              </td>
              <td className="max-w-[240px] whitespace-pre-wrap break-words p-2">
                {b || '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
