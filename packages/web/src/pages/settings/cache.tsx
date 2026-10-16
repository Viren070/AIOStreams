import { useQuery } from '@tanstack/react-query';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Select } from '@aiostreams/ui/select';
import { Switch } from '@aiostreams/ui/switch';
import { Button } from '@aiostreams/ui/button';
import { formatBytes } from '@aiostreams/ui/core/format';
import {
  settings,
  useSetting,
  CACHE_MAX_STALE_DAYS,
  CACHE_SIZES_MB,
} from '../../lib/settings';
import {
  CACHE_CATEGORIES,
  clearCache,
  clearCategory,
  pruneCache,
  usage as cacheUsage,
  type CacheCategory,
} from '../../lib/cache';
import { SettingsCard, SettingsRow } from '../../components/settings-card';
import { onDevice } from './common';

const cacheLabels = (
  category: CacheCategory
): { label: string; help: string; save: string } =>
  ({
    home: {
      label: t`Home and libraries`,
      help: t`Rows, catalogs and the calendar.`,
      save: t`Save home and libraries`,
    },
    titles: {
      label: t`Title pages`,
      help: t`Details, seasons and episodes of what you open.`,
      save: t`Save title pages`,
    },
    history: {
      label: t`Activity`,
      help: t`Your watch history and totals.`,
      save: t`Save activity`,
    },
    search: {
      label: t`Searches`,
      help: t`Results of what you searched for.`,
      save: t`Save searches`,
    },
    artwork: {
      label: t`Artwork`,
      help: t`Posters, backdrops, logos and photos.`,
      save: t`Save artwork`,
    },
    account: {
      label: t`Account and server`,
      help: t`Who you are signed in as and the server’s details, which opening without a connection needs.`,
      save: t`Save account and server`,
    },
  })[category];

const maxStaleLabel = (days: number) =>
  (
    ({
      1: t`A day`,
      3: t`Three days`,
      7: t`A week`,
      14: t`Two weeks`,
      30: t`A month`,
      0: t`No limit`,
    }) as Record<number, string>
  )[days];

function useCacheUsage() {
  return useQuery({ queryKey: ['cache-usage'], queryFn: cacheUsage });
}

function CacheCategoryRow({
  category,
  size,
  onCleared,
}: {
  category: CacheCategory;
  size: number | undefined;
  onCleared(): void;
}) {
  const [on, setOn] = useSetting(settings.cache.categories[category]);
  const { label, help, save } = cacheLabels(category);
  const clear = () => void clearCategory(category).then(onCleared);
  const bytes = size ? formatBytes(size) : '';
  return (
    <SettingsRow label={label} help={size ? t`${help} ${bytes}.` : help}>
      <div className="flex items-center gap-3">
        <Button
          intent="gray-outline"
          size="sm"
          className="rounded-full"
          disabled={!size}
          onClick={clear}
        >
          <Trans>Clear</Trans>
        </Button>
        <Switch
          aria-label={save}
          value={on}
          onValueChange={(next) => {
            setOn(next);
            if (!next) clear();
          }}
        />
      </div>
    </SettingsRow>
  );
}

export function CacheSection() {
  const [enabled, setEnabled] = useSetting(settings.cache.enabled);
  const [maxStale, setMaxStale] = useSetting(settings.cache.maxStaleDays);
  const [maxSize, setMaxSize] = useSetting(settings.cache.maxSizeMb);
  const usage = useCacheUsage();
  const refresh = () => void usage.refetch();
  const total = usage.data
    ? Object.values(usage.data).reduce((sum, n) => sum + n, 0)
    : undefined;
  const used = total === undefined ? '' : formatBytes(total);

  return (
    <>
      <SettingsCard description={onDevice()}>
        <Switch
          side="right"
          label={t`Save what you browse`}
          help={t`Pages and artwork open straight away from this device, then refresh. Without a connection, whatever was saved can still be browsed.`}
          value={enabled}
          onValueChange={(next) => {
            setEnabled(next);
            if (!next) void clearCache().then(refresh);
          }}
        />
        {enabled && (
          <Select
            label={t`Show saved pages for up to`}
            help={t`Older ones wait for the server instead. Without a connection, everything saved is shown.`}
            options={CACHE_MAX_STALE_DAYS.map((days) => ({
              value: String(days),
              label: maxStaleLabel(days),
            }))}
            value={String(maxStale)}
            onValueChange={(value) => setMaxStale(Number(value))}
          />
        )}
        {enabled && (
          <Select
            label={t`Space to use`}
            help={
              total === undefined
                ? t`Past this, what was used longest ago goes first.`
                : t`${used} used. Past this, what was used longest ago goes first.`
            }
            options={CACHE_SIZES_MB.map((mb) => ({
              value: String(mb),
              label: formatBytes(mb * 1_000_000),
            }))}
            value={String(maxSize)}
            onValueChange={(value) => {
              setMaxSize(Number(value));
              void pruneCache().then(refresh);
            }}
          />
        )}
      </SettingsCard>
      {enabled && (
        <SettingsCard
          name="what-to-save"
          title={t`What to save`}
          description={t`Turning one off also clears it.`}
        >
          {CACHE_CATEGORIES.map((category) => (
            <CacheCategoryRow
              key={category}
              category={category}
              size={usage.data?.[category]}
              onCleared={refresh}
            />
          ))}
        </SettingsCard>
      )}
      {enabled && (
        <SettingsCard>
          <SettingsRow
            label={t`Clear everything`}
            help={t`Pages load from the server again until they are saved anew.`}
          >
            <Button
              intent="gray-outline"
              className="w-full rounded-full sm:w-auto"
              disabled={!total}
              onClick={() => void clearCache().then(refresh)}
            >
              <Trans>Clear</Trans>
            </Button>
          </SettingsRow>
        </SettingsCard>
      )}
    </>
  );
}
