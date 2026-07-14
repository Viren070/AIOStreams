import React from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { z } from 'zod';
import { toast } from 'sonner';
import { BiCog } from 'react-icons/bi';
import { useFormContext, useWatch, type UseFormReturn } from 'react-hook-form';
import { Form } from '@/components/ui/form';
import { Card } from '@/components/ui/card';
import { DashboardLoading } from '@/components/shared/dashboard-query-boundary';
import {
  SettingsCard,
  SettingsPageHeader,
} from '../settings/_components/settings-card';
import { SettingsField, toName } from '../settings/_components/settings-field';
import {
  SettingsSubmitButton,
  SettingsIsDirty,
} from '../settings/_components/settings-submit-button';
import type { SettingsKey } from '../settings/queries';
import { SettingsActionsMenu } from '../settings/_components/settings-actions-menu';
import MarkdownLite from '@/components/shared/markdown-lite';
import { useScrollToField } from '@/components/shared/command-palette/use-scroll-to-field';
import {
  useUsenetSettings,
  useSaveUsenetSettings,
  USENET_SETTINGS_QUERY_KEY,
  type UsenetProfiles,
} from './queries';

/** Config leaves a performance profile bundles (must match core PERFORMANCE_PROFILES). */
const BUNDLED_LEAVES = [
  'prefetchSegments',
  'maxConcurrentDownloads',
  'segmentDiskCacheBytes',
] as const;
const PROFILE_LEAF = 'performanceProfile';

const usenetKey = (leaf: string) => `usenet.${leaf}`;

/** Scope for the settings actions menu: every usenet engine key except the
 *  provider accounts (managed in their own editor). Mirrors the backend's
 *  `isManagedUsenetKey` so reset/import/export can never touch providers. */
const USENET_SCOPE = {
  includes: (key: string) =>
    key.startsWith('usenet.') && key !== 'usenet.providers',
  fileStem: 'aiostreams-usenet-settings',
  noun: 'usenet',
} as const;

/**
 * Curated section layout for the usenet engine settings. Keys are grouped by
 * leaf name (the part after `usenet.`); anything unmapped falls into "Other" so
 * a newly-added field is never silently dropped.
 */
const SECTIONS: { title: string; leaves: string[]; note?: string }[] = [
  {
    title: 'Performance',
    leaves: [PROFILE_LEAF, ...BUNDLED_LEAVES],
    note: 'Pick a profile and the values below are filled in for you — that is all most setups need. Editing any of the values switches the profile to **custom**.',
  },
  {
    title: 'Connections & timeouts',
    leaves: [
      'streamingPriority',
      'segmentTimeout',
      'dialTimeout',
      'idleConnection',
      'streamIdleTimeout',
    ],
  },
  {
    title: 'Reliability',
    leaves: ['circuitBreakerThreshold', 'circuitBreakerCooldown'],
  },
  {
    title: 'Archive handling',
    leaves: ['lazyRarResolution', 'strictArchiveMembership'],
  },
  {
    title: 'Verification',
    leaves: [
      'verifyMode',
      'verifyBudgetMs',
      'damagePolicy',
      'censusShadowConcurrency',
      'censusMaxLifetime',
    ],
    note:
      'When something is imported, AIOStreams checks that it can actually be downloaded from your providers — so broken or incomplete releases are caught up front instead of failing mid-playback. ' +
      'The checks run alongside the import, so they normally add no waiting time: badly damaged releases are rejected, slightly damaged ones can still play (the damage policy below decides), and any checking that did not finish during the import simply continues in the background. ' +
      'Providers that give unreliable answers are detected and ignored automatically.',
  },
  {
    title: 'Import & API',
    leaves: ['maxNzbSize', 'maxConcurrentInspects', 'sabnzbdApiEnabled'],
  },
];

const leafOf = (key: string) => key.replace(/^usenet\./, '');

