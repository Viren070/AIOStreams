import Link from 'next/link';
import type { IconType } from 'react-icons';
import {
  FaRocket,
  FaBook,
  FaCode,
  FaFileCode,
  FaCodeBranch,
  FaArrowAltCircleUp,
} from 'react-icons/fa';
import { DonateButton } from '@/components/donate-button';

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col">
      {/* Hero */}
      <div className="flex flex-col items-center justify-center flex-1 text-center px-4 py-24 gap-6">
        <div className="inline-flex items-center rounded-full border border-fd-border bg-fd-muted/50 px-3 py-1 text-xs font-medium text-fd-muted-foreground">
          Stremio Addon Aggregator
        </div>
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
          <Link
            href="https://github.com/Viren070/AIOStreams"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-md border border-fd-border px-4 py-2 text-sm font-medium transition-colors hover:bg-fd-muted"
          >
            GitHub
          </Link>
          <DonateButton className="inline-flex items-center gap-2 rounded-md border border-fd-border px-4 py-2 text-sm font-medium transition-colors hover:bg-fd-muted" />
        </div>
      </div>

      {/* Nav cards */}
      <div className="px-6 pb-16 max-w-4xl mx-auto w-full">
        <p className="text-xs font-medium uppercase tracking-wider text-fd-muted-foreground mb-4">
          Explore the docs
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <NavCard
            href="/getting-started"
            title="Getting Started"
            description="Deploy AIOStreams and get it running in minutes."
            icon={FaRocket}
          />
          <NavCard
            href="/guides/groups"
            title="Guides"
            description="Groups, Usenet, Scored Sorting, and Templates."
            icon={FaBook}
          />
          <NavCard
            href="/reference/stream-expressions"
            title="Reference"
            description="Complete reference for SEL and the Custom Formatter."
            icon={FaFileCode}
          />
          <NavCard
            href="/apis"
            title="API"
            description="HTTP API for search and user data operations."
            icon={FaCode}
          />
          <NavCard
            href="/migrations/v1-to-v2"
            title="Migration"
            description="Upgrading from AIOStreams v1 to v2."
            icon={FaArrowAltCircleUp}
          />
          <NavCard
            href="/guides/development"
            title="Contributing"
            description="Set up a local development environment."
            icon={FaCodeBranch}
          />
        </div>
      </div>
    </main>
  );
}

function NavCard({
  href,
  title,
  description,
  icon: Icon,
}: {
  href: string;
  title: string;
  description: string;
  icon: IconType;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col gap-3 rounded-xl border border-fd-border bg-fd-card p-5 text-left transition-all hover:border-fd-primary/30 hover:bg-fd-muted"
    >
      <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-fd-border bg-fd-muted text-fd-primary">
        <Icon size={16} />
      </div>
      <div>
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-0.5 text-sm text-fd-muted-foreground">{description}</p>
      </div>
    </Link>
  );
}
