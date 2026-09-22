import type { UserData } from '../db/schemas.js';
import { createLogger } from '../logging/logger.js';
import type {
  TMDBMetadata,
  TMDBPerson,
  TMDBPersonCredit,
} from '../metadata/tmdb.js';
import { imageTagsFor, rememberImages } from './images.js';
import { isoDate, TMDB_IMAGES, tmdbFor } from './tmdb-titles.js';
import type { JellyfinItem } from './types.js';

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

export interface FoundPerson {
  tmdb: TMDBMetadata;
  person: TMDBPerson;
}

/** The TMDB person a name means, when a key is set and anyone matches. */
export async function findPerson(
  userData: UserData,
  name: string
): Promise<FoundPerson | null> {
  const tmdb = tmdbFor(userData);
  if (!tmdb) return null;
  try {
    const id = await tmdb.findPersonId(name);
    const person = id ? await tmdb.getPerson(id) : undefined;
    return person ? { tmdb, person } : null;
  } catch (error) {
    logger.debug(
      { name, err: error instanceof Error ? error.message : String(error) },
      'person lookup failed'
    );
    return null;
  }
}

export function withPersonDetails(
  item: JellyfinItem,
  person: TMDBPerson
): JellyfinItem {
  const out: JellyfinItem = {
    ...item,
    Overview: person.biography ?? item.Overview,
    PremiereDate: isoDate(person.birthday),
    EndDate: isoDate(person.deathday),
    ProductionLocations: person.placeOfBirth ? [person.placeOfBirth] : [],
    ProviderIds: {
      Tmdb: String(person.tmdbId),
      ...(person.imdbId && { Imdb: person.imdbId }),
    },
    ExternalUrls: [
      ...(person.imdbId
        ? [
            {
              Name: 'IMDb',
              Url: `https://www.imdb.com/name/${person.imdbId}`,
            },
          ]
        : []),
      {
        Name: 'TMDB',
        Url: `https://www.themoviedb.org/person/${person.tmdbId}`,
      },
    ],
  };
  const tags = item.ImageTags as Record<string, string> | undefined;
  if (person.profilePath && !tags?.Primary) {
    const photo = `${TMDB_IMAGES}w500${person.profilePath}`;
    rememberImages(item.Id, { Primary: photo });
    out.ImageTags = imageTagsFor({ Primary: photo }).ImageTags;
    out.PrimaryImageAspectRatio = 0.6666;
  }
  return out;
}

function kindOf(credit: TMDBPersonCredit): FilmographyKind {
  return credit.mediaType === 'movie' ? 'movie' : 'series';
}

/** What a person worked on, without guest spots and honorary credits. */
export function filmographyCredits(
  person: TMDBPerson,
  kinds?: FilmographyKind[]
): TMDBPersonCredit[] {
  return person.credits.filter((credit) => {
    if (kinds && !kinds.includes(kindOf(credit))) return false;
    if (credit.genreIds.some((g) => TALK_AND_NEWS.has(g))) return false;
    return (
      !credit.roles.length || credit.roles.some((r) => !HONORARY_JOBS.has(r))
    );
  });
}

/**
 * Jellyfin's sort keys a credit can answer; anything else keeps TMDB's order.
 */
export function sortCredits(
  credits: TMDBPersonCredit[],
  sortBy: string[],
  descending: boolean | undefined
): TMDBPersonCredit[] {
  const key = sortBy[0]?.toLowerCase();
  const byName = (a: TMDBPersonCredit, b: TMDBPersonCredit) =>
    a.title.localeCompare(b.title);
  if (!key || key === 'premieredate' || key === 'productionyear') {
    // Announced titles without a date go last either way.
    const dated = credits
      .filter((c) => c.date)
      .sort((a, b) => a.date!.localeCompare(b.date!));
    if (descending ?? true) dated.reverse();
    return [...dated, ...credits.filter((c) => !c.date)];
  }
  const out = [...credits];
  if (key === 'sortname' || key === 'name') {
    out.sort(byName);
    if (descending) out.reverse();
  } else {
    out.sort((a, b) => b.popularity - a.popularity);
  }
  return out;
}
