import Link from 'next/link';
import type { Metadata } from 'next';
import {
  DocsDescription,
  DocsPage,
  DocsTitle,
} from 'fumadocs-ui/layouts/docs/page';
import { Card, Cards } from 'fumadocs-ui/components/card';
import { formatChangelogDate, getChangelogEntries } from '@/lib/source';
import { canonical, sharedOpenGraph } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Changelog',
  description: 'Release notes for AIOStreams.',
  alternates: { canonical: canonical('/changelog') },
  openGraph: { ...sharedOpenGraph, url: canonical('/changelog') },
};

export default function ChangelogIndex() {
  const entries = getChangelogEntries();

  return (
    <DocsPage
      breadcrumb={{ enabled: false }}
      footer={{ enabled: false }}
      tableOfContent={{ enabled: false }}
    >
      <DocsTitle>Changelog</DocsTitle>
      <DocsDescription className="mb-0">
        Major releases, new features and breaking changes. Every change, down to
        the commit, is in{' '}
        <Link
          href="https://github.com/Viren070/AIOStreams/blob/main/CHANGELOG.md"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-4 hover:text-fd-foreground"
        >
          CHANGELOG.md
        </Link>
        .
      </DocsDescription>

      {entries.length === 0 ? (
        <p className="mt-6 text-sm text-fd-muted-foreground">
          Nothing here yet, check back after the next release.
        </p>
      ) : (
        <Cards className="mt-6 grid-cols-1">
          {entries.map((entry) => (
            <Card
              key={entry.url}
              href={entry.url}
              description={entry.data.description}
              // Card renders children below the description; the release meta
              // belongs above the title, so it rides in as part of it.
              title={
                <span className="flex flex-col gap-2">
                  <span className="flex flex-wrap items-center gap-2 text-xs font-normal text-fd-muted-foreground">
                    <span className="rounded-full border bg-fd-muted/50 px-2 py-0.5 font-medium">
                      {entry.data.version ?? entry.slugs.at(-1)}
                    </span>
                    <time dateTime={new Date(entry.data.date).toISOString()}>
                      {formatChangelogDate(entry.data.date)}
                    </time>
                    {entry.data.draft ? (
                      <span className="rounded-full border px-2 py-0.5 font-medium">
                        Draft
                      </span>
                    ) : null}
                  </span>
                  <span>{entry.data.title}</span>
                </span>
              }
            />
          ))}
        </Cards>
      )}
    </DocsPage>
  );
}
