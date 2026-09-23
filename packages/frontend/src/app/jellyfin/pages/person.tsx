import React from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { LuffyError } from '@/components/shared/luffy-error';
import { cn } from '@/components/ui/core/styling';
import { useSession } from '../lib/session';
import { useItem, usePersonItems } from '../lib/queries';
import { posterUrl } from '../lib/images';
import { yearsBetween } from '../lib/format';
import { hasSelection } from '../lib/selection';
import { useInView } from '../lib/use-in-view';
import { PageBody } from '../components/layout';
import { MixedGrid } from '../components/mixed-grid';
import { ExternalLinks } from '../components/external-links';
import { KINDS, KindTabs } from '../components/kind-tabs';
import type { BaseItemDto } from '../lib/types';

function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** Born and died lines as Jellyfin shows them, with the age reached. */
function LifeDates({ person }: { person: BaseItemDto }) {
  const born = person.PremiereDate;
  const died = person.EndDate;
  const place = person.ProductionLocations?.[0];
  const lines = [
    (born || place) &&
      [
        'Born',
        born && longDate(born),
        born && !died && `(age ${yearsBetween(born)})`,
        place && `in ${place}`,
      ]
        .filter(Boolean)
        .join(' '),
    died &&
      `Died ${longDate(died)}${born ? ` (aged ${yearsBetween(born, died)})` : ''}`,
  ].filter(Boolean);
  if (!lines.length) return null;
  return (
    <div className="space-y-0.5 text-sm text-gray-300">
      {lines.map((line) => (
        <p key={line as string}>{line}</p>
      ))}
    </div>
  );
}

function Header({ person }: { person: BaseItemDto }) {
  const { client } = useSession();
  const [expanded, setExpanded] = React.useState(false);
  const photo = posterUrl(client, person, { maxWidth: 500 });
  return (
    <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:gap-8">
      <div className="aspect-[2/3] w-36 flex-none overflow-hidden rounded-xl bg-gray-900 shadow-2xl ring-1 ring-white/10 sm:w-48">
        {photo && (
          <img src={photo} alt="" className="h-full w-full object-cover" />
        )}
      </div>
      <div className="min-w-0 max-w-3xl flex-1 space-y-3">
        <h1 className="text-3xl font-bold leading-tight sm:text-4xl">
          {person.Name}
        </h1>
        <LifeDates person={person} />
        <ExternalLinks links={person.ExternalUrls} />
        {person.Overview && (
          <p
            onClick={() => !hasSelection() && setExpanded((v) => !v)}
            className={cn(
              'cursor-pointer select-text whitespace-pre-line text-sm leading-relaxed text-gray-300 sm:text-base',
              !expanded && 'line-clamp-5'
            )}
          >
            {person.Overview}
          </p>
        )}
      </div>
    </div>
  );
}

function Filmography({ personId }: { personId: string }) {
  const { client } = useSession();
  const [types, setTypes] = React.useState(KINDS[0].types);
  const pages = usePersonItems(personId, types);
  const items = pages.data?.pages.flatMap((p) => p.Items ?? []) ?? [];
  const total = pages.data?.pages[0]?.TotalRecordCount;
  // Keyed on pages, not items: a page can hold nothing this setup can open.
  const sentinel = useInView<HTMLDivElement>(
    () => {
      if (pages.hasNextPage && !pages.isFetchingNextPage)
        void pages.fetchNextPage();
    },
    '800px',
    [pages.data?.pages.length, types]
  );
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">
          Filmography
          {total != null && (
            <span className="ml-2 text-base font-normal text-[--muted]">
              {total}
            </span>
          )}
        </h2>
        <KindTabs types={types} onChange={setTypes} />
      </div>
      {pages.isError ? (
        <LuffyError title="Could not load their work" />
      ) : (
        <>
          <MixedGrid items={items} client={client} loading={pages.isLoading} />
          {!pages.isLoading && !items.length && (
            <p className="text-[--muted]">Nothing found.</p>
          )}
        </>
      )}
      {pages.isFetchingNextPage && (
        <Skeleton className="h-40 w-full rounded-xl" />
      )}
      <div ref={sentinel} />
    </section>
  );
}

/** A person's details and their work, found through TMDB when set up. */
export function PersonPage({ personId }: { personId: string }) {
  const person = useItem(personId);
  if (person.isError) {
    return (
      <PageBody>
        <LuffyError title="Could not load this person" />
      </PageBody>
    );
  }
  return (
    <PageBody>
      {person.data ? (
        <Header person={person.data} />
      ) : (
        <div className="flex gap-8">
          <Skeleton className="aspect-[2/3] h-auto w-36 rounded-xl sm:w-48" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-10 w-1/2" />
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-24 w-full max-w-2xl" />
          </div>
        </div>
      )}
      <Filmography personId={personId} />
    </PageBody>
  );
}
