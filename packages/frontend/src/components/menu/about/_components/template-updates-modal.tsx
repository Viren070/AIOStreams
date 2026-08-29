import React from 'react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import {
  ChangelogEntryRow,
  TemplateUpdateChangelogSection,
} from '@/components/shared/templates/changelog';
import type { AppliedTemplateUpdate } from '@/hooks/templates/loader';

interface TemplateUpdatesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  updates: AppliedTemplateUpdate[];
  onApply: (update: AppliedTemplateUpdate) => void;
  onDismiss: (templateId: string, toVersion: string) => void;
  onForget: (templateId: string) => void;
  onDismissAll: () => void;
}

export function TemplateUpdatesModal({
  open,
  onOpenChange,
  updates,
  onApply,
  onDismiss,
  onForget,
  onDismissAll,
}: TemplateUpdatesModalProps) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Template Updates Available"
      contentClass="max-w-2xl"
    >
      <div className="space-y-4 min-w-0">
        <p className="text-sm text-[--muted]">
          Templates you&apos;ve applied have new versions available.
        </p>
        <div className="space-y-3 max-h-[52vh] overflow-y-auto overflow-x-hidden pr-4 -mr-2">
          {updates.map((update) => (
            <div
              key={update.template.metadata.id}
              className="rounded-lg border border-gray-700 bg-gray-800/50 p-4 space-y-3"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="font-semibold text-white">
                  {update.template.metadata.name}
                </span>
                <span className="text-xs text-gray-400 whitespace-nowrap flex-shrink-0">
                  v{update.appliedVersion}{' '}
                  <span className="text-gray-600">→</span>{' '}
                  <span className="text-green-400">
                    v{update.template.metadata.version}
                  </span>
                </span>
              </div>
              {update.newChangelog.length > 0 ? (
                <div className="space-y-3">
                  {update.newChangelog.map((entry) => (
                    <ChangelogEntryRow key={entry.version} entry={entry} />
                  ))}
                </div>
              ) : update.template.metadata.changelogUrl ? (
                <TemplateUpdateChangelogSection update={update} />
              ) : (
                <p className="text-xs text-gray-500 italic">
                  No changelog provided for this update.
                </p>
              )}
              <div className="flex items-center gap-2 pt-1">
                <Button
                  intent="primary"
                  className="flex-1"
                  onClick={() => onApply(update)}
                >
                  Apply Update
                </Button>
                <Button
                  intent="gray-outline"
                  onClick={() =>
                    onDismiss(
                      update.template.metadata.id,
                      update.template.metadata.version
                    )
                  }
                >
                  Skip this version
                </Button>
              </div>
              <button
                className="text-xs text-gray-600 hover:text-gray-400 transition-colors underline-offset-2 hover:underline"
                onClick={() => onForget(update.template.metadata.id)}
              >
                Ignore all future updates for this template
              </button>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between pt-2 border-t border-gray-700">
          <button
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
            onClick={onDismissAll}
          >
            Dismiss all
          </button>
          <Button intent="gray-outline" onClick={() => onOpenChange(false)}>
            Maybe later
          </Button>
        </div>
      </div>
    </Modal>
  );
}
