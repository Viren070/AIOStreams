import type { MetaPreview, ParsedMeta, UserData } from '../db/schemas.js';
import type { AIOStreams } from '../main/index.js';
import { createLogger } from '../logging/logger.js';
import type {
  TMDBMetadata,
  TMDBPerson,
  TMDBPersonCredit,
} from '../metadata/tmdb.js';
import { IdMappingDataset } from '../metadata/id-mappings.js';
import { peopleDtos } from './dto.js';
import { providerIdsFrom, toIso } from './enrichment.js';
import { imageTagsFor, rememberImages } from './images.js';
import { searchPersonCatalogs } from './library.js';
import {
  isoDate,
  TMDB_IMAGES,
  titlePreviewsInOrder,
  tmdbFor,
} from './tmdb-titles.js';
import type { JellyfinItem, PersonDescriptor } from './types.js';

const logger = createLogger('jellyfin');

/* Talk and news shows list their guests; a filmography is work, not visits. */
const TALK_AND_NEWS = new Set([10767, 10763]);
/* Credit lines that name someone who did not work on the title. */
const HONORARY_JOBS = new Set([
  'Thanks',
  'Special Thanks',
  'In Memory Of',
  'Characters',
]);

export type FilmographyKind = 'movie' | 'series';

export type FoundPerson =
  { meta: ParsedMeta } | { tmdb: TMDBMetadata; person: TMDBPerson };

interface PersonDetails {
  overview?: string;
  born?: string;
  died?: string;
  birthPlace?: string;
  photo?: string;
  providerIds: Record<string, string>;
}

export interface FilmographyQuery {
  kinds?: FilmographyKind[];
  /** Jellyfin person kinds, such as Director; a title is kept for any of them. */
  personTypes?: string[];
  sortBy: string[];
  descending?: boolean;
  startIndex: number;
  limit: number;
}

/** What a person did on a title: a Jellyfin person kind, and the character played or job held. */
export interface CreditedPart {
  type: string;
  role?: string;
  /** On a show, the episodes this part covered. */
  episodes?: number;
}

/** How many titles a person has of a kind of work, by movies and shows. */
export interface CreditCount {
  type: string;
  movies: number;
  series: number;
}

/**
 * The Jellyfin person kind of a TMDB department and job, the kinds title crews
 * are sent as; a department no kind covers keeps its own name.
 */
export function personKindOf(department: string, job?: string): string {
  switch (department) {
    case 'Acting':
      return 'Actor';
    case 'Directing':
      return job && /^(co-)?director$/i.test(job) ? 'Director' : department;
    case 'Writing':
      return 'Writer';
    case 'Sound':
      return job && /compos|^music$/i.test(job) ? 'Composer' : department;
    case 'Production':
      return job && /producer/i.test(job) ? 'Producer' : department;
    case 'Editing':
      return 'Editor';
    default:
      return department;
  }
}

/** The kind of work TMDB knows a person for, by their main department. */
function knownKind(department: string): string {
  switch (department) {
    case 'Directing':
      return 'Director';
    case 'Sound':
      return 'Composer';
    case 'Production':
      return 'Producer';
    default:
      return personKindOf(department);
  }
}

/** A credit's parts, leaving out honorary ones. */
export function creditedParts(credit: TMDBPersonCredit): CreditedPart[] {
  return credit.parts
    .filter((part) => !part.role || !HONORARY_JOBS.has(part.role))
    .map((part) => ({
      type: personKindOf(part.department, part.role),
      ...(part.role && { role: part.role }),
      ...(part.episodes && { episodes: part.episodes }),
    }));
}

export async function findPerson(
  engine: AIOStreams,
  userData: UserData,
  d: PersonDescriptor
): Promise<FoundPerson | null> {
  if (d.i && engine.canGetMeta('person', d.i)) {
    const meta = (await engine.getMeta('person', d.i).catch(() => null))?.data;
    if (meta) return { meta };
  }
  const tmdb = tmdbFor(userData);
  if (!tmdb) return null;
  try {
    const id =
      Number(d.i?.match(/^tmdb:(\d+)$/)?.[1]) || (await tmdb.findPersonId(d.n));
    const person = id ? await tmdb.getPerson(id) : undefined;
    return person ? { tmdb, person } : null;
  } catch (error) {
    logger.debug(
      {
        name: d.n,
        err: error instanceof Error ? error.message : String(error),
      },
      'person lookup failed'
    );
    return null;
  }
}

