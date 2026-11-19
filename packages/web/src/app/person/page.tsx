import React from 'react';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { BiInfoCircle } from 'react-icons/bi';
import { IoStar } from 'react-icons/io5';
import { LuListFilter } from 'react-icons/lu';
import { Combobox } from '@aiostreams/ui/combobox';
import { Skeleton } from '@aiostreams/ui/skeleton';
import { LuffyError } from '@aiostreams/ui/shared/luffy-error';
import { useSession } from '@/lib/jellyfin/session';
import { useItem, usePersonItems } from '@/lib/jellyfin/queries';
import { posterUrl } from '@/lib/artwork/urls';
import { dateFormat, yearsBetween } from '@/lib/format';
import { useInView, useNear } from '@/hooks/use-in-view';
import { PageBody, PageMessage } from '@/components/shell/page';
import { scoresOf } from '@/components/media/scores';
import { Anchor } from '@/components/anchor';
import { href, itemPath } from '@/lib/paths';
import { useSearchParam } from '@/hooks/use-search-param';
import { ExternalLinks } from '@/components/media/external-links';
import { Overview } from '@/components/media/overview';
import { KindTabs, useKindParam } from '@/components/media/kind-tabs';
import type { BaseItemDto } from '@/lib/jellyfin/types';
import { CachedImage } from '@/components/cached-image';

function longDate(iso: string): string {
  return dateFormat({ day: 'numeric', month: 'long', year: 'numeric' }).format(
    new Date(iso)
  );
}

function bornLine(
  born: string | null | undefined,
  died: string | null | undefined,
  place: string | undefined
): string | null {
  if (!born) return place ? t`Born in ${place}` : null;
  const date = longDate(born);
  if (died) return place ? t`Born ${date} in ${place}` : t`Born ${date}`;
  const age = yearsBetween(born);
  return place
    ? t`Born ${date} (age ${age}) in ${place}`
    : t`Born ${date} (age ${age})`;
}

function diedLine(
  born: string | null | undefined,
  died: string | null | undefined
): string | null {
  if (!died) return null;
  const date = longDate(died);
  if (!born) return t`Died ${date}`;
  const age = yearsBetween(born, died);
  return t`Died ${date} (aged ${age})`;
}

/** Born and died lines as Jellyfin shows them, with the age reached. */
function LifeDates({ person }: { person: BaseItemDto }) {
  const born = person.PremiereDate;
  const died = person.EndDate;
  const place = person.ProductionLocations?.[0];
  const lines = [bornLine(born, died, place), diedLine(born, died)].filter(
    Boolean
  );
  if (!lines.length) return null;
  return (
    <div data-ui="person-dates" className="space-y-0.5 text-sm text-gray-300">
      {lines.map((line) => (
        <p key={line as string}>{line}</p>
      ))}
    </div>
  );
}

function Header({ person }: { person: BaseItemDto }) {
  const { client } = useSession();
  const photo = posterUrl(client, person, { maxWidth: 192 });
  return (
    <div
      data-ui="person-header"
      className="flex flex-col gap-6 sm:flex-row sm:items-start sm:gap-8"
    >
      <div
        data-ui="person-photo"
        className="aspect-[2/3] w-36 flex-none overflow-hidden rounded-xl bg-gray-900 shadow-2xl ring-1 ring-white/10 sm:w-48"
      >
        {photo && (
          <CachedImage
            src={photo}
            alt=""
            className="h-full w-full object-cover"
          />
        )}
      </div>
      <div className="min-w-0 max-w-3xl flex-1 space-y-3">
        <h1
          data-ui="page-title"
          className="text-3xl font-bold leading-tight sm:text-4xl"
        >
          {person.Name}
        </h1>
        <LifeDates person={person} />
        <ExternalLinks links={person.ExternalUrls} />
        <Overview
          title={person.Name ?? ''}
          overview={person.Overview}
          image={[]}
          clampClass="max-h-[5lh]"
          className="text-sm leading-relaxed text-gray-300 sm:text-base"
        />
      </div>
    </div>
  );
}

