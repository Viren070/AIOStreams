import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Heart, Search, Share2, Trash2, Undo2, Upload } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CommunityItemMine, CommunityItemPublic } from '@aiostreams/core';
import type { FormatterDefinition } from '../../../../../../core/src/utils/formatter-definitions';
import { useUserData } from '@/context/userData';
import { useStatus } from '@/context/status';
import {
  deleteCommunityItem,
  likeCommunityItem,
  withdrawCommunityDraft,
} from '@/lib/api';
import {
  COMMUNITY_QUERY_ROOT,
  MY_COMMUNITY_QUERY_ROOT,
  communityItemsQuery,
  myCommunityQuery,
} from '@/lib/queries';
import { Button, IconButton } from '../../../ui/button';
import { TextInput } from '../../../ui/text-input';
import { Tooltip } from '../../../ui/tooltip';
import { cn } from '../../../ui/core/styling';
import {
  ConfirmationDialog,
  useConfirmationDialog,
} from '../../../shared/confirmation-dialog';
import { getTemplates } from '../templates';
import { FormatterCard } from './formatter-card';
import { ShareFormatterModal } from './share-modal';
import { useCardPreviews } from './use-card-previews';

export interface CommunityTabProps {
  enabled: boolean;
  onInstall: (name: string, definition: FormatterDefinition) => void;
}

const NO_ITEMS: CommunityItemPublic[] = [];
const NO_MINE: CommunityItemMine[] = [];

const STATUS_PILL: Record<string, string> = {
  approved: 'bg-green-500/20 text-green-400 border-green-500/30',
  pending: 'bg-yellow-400/20 text-yellow-400 border-yellow-400/30',
  rejected: 'bg-red-400/20 text-red-300 border-red-400/30',
};

function pill(className: string, label: React.ReactNode) {
  return (
    <span
      className={cn(
        'text-xs px-2 py-0.5 rounded border whitespace-nowrap',
        className
      )}
    >
      {label}
    </span>
  );
}

