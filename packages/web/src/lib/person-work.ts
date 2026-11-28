import type { BaseItemDto } from '@/lib/jellyfin/types';

/** How many titles of a kind of work the server counted, by movies and shows. */
export interface CreditCount {
  type: string;
  movies: number;
  series: number;
}

/** The person's kinds of work with their counts, and the kind TMDB knows them for. */
export function creditsOf(person: BaseItemDto | undefined): {
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

/** Crew kinds a title page names that a person's page counts under another. */
// eslint-disable-next-line lingui/no-unlocalized-strings -- Jellyfin's person kinds
const SAME_WORK: Record<string, string> = {
  Creator: 'Writer',
  GuestStar: 'Actor',
};
/** Every kind of work, the filters all off. */
export const ALL_WORK = 'all';

/**
 * The kinds of work a person's page shows for its `role` address part: the
 * one a link asked for, else the one TMDB knows them for, else their most.
 */
export function workShown(
  person: BaseItemDto | undefined,
  param: string | undefined
): { shown: string[]; fallback?: string } {
  const { credits, knownFor } = creditsOf(person);
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
  return { shown, fallback };
}
