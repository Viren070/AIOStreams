import React from 'react';
import { BiPackage } from 'react-icons/bi';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@aiostreams/ui/badge';
import { cn } from '@aiostreams/ui/core/styling';
import { formatDateTime, relativeTime } from '@aiostreams/ui/core/format';
import type { StatusResponse } from '@/context/status';
import {
  DOCS_CHANGELOG_URL,
  ReleaseChannel,
  docsEntryUrl,
  findDocsEntry,
} from '@/lib/changelog';
import { docsChangelogQuery } from '@/lib/queries';
import {
  useReleases,
  type UseReleases,
} from '@/components/shared/releases/use-releases';
import { ReleasesDrawer } from '@/components/shared/releases/releases-drawer';
import { OverviewCard, Reading } from './overview-card';

const REPO_URL = 'https://github.com/Viren070/AIOStreams';

const CHANNELS = {
  stable: { label: 'Stable', intent: 'success' },
  nightly: { label: 'Nightly', intent: 'blue' },
  dev: { label: 'Dev', intent: 'gray' },
} as const;

const HINT_LINK = 'hover:text-[--foreground] hover:underline';

function ExternalLink({
  href,
  title,
  className = 'hover:underline',
  children,
}: {
  href: string;
  title?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={title}
      className={className}
    >
      {children}
    </a>
  );
}

function dotted(items: React.ReactNode[]): React.ReactNode {
  const shown = items.filter(Boolean);
  if (shown.length === 0) return undefined;
  return shown.map((item, i) => (
    <React.Fragment key={i}>
      {i > 0 && ' · '}
      {item}
    </React.Fragment>
  ));
}

function LatestReading({
  channel,
  releases,
}: {
  channel: ReleaseChannel;
  releases: UseReleases;
}) {
  if (channel === 'dev') {
    return (
      <Reading label="Latest" value="—" hint="Not checked on dev builds" />
    );
  }
  if (releases.loading) {
    return <Reading label="Latest" value="—" hint="Checking for updates…" />;
  }
  if (releases.error) {
    const hint = `Couldn't check: ${releases.error}`;
    return (
      <Reading
        label="Latest"
        value="—"
        hint={<span title={hint}>{hint}</span>}
      />
    );
  }

  const latest = releases.newer[0];
  if (!latest) {
    return (
      <Reading
        label="Latest"
        value={<span className="text-emerald-500">Up to date</span>}
        hint={`No newer ${channel === 'nightly' ? 'nightly' : 'release'}`}
      />
    );
  }

  const behind = releases.newer.length;
  const noun = channel === 'nightly' ? 'build' : 'release';
  return (
    <Reading
      label="Latest"
      value={
        <ExternalLink
          href={latest.html_url}
          className="text-amber-500 hover:underline"
        >
          {latest.tag_name}
        </ExternalLink>
      }
      hint={`${behind} ${noun}${behind === 1 ? '' : 's'} behind · released ${relativeTime(
        Date.parse(latest.published_at)
      )}`}
    />
  );
}

export function VersionCard({ status }: { status: StatusResponse }) {
  const { tag, channel, commit } = status;
  const releases = useReleases(tag, channel, true);
  const docs = useQuery(docsChangelogQuery);
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  const builtAt = Date.parse(status.buildTime);
  const hasRelease = channel !== 'dev' && tag.toLowerCase() !== 'unknown';
  const showCommit = channel !== 'stable' && commit && commit !== 'unknown';

  // Nightly and dev tags name no release, so use the version they build on.
  const entry = findDocsEntry(
    docs.data ?? [],
    channel === 'stable' ? (releases.newer[0]?.tag_name ?? tag) : status.version
  );

  return (
    <>
      <OverviewCard
        icon={BiPackage}
        title="Version"
        aside={
          <Badge intent={CHANNELS[channel].intent} size="sm">
            {CHANNELS[channel].label}
          </Badge>
        }
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Reading
            label="Running"
            value={
              hasRelease ? (
                <ExternalLink href={`${REPO_URL}/releases/tag/${tag}`}>
                  {tag}
                </ExternalLink>
              ) : (
                tag
              )
            }
            hint={dotted([
              !Number.isNaN(builtAt) && (
                <span title={formatDateTime(status.buildTime)}>
                  Built {relativeTime(builtAt)}
                </span>
              ),
              showCommit && (
                <ExternalLink
                  href={`${REPO_URL}/commit/${commit}`}
                  className={cn('font-mono', HINT_LINK)}
                >
                  {commit}
                </ExternalLink>
              ),
            ])}
          />
          <LatestReading channel={channel} releases={releases} />
          <Reading
            label={
              entry
                ? `What's new in ${entry.version ?? entry.title}`
                : "What's new"
            }
            value={
              docs.isLoading ? (
                '—'
              ) : entry ? (
                <ExternalLink
                  href={docsEntryUrl(entry)}
                  title={entry.description ?? entry.title}
                >
                  {entry.title}
                </ExternalLink>
              ) : (
                <ExternalLink href={DOCS_CHANGELOG_URL}>Changelog</ExternalLink>
              )
            }
            hint={dotted([
              entry && (
                <ExternalLink href={DOCS_CHANGELOG_URL} className={HINT_LINK}>
                  Changelog
                </ExternalLink>
              ),
              channel !== 'dev' && (
                <button
                  type="button"
                  onClick={() => setDrawerOpen(true)}
                  className={HINT_LINK}
                >
                  All releases
                </button>
              ),
            ])}
          />
        </div>
      </OverviewCard>

      {channel !== 'dev' && (
        <ReleasesDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          channel={channel}
          releases={releases}
        />
      )}
    </>
  );
}