/** How many titles of a kind of work the server counted, by movies and shows. */
interface CreditCount {
  type: string;
  movies: number;
  series: number;
}

/** The person's kinds of work with their counts, and the kind TMDB knows them for. */
function creditsOf(person: BaseItemDto | undefined): {
  credits: CreditCount[];
  knownFor?: string;
} {
  const extension = (
    person as
      | { aiostreams?: { credits?: CreditCount[]; knownFor?: string } }
      | undefined
  )?.aiostreams;
  return {
    credits: extension?.credits ?? [],
    knownFor: extension?.knownFor,
  };
}

/** A kind of work's name as a filter; any the server names by TMDB's department keeps that. */
function workLabel(kind: string): string {
  switch (kind) {
    case 'Actor':
      return t`Acting`;
    case 'Director':
      return t`Directing`;
    case 'Writer':
      return t`Writing`;
    case 'Composer':
      return t({ comment: 'A person’s work on scores', message: 'Music' });
    case 'Producer':
      return t`Producing`;
    case 'Editor':
      return t`Editing`;
    default:
      return kind;
  }
}

/** Crew kinds a title page names that a person's page counts under another. */
// eslint-disable-next-line lingui/no-unlocalized-strings -- Jellyfin's person kinds
const SAME_WORK: Record<string, string> = {
  Creator: 'Writer',
  GuestStar: 'Actor',
};
/** Every kind of work, the filters all off. */
const ALL_WORK = 'all';

/**
 * The kinds of work shown, kept in the address: the one a link asked for,
 * else the one TMDB knows them for, else their most.
 */
function useWorkParam(
  credits: CreditCount[],
  knownFor: string | undefined
): [string[], (next: string[]) => void] {
  const [param, setParam] = useSearchParam('role');
  const counted = new Set(credits.map((c) => c.type));
  const fallback =
    knownFor && counted.has(knownFor) ? knownFor : credits[0]?.type;
  const asked = (param ?? '')
    .split(',')
    .map((kind) => SAME_WORK[kind] ?? kind)
    .filter((kind) => counted.has(kind));
  const shown =
    !credits.length || param === ALL_WORK
      ? []
      : asked.length
        ? asked
        : fallback
          ? [fallback]
          : [];
  return [
    shown,
    (next) =>
      setParam(
        !next.length
          ? ALL_WORK
          : next.length === 1 && next[0] === fallback
            ? undefined
            : next.join(',')
      ),
  ];
}

function countIn(count: CreditCount, types: string): number {
  if (types === 'Movie') return count.movies;
  if (types === 'Series') return count.series;
  return count.movies + count.series;
}

/**
 * Kinds of work as one picker, so a remote passes one control rather than a
 * pill for each; the ones on show as chips in it, each with its own remove.
 */
function WorkFilters({
  credits,
  types,
  shown,
  onChange,
}: {
  credits: CreditCount[];
  types: string;
  shown: string[];
  onChange: (next: string[]) => void;
}) {
  const offered = credits.filter(
    (c) => countIn(c, types) > 0 || shown.includes(c.type)
  );
  if (offered.length < 2 && !shown.length) return null;
  return (
    <Combobox
      data-ui="work-filters"
      aria-label={t`Kinds of work`}
      multiple
      maxDisplayedItems={1}
      leftIcon={<LuListFilter />}
      placeholder={t`All work`}
      emptyMessage={t`Nothing matches.`}
      className="min-w-0 flex-1 rounded-full sm:w-56 sm:flex-none"
      options={offered.map((count) => ({
        value: count.type,
        label: `${workLabel(count.type)} · ${countIn(count, types)}`,
        textValue: workLabel(count.type),
      }))}
      value={shown}
      onValueChange={onChange}
    />
  );
}

function yearOf(item: BaseItemDto): number | undefined {
  if (item.ProductionYear) return item.ProductionYear;
  return item.PremiereDate
    ? new Date(item.PremiereDate).getFullYear()
    : undefined;
}