export async function searchPeople(
  engine: AIOStreams,
  userData: UserData,
  term: string,
  limit: number
): Promise<MetaPreview[]> {
  const found = await searchPersonCatalogs(engine, term, limit);
  if (found.length) return found;
  const tmdb = tmdbFor(userData);
  if (!tmdb) return [];
  const results = await tmdb.searchPeople(term).catch((error) => {
    logger.debug(
      { err: error instanceof Error ? error.message : String(error) },
      'person search failed'
    );
    return [];
  });
  return results.slice(0, limit).map((r) => ({
    id: `tmdb:${r.tmdbId}`,
    type: 'person',
    name: r.name,
    poster: r.profilePath ? `${TMDB_IMAGES}w500${r.profilePath}` : undefined,
  }));
}

function detailsOf(found: FoundPerson): PersonDetails {
  if ('meta' in found) {
    const { meta } = found;
    return {
      overview: meta.description ?? undefined,
      born: toIso(meta.birthday),
      died: toIso(meta.deathday),
      birthPlace: meta.birthPlace ?? undefined,
      photo: meta.poster ?? undefined,
      providerIds: providerIdsFrom(meta),
    };
  }
  const { person } = found;
  return {
    overview: person.biography,
    born: isoDate(person.birthday),
    died: isoDate(person.deathday),
    birthPlace: person.placeOfBirth,
    photo: person.profilePath
      ? `${TMDB_IMAGES}w500${person.profilePath}`
      : undefined,
    providerIds: {
      Tmdb: String(person.tmdbId),
      ...(person.imdbId && { Imdb: person.imdbId }),
    },
  };
}

/* A title's page is not kept waiting on TMDB; a slow answer is kept for next time. */
const COMPOSERS_WAIT_MS = 1500;

/**
 * Adds TMDB's composers to a film's or show's people where its metadata names
 * none, as most meta addons list only cast, directors and writers.
 */
export async function withComposers(
  userData: UserData,
  item: JellyfinItem
): Promise<JellyfinItem> {
  if (item.Type !== 'Movie' && item.Type !== 'Series') return item;
  const people = (item.People as { Type?: string }[] | undefined) ?? [];
  if (people.some((p) => p.Type === 'Composer')) return item;
  const tmdb = tmdbFor(userData);
  const ids = (item.ProviderIds ?? {}) as Record<string, string | undefined>;
  const kind = item.Type === 'Movie' ? 'movie' : 'series';
  const tmdbId =
    Number(ids.Tmdb) ||
    (ids.Imdb
      ? IdMappingDataset.getInstance().resolve(kind, { imdbId: ids.Imdb })
          .tmdbId
      : undefined);
  if (!tmdb || !tmdbId) return item;
  const asked = tmdb
    .getComposers(kind === 'movie' ? 'movie' : 'tv', Number(tmdbId))
    .catch((error) => {
      logger.debug(
        { tmdbId, err: error instanceof Error ? error.message : String(error) },
        'composer lookup failed'
      );
      return [];
    });
  const composers = await Promise.race([
    asked,
    new Promise<[]>((resolve) =>
      setTimeout(() => resolve([]), COMPOSERS_WAIT_MS).unref()
    ),
  ]);
  if (!composers.length) return item;
  return {
    ...item,
    People: [
      ...people,
      ...peopleDtos(
        composers.map((c) => ({
          name: c.name,
          type: 'Composer' as const,
          id: `tmdb:${c.tmdbId}`,
          photo: c.profilePath
            ? `${TMDB_IMAGES}w500${c.profilePath}`
            : undefined,
        }))
      ),
    ],
  };
}

export function withPersonDetails(
  item: JellyfinItem,
  found: FoundPerson
): JellyfinItem {
  const details = detailsOf(found);
  const ids = details.providerIds;
  const out: JellyfinItem = {
    ...item,
    Overview: details.overview ?? item.Overview,
    PremiereDate: details.born,
    EndDate: details.died,
    ProductionLocations: details.birthPlace ? [details.birthPlace] : [],
    ProviderIds: ids,
    ExternalUrls: [
      ...(ids.Imdb
        ? [{ Name: 'IMDb', Url: `https://www.imdb.com/name/${ids.Imdb}` }]
        : []),
      ...(ids.Tmdb
        ? [
            {
              Name: 'TMDB',
              Url: `https://www.themoviedb.org/person/${ids.Tmdb}`,
            },
          ]
        : []),
    ],
  };
  // The kinds of work the page can filter by, and the one to start on.
  const summary = creditSummary(found);
  if (summary.credits.length)
    out.aiostreams = {
      ...(item.aiostreams as object | undefined),
      ...summary,
    };
  const tags = item.ImageTags as Record<string, string> | undefined;
  if (details.photo && !tags?.Primary) {
    rememberImages(item.Id, { Primary: details.photo });
    out.ImageTags = imageTagsFor({ Primary: details.photo }).ImageTags;
    out.PrimaryImageAspectRatio = 0.6666;
  }
  return out;
}

