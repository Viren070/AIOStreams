import React from 'react';
import { BiDotsVerticalRounded } from 'react-icons/bi';
import { LuEye, LuHistory } from 'react-icons/lu';
import { Button, IconButton } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Modal } from '@/components/ui/modal';
import { UserDataDiffViewer } from '@/components/shared/userdata-diff-viewer';
import { resolveDraft, useUserData } from '@/context/userData';
import { useStatus } from '@/context/status';
import { relativeTime } from '@/lib/format';

/** Offers unsaved work found on this browser, rather than applying it. */
export function DraftRestoreBanner() {
  const {
    userData,
    pendingDraft,
    restoreDraft,
    discardDraft,
    disableDrafts,
    uuid,
  } = useUserData();
  const { status } = useStatus();
  const [diffOpen, setDiffOpen] = React.useState(false);

  const draftData = React.useMemo(() => {
    if (!diffOpen || !pendingDraft) return null;
    try {
      return resolveDraft(pendingDraft, status);
    } catch {
      return null;
    }
  }, [diffOpen, pendingDraft, status]);

  if (!pendingDraft) return null;

  // Only worth naming when renamed away from what this instance serves.
  const name = pendingDraft.addonName?.trim();
  const customName =
    name && name !== (status?.settings?.addonName || 'AIOStreams')
      ? name
      : null;

  const details = [
    `Last edited ${relativeTime(pendingDraft.savedAt)}`,
    customName && `"${customName}"`,
    uuid === null && 'Not signed in',
  ].filter(Boolean);

  return (
    <div className="px-4 pt-4 sm:px-8">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[--border] bg-gray-900/60 p-3 sm:flex-nowrap sm:p-4">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-500/20 text-[--brand]">
          <LuHistory className="size-[18px]" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white">
            Restore unsaved changes?
          </p>
          <p className="truncate text-xs text-[--muted]">
            {details.join(' · ')}
          </p>
        </div>
        <div className="order-last grid w-full grid-cols-3 gap-2 sm:order-none sm:flex sm:w-auto">
          <Button
            intent="gray-basic"
            size="sm"
            rounded
            leftIcon={<LuEye />}
            onClick={() => setDiffOpen(true)}
          >
            Review
          </Button>
          <Button
            intent="gray-outline"
            size="sm"
            rounded
            onClick={discardDraft}
          >
            Discard
          </Button>
          <Button intent="white" size="sm" rounded onClick={restoreDraft}>
            Restore
          </Button>
        </div>
        <DropdownMenu
          align="end"
          trigger={
            <IconButton
              size="sm"
              intent="gray-basic"
              icon={<BiDotsVerticalRounded />}
              aria-label="More draft options"
            />
          }
        >
          <DropdownMenuItem onSelect={disableDrafts}>
            Don&apos;t keep drafts on this browser
          </DropdownMenuItem>
        </DropdownMenu>
      </div>

      <Modal
        open={diffOpen}
        onOpenChange={setDiffOpen}
        title="Unsaved changes"
        description="What restoring would change in the configuration currently loaded."
        contentClass="max-w-4xl"
      >
        <div className="space-y-4">
          {draftData ? (
            <UserDataDiffViewer oldConfig={userData} newConfig={draftData} />
          ) : (
            <p className="text-sm text-[--muted]">
              This draft can&apos;t be read, so there is nothing to compare.
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 pt-4 sm:flex-row sm:justify-end">
            <Button
              intent="gray-outline"
              rounded
              className="w-full sm:w-auto"
              onClick={() => {
                setDiffOpen(false);
                discardDraft();
              }}
            >
              Discard
            </Button>
            <Button
              intent="white"
              rounded
              className="w-full sm:w-auto"
              onClick={() => {
                setDiffOpen(false);
                restoreDraft();
              }}
            >
              Restore
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
