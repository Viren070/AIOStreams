import { useMemo } from 'react';
import { toast } from 'sonner';
import { useUserData } from '@/context/userData';
import { useStatus } from '@/context/status';
import { DEFAULT_CEL_WORK } from '../../../core/src/variants/language';
import {
  assignAudiences,
  compilePrograms,
  conditionalTouching,
  isOn,
  listAudiences,
  summarise,
  viewOf,
  type Audience,
  type Toggle,
  type View,
} from '@/lib/audiences';

export function useVariantWork(): number {
  const { status } = useStatus();
  return status?.settings.variants.maxWork ?? DEFAULT_CEL_WORK;
}

export interface Audiences {
  /** Whether there is anyone besides the base config to choose for. */
  available: boolean;
  audiences: Audience[];
  /** In the order of `audiences`. */
  views: View[];
  summary(toggle: Toggle): string | undefined;
  /** Per audience: on for every toggle, off for every one, or a mix. */
  states(toggles: Toggle[]): (boolean | 'indeterminate')[];
  assign(toggles: Toggle[], audience: string, on: boolean): void;
  /** Names of conditional variants that also change these toggles. */
  conditional(toggles: Toggle[]): string[];
}

export function useAudiences(): Audiences {
  const { userData, setUserData } = useUserData();
  const { status } = useStatus();
  const work = useVariantWork();
  const access = status?.settings.variants.access;
  const allowed =
    access !== 'none' && (access !== 'trusted' || !!userData.trusted);
  const jellyfinEnabled = status?.settings.jellyfin?.enabled ?? false;
  const {
    variants,
    jellyfin,
    addonName,
    presets,
    catalogModifications,
    mergedCatalogs,
  } = userData;

  const audiences = useMemo(
    () => listAudiences({ variants, jellyfin, addonName }, jellyfinEnabled),
    [variants, jellyfin, addonName, jellyfinEnabled]
  );
  const available =
    allowed && audiences.some((a) => a.kind === 'link' || !!a.userId);
  const programs = useMemo(() => compilePrograms(variants), [variants]);
  const source = useMemo<View>(
    () => ({ presets, catalogModifications, mergedCatalogs }),
    [presets, catalogModifications, mergedCatalogs]
  );
  const views = useMemo(
    () =>
      available
        ? audiences.map((a) => viewOf(source, a.chain, programs, work))
        : [],
    [available, audiences, source, programs, work]
  );

  return {
    available,
    audiences,
    views,
    summary: (toggle) =>
      available
        ? summarise(
            audiences,
            views.map((view) => isOn(view, toggle))
          )
        : undefined,
    states: (toggles) =>
      views.map((view) => {
        const on = toggles.map((t) => isOn(view, t) ?? false);
        return on.every(Boolean)
          ? true
          : on.some(Boolean)
            ? 'indeterminate'
            : false;
      }),
    assign: (toggles, audience, on) => {
      const result = assignAudiences(
        userData,
        audiences,
        toggles,
        new Map([[audience, on]]),
        work
      );
      if (result.userData !== userData) setUserData(() => result.userData);
      const [first, ...rest] = result.problems;
      if (first) {
        toast.warning(
          rest.length ? `${first} (and ${rest.length} more)` : first
        );
      }
    },
    conditional: (toggles) =>
      conditionalTouching(source, variants, programs, toggles, work),
  };
}
