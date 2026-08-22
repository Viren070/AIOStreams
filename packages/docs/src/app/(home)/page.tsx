import Link from 'next/link';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import {
  FaRocket,
  FaBook,
  FaCode,
  FaFileCode,
  FaSlidersH,
  FaQuestionCircle,
  FaArrowRight,
} from 'react-icons/fa';
import { Card, Cards } from 'fumadocs-ui/components/card';
import { DonateButton } from '@/components/donate-button';
import { getChangelogEntries } from '@/lib/source';
import { canonical, sharedOpenGraph } from '@/lib/site';

export const metadata: Metadata = {
  alternates: { canonical: canonical('/') },
  openGraph: { ...sharedOpenGraph, url: canonical('/') },
};

const SECTIONS: Array<{
  href: string;
  title: string;
  description: string;
  icon: ReactNode;
}> = [
  {
    href: '/getting-started',
    title: 'Getting Started',
    description: 'Use a public instance or deploy your own in minutes.',
    icon: <FaRocket />,
  },
  {
    href: '/configuration/setup',
    title: 'Configuration',
    description:
      'Walk through setup, then every option and environment variable.',
    icon: <FaSlidersH />,
  },
  {
    href: '/guides/groups',
    title: 'Guides',
    description: 'Groups, usenet, scored sorting, SSO and config profiles.',
    icon: <FaBook />,
  },
  {
    href: '/reference/stream-expressions',
    title: 'Reference',
    description:
      'Stream and config expressions, the custom formatter, templates.',
    icon: <FaFileCode />,
  },
  {
    href: '/apis',
    title: 'API',
    description: 'HTTP API for search, user data and anime lookups.',
    icon: <FaCode />,
  },
  {
    href: '/faq',
    title: 'Help',
    description: 'Answers to common questions and fixes for common problems.',
    icon: <FaQuestionCircle />,
  },
];

export default function HomePage() {
  const latest = getChangelogEntries()[0];

  return (
    <main className="flex flex-1 flex-col">
      {/* Hero */}
      <div className="flex flex-col items-center justify-center flex-1 text-center px-4 py-24 gap-6">
        {latest ? (
          <Link
            href={latest.url}
            className="group inline-flex items-center gap-2 rounded-full border border-fd-border bg-fd-muted/50 px-3 py-1 text-xs font-medium text-fd-muted-foreground transition-colors hover:bg-fd-muted hover:text-fd-foreground"
          >
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-fd-primary opacity-75" />
              <span className="relative inline-flex size-1.5 rounded-full bg-fd-primary" />
            </span>
            New in v{latest.data.version ?? latest.slugs.at(-1)}
            <span className="text-fd-foreground">{latest.data.title}</span>
            <FaArrowRight
              size={9}
              className="transition-transform group-hover:translate-x-0.5"
            />
          </Link>
        ) : (
          <div className="inline-flex items-center rounded-full border border-fd-border bg-fd-muted/50 px-3 py-1 text-xs font-medium text-fd-muted-foreground">
            Stremio Addon Aggregator
          </div>
        )}
        <h1 className="text-5xl font-bold tracking-tight md:text-6xl">
          AIOStreams
        </h1>
        <p className="text-fd-muted-foreground max-w-xl text-lg">
          Combine, filter, sort, and customise streams from every source — all
          in one place.
        </p>
        <div className="flex gap-3 flex-wrap justify-center">
          <Link
            href="/getting-started"
            className="inline-flex items-center gap-2 rounded-md bg-fd-primary px-4 py-2 text-sm font-medium text-fd-primary-foreground transition-colors hover:bg-fd-primary/90"
          >
            Read the docs
          </Link>
          <DonateButton className="inline-flex items-center gap-2 rounded-md border border-fd-border px-4 py-2 text-sm font-medium transition-colors hover:bg-fd-muted" />
        </div>
      </div>

      {/* Nav cards */}
      <div className="px-6 pb-16 max-w-4xl mx-auto w-full">
        <p className="text-xs font-medium uppercase tracking-wider text-fd-muted-foreground mb-4">
          Explore the docs
        </p>
        <Cards className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {SECTIONS.map((section) => (
            <Card
              key={section.href}
              {...section}
              className="@max-lg:col-span-1"
            />
          ))}
        </Cards>
      </div>
    </main>
  );
}