/** Runs of titles from one year, in the order the server sent them. */
function byYear(
  items: BaseItemDto[]
): { year: number | undefined; items: BaseItemDto[] }[] {
  const years: { year: number | undefined; items: BaseItemDto[] }[] = [];
  for (const item of items) {
    const year = yearOf(item);
    const last = years.at(-1);
    if (last && last.year === year) last.items.push(item);
    else years.push({ year, items: [item] });
  }
  return years;
}

/** What the person did on a title, of the kinds shown where any are. */
function partsOf(item: BaseItemDto, shown: string[]): string[] {
  const people = item.People ?? [];
  const matching = shown.length
    ? people.filter((p) => shown.includes(String(p.Type)))
    : people;
  const parts = (matching.length ? matching : people).map((p) => {
    const part = p.Role || workLabel(String(p.Type ?? ''));
    // AIOStreams counts a show's episodes in each part, as IMDb lists them.
    const count = (p as { EpisodeCount?: number }).EpisodeCount;
    if (!part || !count) return part;
    const episodes = plural(count, { one: '# episode', other: '# episodes' });
    return t({
      comment: 'A person’s part on a show and how many episodes it covered',
      message: `${part} (${episodes})`,
    });
  });
  return [...new Set(parts.filter(Boolean))];
}

/**
 * The title's IMDb score, else the one score its server calls the community's,
 * with a star as IMDb lists it. A list item has none, so each row asks for its
 * title once it nears the screen, top to bottom, and the score shows as it
 * comes.
 */
function CreditScore({ item }: { item: BaseItemDto }) {
  const [box, near] = useNear<HTMLParagraphElement>();
  const full = useItem(near ? (item.Id ?? '') : '');
  const scores = scoresOf(full.data ?? item);
  const score =
    scores.find((s) => s.source === 'imdb') ??
    scores.find((s) => s.source === 'community');
  return (
    <p
      ref={box}
      data-ui="credit-score"
      className="flex h-5 items-center text-sm text-gray-300"
    >
      {score ? (
        <span className="inline-flex items-center gap-1 tabular-nums animate-in fade-in-0 duration-500">
          <IoStar aria-hidden className="text-amber-400" />
          <span className="sr-only">{t`Rating`}</span>
          {((score.value / score.scale) * 10).toFixed(1)}
        </span>
      ) : (
        near && full.isLoading && <Skeleton className="h-3.5 w-12 rounded" />
      )}
    </p>
  );
}

