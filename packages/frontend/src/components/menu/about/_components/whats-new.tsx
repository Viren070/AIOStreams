import React from 'react';
import {
  ArrowUpCircleIcon,
  CheckCircle2Icon,
  ExternalLinkIcon,
  ScrollTextIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { GlowCard } from '@/components/shared/glow-card';
import {
  DOCS_CHANGELOG_URL,
  DocsChangelogEntry,
  ReleaseChannel,
  docsEntryUrl,
  findDocsEntry,
} from '@/lib/changelog';
import { UseReleases } from './use-releases';
import { ReleasesDrawer } from './releases-drawer';

interface WhatsNewProps {
  version: string;
  channel: ReleaseChannel;
  releases: UseReleases;
  docsEntries: DocsChangelogEntry[];
  docsLoading: boolean;
}

/**
 * Replaces the old scrolling release box. Answering "should I update?" takes a
 * row; browsing history is a separate, deliberate action.
 */
export function WhatsNew({
  version,
  channel,
  releases,
  docsEntries,
  docsLoading,
}: WhatsNewProps) {
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  if (channel === 'dev') {
    return (
      <GlowCard className="p-4">
        <p className="text-sm text-gray-400">
          This is a dev/PR build (
          <span className="font-mono text-gray-300">{version}</span>). Update
          checks are not available.
        </p>
      </GlowCard>
    );
  }

  const latest = releases.newer[0];
  const upToDate =
    !releases.loading && !releases.error && releases.newer.length === 0;

  // The hand-written entry for whichever version is worth reading about.
  const entry = findDocsEntry(docsEntries, latest?.tag_name ?? version);

  return (
    <>
      <GlowCard className="p-5">
        {releases.loading ? (
          <div className="space-y-2">
            <Skeleton className="h-5 w-52" />
            <Skeleton className="h-4 w-full max-w-md" />
          </div>
        ) : releases.error ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-gray-400">
              Could not check for updates — {releases.error}
            </p>
            <ChangelogLinks onOpenReleases={() => setDrawerOpen(true)} />
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-3">
              {latest ? (
                <ArrowUpCircleIcon className="w-5 h-5 text-[--brand] shrink-0 mt-0.5" />
              ) : (
                <CheckCircle2Icon className="w-5 h-5 text-gray-500 shrink-0 mt-0.5" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-white">
                  {latest ? (
                    <>
                      {latest.tag_name} is available
                      {releases.newer.length > 1 && (
                        <span className="text-gray-500 font-normal">
                          {' '}
                          · {releases.newer.length} releases behind
                        </span>
                      )}
                    </>
                  ) : upToDate ? (
                    `You're on the latest ${channel === 'nightly' ? 'nightly' : 'release'}`
                  ) : (
                    `Running ${version}`
                  )}
                </p>
                {latest && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    You&apos;re on {version}
                  </p>
                )}

                {docsLoading ? (
                  <Skeleton className="h-4 w-64 mt-2" />
                ) : entry ? (
                  <div className="mt-2">
                    <p className="text-sm text-gray-300">{entry.title}</p>
                    {entry.description && (
                      <p className="text-sm text-[--muted] mt-0.5">
                        {entry.description}
                      </p>
                    )}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {entry && (
                <Button
                  intent="primary"
                  size="sm"
                  rightIcon={<ExternalLinkIcon className="w-3.5 h-3.5" />}
                  onClick={() =>
                    window.open(
                      docsEntryUrl(entry),
                      '_blank',
                      'noopener,noreferrer'
                    )
                  }
                >
                  What&apos;s new in {entry.version ?? entry.title}
                </Button>
              )}
              <ChangelogLinks onOpenReleases={() => setDrawerOpen(true)} />
            </div>
          </div>
        )}
      </GlowCard>

      <ReleasesDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        channel={channel}
        releases={releases}
      />
    </>
  );
}

function ChangelogLinks({ onOpenReleases }: { onOpenReleases: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <a
        href={DOCS_CHANGELOG_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition-colors"
      >
        <ScrollTextIcon className="w-3.5 h-3.5" />
        Changelog
      </a>
      <button
        type="button"
        onClick={onOpenReleases}
        className="text-sm text-gray-400 hover:text-white transition-colors"
      >
        All releases
      </button>
    </div>
  );
}
