import {
  AUDIO_TYPES,
  isOwner,
  JellyfinRepository,
  personaUserId,
  profilesOf,
  SUBTITLE_MODES,
  SUBTITLE_TYPES,
  type WatchScope,
} from '@aiostreams/core';
import { watchScopeOf, type JellyfinRequestContext } from './context.js';

/** The partition of everyone's defaults, which no profile id can take. */
const EVERYONE = '*';

const everyoneScope = (uuid: string): WatchScope => ({
  uuid,
  persona: EVERYONE,
});

export const everyoneUserId = (uuid: string) => personaUserId(uuid, EVERYONE);

/**
 * Whose preferences a request names, or null when the caller may not change
 * them. The owner may name any profile and everyone; anyone may read
 * everyone's, and any other id is the caller's own.
 */
export function prefsScope(
  ctx: JellyfinRequestContext,
  userId: string | undefined,
  write: boolean
): WatchScope | null {
  const wanted = userId?.replace(/-/g, '').toLowerCase();
  if (!wanted || wanted === ctx.userId) return ctx.watch;
  if (wanted === everyoneUserId(ctx.uuid)) {
    return write && !isOwner(ctx.profile) ? null : everyoneScope(ctx.uuid);
  }
  if (!isOwner(ctx.profile)) return ctx.watch;
  const profile = profilesOf(ctx.userData).find(
    (p) => personaUserId(ctx.uuid, p.id) === wanted
  );
  return profile ? watchScopeOf(ctx.uuid, profile) : ctx.watch;
}

export function userConfiguration() {
  return {
    AudioLanguagePreference: '',
    AudioLanguages: [] as string[],
    PlayDefaultAudioTrack: true,
    AudioTypes: [...AUDIO_TYPES] as string[],
    SubtitleLanguagePreference: '',
    SubtitleLanguages: [] as string[],
    SubtitleTypes: [...SUBTITLE_TYPES] as string[],
    ListPreferredSubtitlesOnly: true,
    DisplayMissingEpisodes: true,
    GroupedFolders: [],
    SubtitleMode: 'Default',
    DisplayCollectionsView: false,
    EnableLocalPassword: false,
    OrderedViews: [],
    LatestItemsExcludes: [],
    MyMediaExcludes: [],
    HidePlayedInLatest: true,
    RememberAudioSelections: true,
    RememberSubtitleSelections: true,
    EnableNextEpisodeAutoPlay: true,
    CastReceiverId: '',
  };
}

const isLanguage = (v: unknown) => typeof v === 'string' && v.length <= 16;
const isRanking = (all: readonly string[]) => (v: unknown) =>
  Array.isArray(v) &&
  v.length <= all.length &&
  new Set(v).size === v.length &&
  v.every((t) => all.includes(t));
const isLanguageList = (v: unknown) =>
  Array.isArray(v) && v.length <= 10 && v.every((l) => isLanguage(l) && l);

/** The playback preferences a user can set and this server keeps. */
const USER_PREFERENCES: Record<string, (value: unknown) => boolean> = {
  AudioLanguagePreference: isLanguage,
  AudioLanguages: isLanguageList,
  SubtitleLanguagePreference: isLanguage,
  SubtitleLanguages: isLanguageList,
  SubtitleMode: (v) => SUBTITLE_MODES.some((mode) => mode === v),
  SubtitleTypes: isRanking(SUBTITLE_TYPES),
  AudioTypes: isRanking(AUDIO_TYPES),
  ListPreferredSubtitlesOnly: (v) => typeof v === 'boolean',
  PlayDefaultAudioTrack: (v) => typeof v === 'boolean',
  RememberAudioSelections: (v) => typeof v === 'boolean',
  RememberSubtitleSelections: (v) => typeof v === 'boolean',
  EnableNextEpisodeAutoPlay: (v) => typeof v === 'boolean',
};

function userPreferences(body: unknown): Record<string, unknown> {
  const source = body && typeof body === 'object' ? body : {};
  return Object.fromEntries(
    Object.entries(source).filter(([key, value]) =>
      USER_PREFERENCES[key]?.(value)
    )
  );
}

const LANGUAGE_LISTS = [
  ['AudioLanguagePreference', 'AudioLanguages'],
  ['SubtitleLanguagePreference', 'SubtitleLanguages'],
] as const;

/**
 * Keeps each single language the first of its list. A client that only knows
 * the single one may send back the list it read, so a single language that
 * isn't that list's first is its choice, and goes to the front.
 */
function withLanguageLists(
  config: Record<string, unknown>,
  sent: Record<string, unknown>
): Record<string, unknown> {
  for (const [single, list] of LANGUAGE_LISTS) {
    if (!(single in sent) && !(list in sent)) continue;
    const languages = (config[list] as string[] | undefined) ?? [];
    const one = config[single] as string;
    if (single in sent && one !== (languages[0] ?? ''))
      config[list] = one ? [one, ...languages.filter((l) => l !== one)] : [];
    config[single] = (config[list] as string[] | undefined)?.[0] ?? '';
  }
  return config;
}

async function layers(scope: WatchScope) {
  const [everyone, own] = await Promise.all([
    scope.persona === EVERYONE
      ? null
      : JellyfinRepository.getUserConfiguration(everyoneScope(scope.uuid)),
    JellyfinRepository.getUserConfiguration(scope),
  ]);
  return { everyone: userPreferences(everyone), own: userPreferences(own) };
}

/** The preferences a scope has set or inherits, without the defaults. */
export async function storedPreferences(
  scope: WatchScope
): Promise<Record<string, unknown>> {
  const { everyone, own } = await layers(scope);
  return { ...everyone, ...own };
}

export async function storedUserConfiguration(scope: WatchScope) {
  return { ...userConfiguration(), ...(await storedPreferences(scope)) };
}

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/** Keeps what differs from what the scope inherits, so a changed default still reaches it. */
export async function saveUserConfiguration(
  scope: WatchScope,
  body: unknown
): Promise<void> {
  const { everyone, own } = await layers(scope);
  const inherited: Record<string, unknown> = {
    ...userConfiguration(),
    ...everyone,
  };
  const sent = userPreferences(body);
  const next = withLanguageLists({ ...inherited, ...own, ...sent }, sent);
  await JellyfinRepository.setUserConfiguration(
    scope,
    Object.fromEntries(
      Object.entries(userPreferences(next)).filter(
        ([key, value]) => !same(value, inherited[key])
      )
    )
  );
}
