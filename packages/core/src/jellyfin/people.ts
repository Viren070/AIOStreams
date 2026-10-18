import type { MetaPreview, ParsedMeta, UserData } from '../db/schemas.js';
import type { AIOStreams } from '../main/index.js';
import { createLogger } from '../logging/logger.js';
import type {
  TMDBMetadata,
  TMDBPerson,
  TMDBPersonCredit,
} from '../metadata/tmdb.js';
import { providerIdsFrom, toIso } from './enrichment.js';
import { imageTagsFor, rememberImages } from './images.js';
import { searchPersonCatalogs } from './library.js';
import { isoDate, TMDB_IMAGES, titlePreviews, tmdbFor } from './tmdb-titles.js';
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
  sortBy: string[];
  descending?: boolean;
  startIndex: number;
  limit: number;
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

/** What a person worked on, without guest spots and honorary credits. */
function tmdbCredits(
  person: TMDBPerson,
  kinds?: FilmographyKind[]
): TMDBPersonCredit[] {
  return person.credits
    .filter((credit) => {
      if (kinds && !kinds.includes(kindOf(credit.mediaType))) return false;
      if (credit.genreIds.some((g) => TALK_AND_NEWS.has(g))) return false;
      return (
        !credit.roles.length || credit.roles.some((r) => !HONORARY_JOBS.has(r))
      );
    })
    .sort((a, b) => b.popularity - a.popularity);
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
): Promise<{ previews: MetaPreview[]; total: number }> {
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
    tmdbCredits(found.person, q.kinds),
    (c) => ({ date: c.date, name: c.title }),
    q
  );
  return {
    previews: await titlePreviews(
      engine,
      found.tmdb,
      sorted.slice(q.startIndex, end)
    ),
    total: sorted.length,
  };
}
