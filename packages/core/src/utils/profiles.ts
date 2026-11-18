import type { Profile, UserData } from '../db/schemas.js';

/** Stored rows are keyed by it, so it never changes. */
export const OWNER_ID = '';

type WithProfiles = Pick<UserData, 'profiles'>;

export function isOwner(profile: Pick<Profile, 'id'>): boolean {
  return profile.id === OWNER_ID;
}

/** Kept apart from the other profiles. A hidden owner is only off the picker. */
export function isSeparate(profile: Profile): boolean {
  return !isOwner(profile) && !!profile.hidden;
}

/** The owner first, even when none is stored. */
export function profilesOf(userData: WithProfiles): Profile[] {
  const profiles = userData.profiles ?? [];
  const owner = profiles.find(isOwner) ?? { id: OWNER_ID };
  return [owner, ...profiles.filter((p) => !isOwner(p))];
}

export function ownerOf(userData: WithProfiles): Profile {
  return profilesOf(userData)[0];
}

export function profileById(
  userData: WithProfiles,
  id: string
): Profile | null {
  return profilesOf(userData).find((p) => p.id === id) ?? null;
}

export function migrateProfiles(config: any): void {
  const jellyfin = config?.jellyfin;
  if (!jellyfin || (!jellyfin.primary && !jellyfin.personas)) return;
  const { primary, personas, ...rest } = jellyfin;
  config.jellyfin = rest;
  if (config.profiles) return;
  config.profiles = [
    { ...primary, id: OWNER_ID },
    ...(Array.isArray(personas) ? personas : []),
  ];
}
