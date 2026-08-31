import React from 'react';
import { Button } from '@/components/ui/button';
import { useUserData } from '@/context/userData';
import { useStatus } from '@/context/status';
import { relativeTime } from '@/lib/format';

/** Offers unsaved work found on this browser, rather than applying it. */
export function DraftRestoreBanner() {
  const { pendingDraft, restoreDraft, discardDraft, disableDrafts, uuid } =
    useUserData();
  const { status } = useStatus();

  if (!pendingDraft) return null;

  // Only worth naming when renamed away from what this instance serves.
  const name = pendingDraft.addonName?.trim();
  const customName =
    name && name !== (status?.settings?.addonName || 'AIOStreams')
      ? name
      : null;

  return (
    <div className="px-4 pt-4 sm:px-8">
      <div className="rounded-lg border border-[--border] bg-gray-900/60 p-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-white">
            Unsaved changes from {relativeTime(pendingDraft.savedAt)}
          </p>
          <p className="text-xs text-[--muted] mt-0.5">
            {customName ? `From "${customName}". ` : ''}
            These were never saved to your configuration.
            {uuid === null && ' You are not signed in.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Button intent="primary" size="sm" rounded onClick={restoreDraft}>
            Restore
          </Button>
          <Button
            intent="gray-outline"
            size="sm"
            rounded
            onClick={discardDraft}
          >
            Discard
          </Button>
          <Button
            intent="gray-link"
            size="sm"
            onClick={disableDrafts}
            className="text-xs"
          >
            Don&apos;t keep drafts on this browser
          </Button>
        </div>
      </div>
    </div>
  );
}