/** As IMDb lists a person's work: poster, title, score and part, then the year. */
function CreditRow({ item, shown }: { item: BaseItemDto; shown: string[] }) {
  const { client } = useSession();
  const poster = posterUrl(client, item, { maxWidth: 112 });
  const parts = partsOf(item, shown);
  const year = yearOf(item);
  return (
    <li>
      <Anchor
        data-ui="credit"
        href={href(itemPath(item))}
        className="group flex items-center gap-4 rounded-lg px-2 py-3 transition-colors hover:bg-white/5 focus-visible:bg-white/10"
      >
        <div
          data-ui="credit-poster"
          className="aspect-[2/3] w-12 flex-none overflow-hidden rounded-lg bg-gray-900 ring-1 ring-white/10 sm:w-14"
        >
          {poster && (
            <CachedImage
              src={poster}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
            />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-0.5">
          <p
            data-ui="credit-title"
            className="truncate font-semibold group-hover:underline"
          >
            {item.Name}
            {item.Type === 'Series' && (
              <span className="ms-2 text-xs font-normal text-[--muted]">
                <Trans>Show</Trans>
              </span>
            )}
          </p>
          <CreditScore item={item} />
          {parts.length > 0 && (
            <p
              data-ui="credit-part"
              className="truncate text-sm text-[--muted]"
            >
              {parts.join(', ')}
            </p>
          )}
        </div>
        {year && (
          <span
            data-ui="credit-year"
            className="flex-none text-sm tabular-nums text-[--muted]"
          >
            {year}
          </span>
        )}
        <BiInfoCircle
          aria-hidden
          data-ui="credit-info"
          className="size-6 flex-none text-brand-400"
        />
      </Anchor>
    </li>
  );
}

function CreditsSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-2">
          <Skeleton className="aspect-[2/3] h-auto w-10 rounded sm:w-12" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

function Filmography({
  personId,
  person,
}: {
  personId: string;
  person: BaseItemDto | undefined;
}) {
  const [types, setTypes] = useKindParam();
  const { credits, knownFor } = creditsOf(person);
  const [shown, setShown] = useWorkParam(credits, knownFor);
  // Once the person is in, so the list starts on their kind of work.
  const pages = usePersonItems(personId, types, shown, !!person);
  const items = pages.data?.pages.flatMap((p) => p.Items ?? []) ?? [];
  const total = pages.data?.pages[0]?.TotalRecordCount;
  const years = React.useMemo(() => byYear(items), [items]);
  // Keyed on pages, not items: a page can hold nothing this setup can open.
  const sentinel = useInView<HTMLDivElement>(
    () => {
      if (pages.hasNextPage && !pages.isFetchingNextPage)
        void pages.fetchNextPage();
    },
    '800px',
    [pages.data?.pages.length, types, shown.join(',')]
  );
  return (
    <section data-ui="section" data-name="filmography" className="space-y-5">
      <div className="space-y-4">
        <h2 data-ui="section-title" className="text-xl font-semibold">
          <Trans>Filmography</Trans>
          {total != null && (
            <span className="ms-2 text-base font-normal text-[--muted]">
              {total}
            </span>
          )}
        </h2>
        {/* A line of their own at the start, the picker first, so a remote
            coming down the page meets it first and the count coming in beside
            the title moves nothing. Both come with the person, in room kept. */}
        <div className="flex min-h-10 flex-nowrap items-center gap-3">
          {person && (
            <>
              <WorkFilters
                credits={credits}
                types={types}
                shown={shown}
                onChange={setShown}
              />
              <KindTabs types={types} onChange={setTypes} />
            </>
          )}
        </div>
      </div>
      {pages.isError ? (
        <LuffyError title={t`Could not load their work`} />
      ) : pages.isLoading || !person ? (
        <CreditsSkeleton />
      ) : !items.length ? (
        <p className="text-[--muted]">
          <Trans>Nothing found.</Trans>
        </p>
      ) : (
        <div data-ui="credits" className="max-w-4xl space-y-6">
          {years.map(({ year, items: titles }, i) => (
            <section
              key={`${year ?? 'none'}-${i}`}
              data-ui="credit-year"
              className="grid gap-x-6 gap-y-1 sm:grid-cols-[4.5rem_1fr]"
            >
              <h3
                data-ui="credit-year-title"
                className="text-2xl font-bold tabular-nums text-gray-400 sm:sticky sm:top-[calc(var(--top-bar,0px)+1rem)] sm:self-start sm:pt-2"
              >
                {year ?? (
                  <span className="text-base font-semibold">
                    <Trans>To be announced</Trans>
                  </span>
                )}
              </h3>
              <ol className="divide-y divide-white/10 border-t border-white/10 sm:border-t-0">
                {titles.map((item) => (
                  <CreditRow key={item.Id} item={item} shown={shown} />
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
      {pages.isFetchingNextPage && <CreditsSkeleton />}
      <div ref={sentinel} />
    </section>
  );
}

/** A person's details and their work, found through TMDB when set up. */
export function PersonPage({ personId }: { personId: string }) {
  const person = useItem(personId);
  if (person.isError) {
    return (
      <PageMessage>
        <LuffyError title={t`Could not load this person`} className="mt-0" />
      </PageMessage>
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
      <Filmography personId={personId} person={person.data} />
    </PageBody>
  );
}
