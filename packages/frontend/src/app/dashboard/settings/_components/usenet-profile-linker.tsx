import React from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { toName } from './settings-field';
import { useUsenetPerformanceProfiles } from '../../usenet/queries';

/** Config leaves a performance profile bundles (must match core PERFORMANCE_PROFILES). */
const BUNDLED_LEAVES = [
  'prefetchSegments',
  'maxConcurrentDownloads',
  'segmentDiskCacheBytes',
] as const;
const PROFILE_KEY = 'usenet.performanceProfile';

/**
 * Two-way link between the usenet performance profile and its bundled fields:
 *  - selecting a profile fills those fields with that profile's values
 *    (silently when already in sync, so it never dirties the form on mount);
 *  - editing any bundled field switches the profile to "custom".
 * Renders nothing; it just drives the surrounding settings form.
 */
export function UsenetProfileLinker() {
  const { setValue, getValues } = useFormContext();
  const profiles = useUsenetPerformanceProfiles().data?.profiles;
  const profileName = toName(PROFILE_KEY);
  // A fixed-length tuple, so these watches are a stable, hooks-safe set.
  const names = BUNDLED_LEAVES.map((leaf) => toName(`usenet.${leaf}`));

  const profile = useWatch({ name: profileName }) as string | undefined;
  const b0 = useWatch({ name: names[0] });
  const b1 = useWatch({ name: names[1] });
  const b2 = useWatch({ name: names[2] });

  const applyingRef = React.useRef(false);

  React.useEffect(() => {
    const preset =
      profiles && profile && profile !== 'custom'
        ? profiles[profile]
        : undefined;
    if (!preset) return;
    const synced = BUNDLED_LEAVES.every(
      (leaf, i) => Number(getValues(names[i])) === preset[leaf]
    );
    if (synced) return;
    applyingRef.current = true;
    BUNDLED_LEAVES.forEach((leaf, i) =>
      setValue(names[i], preset[leaf], { shouldDirty: true })
    );
    const t = setTimeout(() => {
      applyingRef.current = false;
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, profiles]);

  React.useEffect(() => {
    if (applyingRef.current) return;
    const preset =
      profiles && profile && profile !== 'custom'
        ? profiles[profile]
        : undefined;
    if (!preset) return;
    const current = [b0, b1, b2];
    const matches = BUNDLED_LEAVES.every(
      (leaf, i) => Number(current[i]) === preset[leaf]
    );
    if (!matches) setValue(profileName, 'custom', { shouldDirty: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b0, b1, b2]);

  return null;
}