export function CommunityTab({ enabled, onInstall }: CommunityTabProps) {
  const qc = useQueryClient();
  const { userData, uuid, password } = useUserData();
  const { status } = useStatus();
  const mode = status?.settings.community?.formatters ?? 'off';
  const credentials = uuid ? { uuid, password } : null;

  const [showMine, setShowMine] = useState(false);
  const [search, setSearch] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [share, setShare] = useState<{ existing?: CommunityItemMine } | null>(
    null
  );

  const items = useQuery({
    ...communityItemsQuery('formatter'),
    enabled: enabled && mode !== 'off',
  });
  const mine = useQuery({
    ...myCommunityQuery(credentials),
    enabled: enabled && showMine && !!credentials,
  });

  // Stable fallbacks: a fresh `[]` per render would re-fire the preview effect.
  const publicItems = items.data ?? NO_ITEMS;
  const myItems = useMemo(
    () => (mine.data ?? NO_MINE).filter((item) => item.kind === 'formatter'),
    [mine.data]
  );

  // Most used tags first so the filter row surfaces what people actually use.
  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of publicItems) {
      for (const t of item.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([t]) => t);
  }, [publicItems]);

  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return publicItems.filter((item) => {
      if (tag && !(item.tags ?? []).includes(tag)) return false;
      if (!q) return true;
      return [item.name, item.description, item.author, ...(item.tags ?? [])]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [publicItems, search, tag]);

  const definitions = useMemo(() => {
    const out: Record<string, FormatterDefinition> = {};
    for (const item of [...publicItems, ...myItems]) {
      out[`community:${item.id}`] = item.payload as FormatterDefinition;
    }
    return out;
  }, [publicItems, myItems]);
  const previews = useCardPreviews(definitions, enabled);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: COMMUNITY_QUERY_ROOT });
    qc.invalidateQueries({ queryKey: MY_COMMUNITY_QUERY_ROOT });
  };

  const like = useMutation({
    mutationFn: (id: string) => likeCommunityItem(credentials!, id),
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e?.message ?? 'Failed to like'),
  });
  const withdraw = useMutation({
    mutationFn: (id: string) => withdrawCommunityDraft(credentials!, id),
    onSuccess: () => {
      toast.success('Update withdrawn');
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? 'Failed to withdraw'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteCommunityItem(credentials!, id),
    onSuccess: () => {
      toast.success('Removed from the community');
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? 'Failed to delete'),
  });

  if (mode === 'off') {
    return (
      <p className="text-sm text-gray-500 text-center py-8">
        Community formatters are turned off on this instance.
      </p>
    );
  }

  const needsCredentials =
    'Create or load your configuration (UUID and password) first; sharing and likes are tied to it';
  const shareButton = (
    <Button
      size="sm"
      intent="primary-subtle"
      leftIcon={<Share2 className="w-4 h-4" />}
      disabled={!credentials}
      onClick={() => setShare({})}
    >
      Share current formatter
    </Button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-[--muted] flex-1 min-w-[12rem]">
          {mode === 'approval'
            ? 'Submissions are reviewed by an admin before they appear here.'
            : 'Anyone with a saved configuration can share a formatter here.'}
        </p>
        {credentials && (
          <Button
            size="sm"
            intent={showMine ? 'primary' : 'gray-outline'}
            onClick={() => setShowMine((v) => !v)}
          >
            Mine
          </Button>
        )}
        {credentials ? (
          shareButton
        ) : (
          <Tooltip trigger={<span>{shareButton}</span>}>
            {needsCredentials}
          </Tooltip>
        )}
      </div>

      {!showMine && publicItems.length > 0 && (
        <div className="space-y-2">
          <TextInput
            value={search}
            onValueChange={setSearch}
            placeholder="Search by name, author or tag"
            leftIcon={<Search className="w-4 h-4" />}
            className="text-sm"
          />
          {allTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {allTags.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTag(tag === t ? null : t)}
                  className={cn(
                    'text-xs px-2 py-0.5 rounded-full border transition-colors',
                    tag === t
                      ? 'border-[--brand] bg-brand/10 text-[--brand]'
                      : 'bg-gray-800/60 border-gray-700 text-gray-300 hover:border-gray-500'
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {showMine ? (
        <MineGrid
          items={myItems}
          loading={mine.isPending}
          previews={previews}
          onUpdate={(item) => setShare({ existing: item })}
          onWithdraw={(item) => withdraw.mutate(item.id)}
          onDelete={(item) => remove.mutate(item.id)}
        />
      ) : items.isPending ? (
        <p className="text-sm text-gray-500 text-center py-8">Loading...</p>
      ) : publicItems.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-8">
          Nothing shared yet. Be the first.
        </p>
      ) : visibleItems.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-8">
          No formatters match this filter.
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[560px] overflow-y-auto pr-2">
          {visibleItems.map((item) => (
            <FormatterCard
              key={item.id}
              title={item.name}
              description={item.description || `by ${item.author}`}
              preview={previews[`community:${item.id}`]}
              badge={
                <>
                  {item.federated &&
                    pill(
                      'bg-gray-500/20 text-gray-300 border-gray-500/30',
                      `From ${item.origin}`
                    )}
                  {pill(
                    'bg-gray-800 text-gray-400 border-gray-700',
                    `v${item.version}`
                  )}
                </>
              }
              tags={item.tags}
              actions={
                <>
                  <Button
                    size="sm"
                    intent="primary-subtle"
                    onClick={() =>
                      onInstall(item.name, item.payload as FormatterDefinition)
                    }
                  >
                    Install
                  </Button>
                  <span className="text-xs text-[--muted] truncate">
                    by {item.author}
                  </span>
                  <div className="ml-auto">
                    <LikeButton
                      item={item}
                      disabledReason={
                        item.federated
                          ? 'Likes only work for items published on this instance'
                          : !credentials
                            ? needsCredentials
                            : undefined
                      }
                      pending={like.isPending}
                      onClick={() => like.mutate(item.id)}
                    />
                  </div>
                </>
              }
            />
          ))}
        </div>
      )}

      {credentials && share && (
        <ShareFormatterModal
          open
          onOpenChange={(open) => !open && setShare(null)}
          credentials={credentials}
          definition={getTemplates(userData)}
          existing={share.existing}
          moderated={mode === 'approval'}
        />
      )}
    </div>
  );
}

function LikeButton({
  item,
  disabledReason,
  pending,
  onClick,
}: {
  item: CommunityItemPublic;
  disabledReason?: string;
  pending: boolean;
  onClick: () => void;
}) {
  const button = (
    <button
      type="button"
      disabled={!!disabledReason || pending}
      onClick={onClick}
      className={cn(
        'flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors',
        disabledReason
          ? 'border-gray-800 text-gray-500 cursor-not-allowed'
          : 'border-pink-500/30 text-pink-300 hover:bg-pink-500/10'
      )}
    >
      <Heart className="w-3.5 h-3.5" />
      {item.likes}
    </button>
  );
  return disabledReason ? (
    <Tooltip trigger={<span>{button}</span>}>{disabledReason}</Tooltip>
  ) : (
    button
  );
}

function MineGrid({
  items,
  loading,
  previews,
  onUpdate,
  onWithdraw,
  onDelete,
}: {
  items: CommunityItemMine[];
  loading: boolean;
  previews: ReturnType<typeof useCardPreviews>;
  onUpdate: (item: CommunityItemMine) => void;
  onWithdraw: (item: CommunityItemMine) => void;
  onDelete: (item: CommunityItemMine) => void;
}) {
  if (loading) {
    return <p className="text-sm text-gray-500 text-center py-8">Loading...</p>;
  }
  if (items.length === 0) {
    return (
      <p className="text-sm text-gray-500 text-center py-8">
        You have not shared a formatter yet.
      </p>
    );
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[560px] overflow-y-auto pr-2">
      {items.map((item) => (
        <MineCard
          key={item.id}
          item={item}
          preview={previews[`community:${item.id}`]}
          onUpdate={() => onUpdate(item)}
          onWithdraw={() => onWithdraw(item)}
          onDelete={() => onDelete(item)}
        />
      ))}
    </div>
  );
}

function MineCard({
  item,
  preview,
  onUpdate,
  onWithdraw,
  onDelete,
}: {
  item: CommunityItemMine;
  preview?: { name?: string; description?: string; error?: string };
  onUpdate: () => void;
  onWithdraw: () => void;
  onDelete: () => void;
}) {
  const deleteDialog = useConfirmationDialog({
    title: 'Remove shared formatter',
    description: `Remove "${item.name}" from the community? People who installed it keep their copy.`,
    actionText: 'Remove',
    actionIntent: 'alert-subtle',
    onConfirm: onDelete,
  });
  const reason = item.draftRejectionReason ?? item.rejectionReason;
  return (
    <>
      <ConfirmationDialog {...deleteDialog} />
      <FormatterCard
        title={item.name}
        description={
          <>
            v{item.version}
            {item.likes > 0 && ` · ${item.likes} likes`}
            {reason && (
              <span className="block text-red-200 mt-0.5">
                {item.draftRejectionReason ? 'Update rejected: ' : 'Rejected: '}
                {reason}
              </span>
            )}
          </>
        }
        preview={preview}
        tags={item.tags}
        badge={
          <>
            {pill(STATUS_PILL[item.status], item.status)}
            {item.draft &&
              pill(
                STATUS_PILL.pending,
                `v${item.draft.version} pending review`
              )}
          </>
        }
        actions={
          <>
            <Button
              size="sm"
              intent="primary-subtle"
              leftIcon={<Upload className="w-3.5 h-3.5" />}
              onClick={onUpdate}
            >
              Update with current
            </Button>
            <div className="ml-auto flex items-center gap-1">
              {item.draft && (
                <Tooltip
                  trigger={
                    <IconButton
                      size="sm"
                      rounded
                      intent="gray-subtle"
                      icon={<Undo2 className="h-3.5 w-3.5" />}
                      onClick={onWithdraw}
                    />
                  }
                >
                  Withdraw pending update
                </Tooltip>
              )}
              <Tooltip
                trigger={
                  <IconButton
                    size="sm"
                    rounded
                    intent="alert-subtle"
                    icon={<Trash2 className="h-3.5 w-3.5" />}
                    onClick={deleteDialog.open}
                  />
                }
              >
                Remove from community
              </Tooltip>
            </div>
          </>
        }
      />
    </>
  );
}