function kindOf(type: string): FilmographyKind {
  return type === 'movie' ? 'movie' : 'series';
}

/** What a person worked on, without guest spots and honorary credits; with `types`, only that kind of work. */
export function tmdbCredits(
  person: TMDBPerson,
  kinds?: FilmographyKind[],
  types?: string[]
): TMDBPersonCredit[] {
  return person.credits
    .filter((credit) => {
      if (kinds && !kinds.includes(kindOf(credit.mediaType))) return false;
      if (credit.genreIds.some((g) => TALK_AND_NEWS.has(g))) return false;
      if (
        credit.roles.length &&
        credit.roles.every((r) => HONORARY_JOBS.has(r))
      )
        return false;
      return (
        !types?.length ||
        creditedParts(credit).some((part) => types.includes(part.type))
      );
    })
    .sort((a, b) => b.popularity - a.popularity);
}

/** The person's kinds of work with their titles counted, most first, and the one TMDB knows them for. */
export function creditSummary(found: FoundPerson): {
  credits: CreditCount[];
  knownFor?: string;
} {
  if ('meta' in found) return { credits: [] };
  const counts = new Map<string, CreditCount>();
  for (const credit of tmdbCredits(found.person)) {
    const series = kindOf(credit.mediaType) === 'series';
    for (const type of new Set(creditedParts(credit).map((p) => p.type))) {
      const count = counts.get(type) ?? { type, movies: 0, series: 0 };
      if (series) count.series++;
      else count.movies++;
      counts.set(type, count);
    }
  }
  const department = found.person.department;
  return {
    credits: [...counts.values()].sort(
      (a, b) => b.movies + b.series - (a.movies + a.series)
    ),
    ...(department && { knownFor: knownKind(department) }),
  };
}

/** Jellyfin's sort keys a credit can answer; anything else keeps the given order. */
function sortCredits<T>(
  credits: T[],
  fields: (credit: T) => { date?: string; name: string },
  q: FilmographyQuery
): T[] {
  const key = q.sortBy[0]?.toLowerCase();
  if (!key || key === 'premieredate' || key === 'productionyear') {
    // Announced titles without a date go last either way.
    const dated = credits
      .filter((c) => fields(c).date)
      .sort((a, b) => fields(a).date!.localeCompare(fields(b).date!));
    if (q.descending ?? true) dated.reverse();
    return [...dated, ...credits.filter((c) => !fields(c).date)];
  }
  if (key === 'sortname' || key === 'name') {
    const out = [...credits].sort((a, b) =>
      fields(a).name.localeCompare(fields(b).name)
    );
    return q.descending ? out.reverse() : out;
  }
  return credits;
}

export async function filmographyPage(
  engine: AIOStreams,
  found: FoundPerson,
  q: FilmographyQuery
): Promise<{
  previews: MetaPreview[];
  total: number;
  /** Beside each preview, what the person did on it, where that's known. */
  parts?: CreditedPart[][];
}> {
  const end = q.startIndex + q.limit;
  if ('meta' in found) {
    const credits = (found.meta.credits ?? []) as MetaPreview[];
    const sorted = sortCredits(
      q.kinds
        ? credits.filter((c) => q.kinds!.includes(kindOf(c.type)))
        : credits,
      (c) => ({
        date:
          toIso(c.released) ?? String(c.releaseInfo ?? '').match(/\d{4}/)?.[0],
        name: String(c.name ?? ''),
      }),
      q
    );
    return { previews: sorted.slice(q.startIndex, end), total: sorted.length };
  }
  const sorted = sortCredits(
    tmdbCredits(found.person, q.kinds, q.personTypes),
    (c) => ({ date: c.date, name: c.title }),
    q
  );
  const page = sorted.slice(q.startIndex, end);
  const previews = await titlePreviewsInOrder(engine, found.tmdb, page);
  const kept = page.flatMap((credit, i) => {
    const preview = previews[i];
    if (!preview) return [];
    return [{ preview, parts: creditedParts(credit) }];
  });
  return {
    previews: kept.map((k) => k.preview),
    total: sorted.length,
    parts: kept.map((k) => k.parts),
  };
}
