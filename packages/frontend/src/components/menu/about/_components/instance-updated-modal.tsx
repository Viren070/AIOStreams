import React from 'react';
import { SparklesIcon, ExternalLinkIcon } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import {
  DOCS_CHANGELOG_URL,
  DocsChangelogEntry,
  ReleaseChannel,
  docsEntryUrl,
  findDocsEntry,
  getLastSeenVersion,
  setLastSeenVersion,
  versionJump,
} from '@/lib/changelog';

/**
 * Tells the user what changed when the instance they use has been updated
 * under them. Reads `status.tag`, which is already loaded, so it costs no
 * request and cannot be rate limited.
 *
 * Deliberately not the same thing as "an update is available": that one is
 * addressed to whoever hosts the instance, and its audience here can't act on
 * it.
 */
export function InstanceUpdatedModal({
  version,
  channel,
  docsEntries,
}: {
  version: string;
  channel: ReleaseChannel;
  docsEntries: DocsChangelogEntry[];
}) {
  const [shownFor, setShownFor] = React.useState<string | null>(null);

  React.useEffect(() => {
    // Nightly ships on every merge, so announcing each one would be noise.
    if (channel !== 'stable') return;
    if (!version || version.toLowerCase() === 'unknown') return;

    const lastSeen = getLastSeenVersion();
    if (!lastSeen) {
      // First visit: record where we are without interrupting.
      setLastSeenVersion(version);
      return;
    }
    if (lastSeen === version) return;

    const jump = versionJump(lastSeen, version);
    if (jump === 'major' || jump === 'minor') {
      setShownFor(version);
    } else {
      // Patch releases and rollbacks pass silently.
      setLastSeenVersion(version);
    }
  }, [version, channel]);

  const dismiss = () => {
    setLastSeenVersion(version);
    setShownFor(null);
  };

  const entry = findDocsEntry(docsEntries, version);

  return (
    <Modal
      open={shownFor !== null}
      onOpenChange={(open) => {
        if (!open) dismiss();
      }}
      contentClass="max-w-lg"
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <span className="w-10 h-10 rounded-lg bg-brand-500/20 text-[--brand] flex items-center justify-center shrink-0">
            <SparklesIcon className="w-5 h-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-white">
              AIOStreams was updated to {version}
            </h2>
            {entry ? (
              <p className="text-sm text-[--muted] mt-1">{entry.title}</p>
            ) : (
              <p className="text-sm text-[--muted] mt-1">
                This instance is running a newer version than the last time you
                were here.
              </p>
            )}
          </div>
        </div>

        {entry?.description && (
          <p className="text-sm text-gray-300 border-l-2 border-gray-700 pl-3">
            {entry.description}
          </p>
        )}

        <div className="flex items-center justify-between gap-3 pt-1">
          <button
            type="button"
            onClick={dismiss}
            className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
          >
            Dismiss
          </button>
          <Button
            intent="primary"
            rightIcon={<ExternalLinkIcon className="w-3.5 h-3.5" />}
            onClick={() => {
              window.open(
                entry ? docsEntryUrl(entry) : DOCS_CHANGELOG_URL,
                '_blank',
                'noopener,noreferrer'
              );
              dismiss();
            }}
          >
            See what changed
          </Button>
        </div>
      </div>
    </Modal>
  );
}
