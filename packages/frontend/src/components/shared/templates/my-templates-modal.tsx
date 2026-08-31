import React, { useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileJson, Trash2, Undo2, Upload } from 'lucide-react';
import type { CommunityItemMine, UserData } from '@aiostreams/core';
import { Modal } from '../../ui/modal';
import { Button, IconButton } from '../../ui/button';
import { Tooltip } from '../../ui/tooltip';
import { cn } from '../../ui/core/styling';
import {
  ConfirmationDialog,
  useConfirmationDialog,
} from '../confirmation-dialog';
import { useStatus } from '@/context/status';
import {
  deleteCommunityItem,
  updateCommunityItem,
  withdrawCommunityDraft,
  type Credentials,
} from '@/lib/api';
import {
  COMMUNITY_QUERY_ROOT,
  MY_COMMUNITY_QUERY_ROOT,
  myCommunityQuery,
} from '@/lib/queries';
import { buildTemplateFromUserData } from './export-modal';
import { bumpPatch } from '../../../../../core/src/community/version';
import {
  looksLikeTemplate,
  pickJsonFile,
  SHARE_TEMPLATE_CONFIRMATION,
  shareOutcomeMessage,
  shareTemplateJson,
  withUploadVersion,
} from '@/lib/templates/share';

export interface MyTemplatesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  credentials: Credentials;
  userData: UserData;
  filterCredentials: (data: UserData) => UserData;
  /** Re-fetch the browser's template list after a change. */
  onChanged: () => void;
}

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

/** The user's own shared templates: status, pending updates, and self-service actions. */
export function MyTemplatesModal({
  open,
  onOpenChange,
  credentials,
  userData,
  filterCredentials,
  onChanged,
}: MyTemplatesModalProps) {
  const qc = useQueryClient();
  const { status } = useStatus();
  const mine = useQuery({ ...myCommunityQuery(credentials), enabled: open });
  const items = useMemo(
    () => (mine.data ?? []).filter((item) => item.kind === 'template'),
    [mine.data]
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: COMMUNITY_QUERY_ROOT });
    qc.invalidateQueries({ queryKey: MY_COMMUNITY_QUERY_ROOT });
    onChanged();
  };

  const update = useMutation({
    mutationFn: (item: CommunityItemMine) =>
      updateCommunityItem(credentials, item.id, {
        template: buildTemplateFromUserData({
          userData,
          filterCredentials,
          presets: status?.settings.presets ?? [],
          meta: {
            name: item.name,
            description: item.description,
            author: item.author,
            tags: item.tags ?? [],
            version: bumpPatch(item.version),
          },
        }),
      }),
    onSuccess: (item) => {
      toast.success(
        item.draft ? 'Update submitted for review' : 'Update published'
      );
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? 'Failed to update'),
  });
  const updateFromFile = useMutation({
    mutationFn: async (item: CommunityItemMine) => {
      const json = await pickJsonFile();
      if (json === null) return null;
      if (!looksLikeTemplate(json)) {
        throw new Error(
          'That file is not a template (needs metadata and config)'
        );
      }
      return updateCommunityItem(credentials, item.id, {
        template: withUploadVersion(json, item),
      });
    },
    onSuccess: (item) => {
      if (!item) return;
      toast.success(shareOutcomeMessage(item, true));
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? 'Failed to update'),
  });
  // A file whose name matches one of your templates becomes an update of it.
  const submitFromFile = useMutation({
    mutationFn: async () => {
      const json = await pickJsonFile();
      if (json === null) return null;
      if (!looksLikeTemplate(json)) {
        throw new Error(
          'That file is not a template (needs metadata and config)'
        );
      }
      return shareTemplateJson(credentials, json, mine.data);
    },
    onSuccess: (result) => {
      if (!result) return;
      toast.success(shareOutcomeMessage(result.item, result.updated));
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? 'Failed to share'),
  });
  const withdraw = useMutation({
    mutationFn: (id: string) => withdrawCommunityDraft(credentials, id),
    onSuccess: () => {
      toast.success('Update withdrawn');
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? 'Failed to withdraw'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteCommunityItem(credentials, id),
    onSuccess: () => {
      toast.success('Removed from the community');
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? 'Failed to delete'),
  });

  // One dialog for the whole list; the row action waits until confirmed.
  const pendingAction = useRef<() => void>(() => {});
  const shareConfirm = useConfirmationDialog({
    ...SHARE_TEMPLATE_CONFIRMATION,
    onConfirm: () => pendingAction.current(),
  });
  const confirmThen = (action: () => void) => {
    pendingAction.current = action;
    shareConfirm.open();
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="My shared templates"
      description="Templates you shared with this instance. Share a new one from a JSON file, or update an existing one from your current configuration or a file you maintain."
      contentClass="max-w-2xl w-full"
    >
      <ConfirmationDialog {...shareConfirm} />
      <div className="flex justify-end">
        <Button
          size="sm"
          intent="primary-subtle"
          leftIcon={<FileJson className="w-4 h-4" />}
          disabled={submitFromFile.isPending}
          onClick={() => confirmThen(() => submitFromFile.mutate())}
        >
          Share a template JSON
        </Button>
      </div>
      {mine.isPending ? (
        <p className="text-sm text-gray-500 text-center py-8">Loading...</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-8">
          You have not shared a template yet. Share a template JSON above, or
          use the share button on an imported template&rsquo;s card.
        </p>
      ) : (
        <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
          {items.map((item) => (
            <MyTemplateRow
              key={item.id}
              item={item}
              onUpdate={() => confirmThen(() => update.mutate(item))}
              onUpdateFromFile={() =>
                confirmThen(() => updateFromFile.mutate(item))
              }
              onWithdraw={() => withdraw.mutate(item.id)}
              onDelete={() => remove.mutate(item.id)}
              busy={
                update.isPending ||
                updateFromFile.isPending ||
                submitFromFile.isPending ||
                withdraw.isPending ||
                remove.isPending
              }
            />
          ))}
        </div>
      )}
    </Modal>
  );
}