function groupKeys(
  keys: SettingsKey[]
): { title: string; note?: string; keys: SettingsKey[] }[] {
  const byLeaf = new Map(keys.map((k) => [leafOf(k.key), k]));
  const used = new Set<string>();
  const groups = SECTIONS.map((s) => {
    const sectionKeys = s.leaves
      .map((leaf) => {
        const k = byLeaf.get(leaf);
        if (k) used.add(leaf);
        return k;
      })
      .filter((k): k is SettingsKey => !!k);
    return { title: s.title, note: s.note, keys: sectionKeys };
  }).filter((g) => g.keys.length > 0);

  const leftover = keys.filter((k) => !used.has(leafOf(k.key)));
  if (leftover.length)
    groups.push({ title: 'Other', note: undefined, keys: leftover });
  return groups;
}

/**
 * Two-way link between the performance profile and its bundled fields:
 *  - selecting a profile fills the four fields with that profile's values
 *    (silently on first mount, so the form shows what's actually in effect);
 *  - editing any bundled field switches the profile to "custom".
 * Renders nothing — it just drives form state via the surrounding <Form>.
 */
function ProfileLinker({ profiles }: { profiles: UsenetProfiles }) {
  const { setValue, getValues } = useFormContext();
  const profileName = toName(usenetKey(PROFILE_LEAF));
  // BUNDLED_LEAVES is a fixed-length tuple, so the per-field watches below are a
  // stable, rules-of-hooks-safe set (one useWatch each, primitive deps).
  const names = BUNDLED_LEAVES.map((leaf) => toName(usenetKey(leaf)));

  const profile = useWatch({ name: profileName }) as string | undefined;
  const b0 = useWatch({ name: names[0] });
  const b1 = useWatch({ name: names[1] });
  const b2 = useWatch({ name: names[2] });
  const b3 = useWatch({ name: names[3] });

  const applyingRef = React.useRef(false);

  // When the profile changes to a preset, fill the bundled fields with its
  // values. Skips when already in sync (e.g. on mount, since defaults are
  // seeded from the active profile) so it never dirties the form spuriously.
  React.useEffect(() => {
    const preset =
      profile && profile !== 'custom' ? profiles[profile] : undefined;
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
  }, [profile]);

  // Editing a bundled field while a profile is active flips it to "custom".
  React.useEffect(() => {
    if (applyingRef.current) return;
    const preset =
      profile && profile !== 'custom' ? profiles[profile] : undefined;
    if (!preset) return;
    const current = [b0, b1, b2, b3];
    const matches = BUNDLED_LEAVES.every(
      (leaf, i) => Number(current[i]) === preset[leaf]
    );
    if (!matches) setValue(profileName, 'custom', { shouldDirty: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b0, b1, b2, b3]);

  return null;
}

export function UsenetSettingsPage() {
  const query = useUsenetSettings();
  const { mutateAsync, isPending } = useSaveUsenetSettings();
  const methodsRef = React.useRef<UseFormReturn<any> | null>(null);
  const search = useSearch({ from: '/dashboard/usenet/settings' });
  const navigate = useNavigate({ from: '/dashboard/usenet/settings' });

  const clearField = React.useCallback(() => {
    navigate({
      to: '.',
      search: (prev) => ({ ...prev, field: undefined }),
      replace: true,
      resetScroll: false,
    });
  }, [navigate]);

  // Must run before the early-return guards below, to satisfy the rules of
  // hooks. The fields only exist once the settings payload has arrived.
  useScrollToField(search.field, Boolean(query.data), clearField);

  const keys = query.data?.keys ?? [];
  const profiles = query.data?.profiles ?? {};

  const { schema, defaults, byName } = React.useMemo(() => {
    const shape: Record<string, z.ZodTypeAny> = {};
    const defaults: Record<string, unknown> = {};
    const byName = new Map<string, SettingsKey>();
    for (const k of keys) {
      const n = toName(k.key);
      shape[n] = z.any();
      defaults[n] = k.value === null && k.ui.kind === 'enum' ? '' : k.value;
      byName.set(n, k);
    }
    // When a non-custom profile is active, the engine derives the bundled values
    // from it — so seed the form with the PROFILE's values (not the stored
    // shadows) so the page shows what's actually in effect, without dirtying.
    const activeProfile = keys.find((k) => leafOf(k.key) === PROFILE_LEAF)
      ?.value as string | undefined;
    const preset =
      activeProfile && activeProfile !== 'custom'
        ? profiles[activeProfile]
        : undefined;
    if (preset) {
      for (const leaf of BUNDLED_LEAVES) {
        const n = toName(usenetKey(leaf));
        if (n in defaults) defaults[n] = preset[leaf];
      }
    }
    return { schema: z.object(shape), defaults, byName };
  }, [keys, profiles]);

  if (query.isLoading) return <DashboardLoading />;
  if (query.isError) {
    return (
      <Card className="p-6 text-sm text-red-500">
        Failed to load usenet settings.
      </Card>
    );
  }

  const groups = groupKeys(keys);
  const bundledNames = new Set(BUNDLED_LEAVES.map((l) => toName(usenetKey(l))));
  const profileNameKey = toName(usenetKey(PROFILE_LEAF));

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <SettingsPageHeader
          title="Settings"
          description="Configuration for the built-in usenet engine"
          icon={BiCog}
        />
        <div className="pt-1">
          <SettingsActionsMenu
            sectionKeys={keys}
            sectionLabel="Usenet"
            invalidate={[USENET_SETTINGS_QUERY_KEY]}
            scope={USENET_SCOPE}
          />
        </div>
      </div>
      <Form
        // Re-key on the loaded values so a refetch after save re-seeds defaults.
        key={keys.map((k) => `${k.key}:${String(k.value)}`).join('|')}
        schema={schema}
        defaultValues={defaults}
        stackClass="space-y-4 relative"
        onSubmit={async (data: Record<string, unknown>) => {
          const profileActive = data[profileNameKey] !== 'custom';
          const patch: Record<string, unknown> = {};
          for (const [n, val] of Object.entries(data)) {
            const k = byName.get(n);
            if (!k || k.source === 'environment') continue;
            if (profileActive && bundledNames.has(n)) continue;
            const isNullable = k.value === null || k.default === null;
            const normalised = isNullable && val === '' ? null : val;
            if (JSON.stringify(normalised) !== JSON.stringify(k.value)) {
              patch[k.key] = normalised;
            }
          }
          if (Object.keys(patch).length === 0) {
            toast.info('No changes to save.');
            methodsRef.current?.reset(data, { keepValues: true });
            return;
          }
          try {
            const res = await mutateAsync(patch);
            toast.success(
              `Saved ${res.updated.length} setting${res.updated.length === 1 ? '' : 's'}.`
            );
            methodsRef.current?.reset(data, { keepValues: true });
            if (res.requiresRestart)
              toast.warning('Some changes require a restart to take effect.', {
                duration: 8000,
              });
          } catch (e: any) {
            const issues = e?.issues as Record<string, string> | undefined;
            if (issues)
              for (const [key, msg] of Object.entries(issues))
                toast.error(`${key}: ${msg}`);
            else toast.error(e?.message ?? 'Failed to save settings');
          }
        }}
      >
        {(methods) => {
          methodsRef.current = methods;
          return (
            <>
              <ProfileLinker profiles={profiles} />
              {groups.map((g) => (
                <SettingsCard key={g.title} title={g.title}>
                  {g.note && (
                    <p className="text-xs text-[--muted] -mt-1 mb-1">
                      <MarkdownLite>{g.note}</MarkdownLite>
                    </p>
                  )}
                  {g.keys.map((k) => (
                    <div key={k.key} id={`setting-${k.key}`}>
                      <SettingsField k={k} />
                    </div>
                  ))}
                </SettingsCard>
              ))}
              <div className="flex justify-end">
                <SettingsSubmitButton isPending={isPending} />
              </div>
              <SettingsIsDirty isPending={isPending} />
            </>
          );
        }}
      </Form>
    </div>
  );
}