function MyTemplateRow({
  item,
  onUpdate,
  onUpdateFromFile,
  onWithdraw,
  onDelete,
  busy,
}: {
  item: CommunityItemMine;
  onUpdate: () => void;
  onUpdateFromFile: () => void;
  onWithdraw: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const deleteDialog = useConfirmationDialog({
    title: 'Remove shared template',
    description: `Remove "${item.name}" from the community? People who applied it keep their configuration.`,
    actionText: 'Remove',
    actionIntent: 'alert-subtle',
    onConfirm: onDelete,
  });
  const reason = item.draftRejectionReason ?? item.rejectionReason;
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/60 p-3 space-y-2">
      <ConfirmationDialog {...deleteDialog} />
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-sm">{item.name}</span>
        {pill('bg-gray-800 text-gray-400 border-gray-700', `v${item.version}`)}
        {pill(STATUS_PILL[item.status], item.status)}
        {item.draft &&
          pill(STATUS_PILL.pending, `v${item.draft.version} pending review`)}
        {item.likes > 0 &&
          pill(
            'bg-pink-500/10 text-pink-300 border-pink-500/30',
            `${item.likes} likes`
          )}
      </div>
      {reason && (
        <p className="text-xs text-red-200">
          {item.draftRejectionReason ? 'Update rejected: ' : 'Rejected: '}
          {reason}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          intent="primary-subtle"
          leftIcon={<Upload className="w-3.5 h-3.5" />}
          disabled={busy}
          onClick={onUpdate}
        >
          Update with current config
        </Button>
        <Tooltip
          trigger={
            <Button
              size="sm"
              intent="gray-outline"
              leftIcon={<FileJson className="w-3.5 h-3.5" />}
              disabled={busy}
              onClick={onUpdateFromFile}
            >
              From JSON
            </Button>
          }
        >
          Upload a template JSON you maintain by hand; its version is used when
          higher than the published one
        </Tooltip>
        <div className="ml-auto flex items-center gap-1">
          {item.draft && (
            <Tooltip
              trigger={
                <IconButton
                  size="sm"
                  rounded
                  intent="gray-subtle"
                  icon={<Undo2 className="h-3.5 w-3.5" />}
                  disabled={busy}
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
                disabled={busy}
                onClick={deleteDialog.open}
              />
            }
          >
            Remove from community
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
