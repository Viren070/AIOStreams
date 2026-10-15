import { useQuery } from '@tanstack/react-query';
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
import { ON_DEVICE } from './common';

const CACHE_LABELS: Record<CacheCategory, { label: string; help: string }> = {
  home: {
    label: 'Home and libraries',
    help: 'Rows, catalogs and the calendar.',
  },
  titles: {
    label: 'Title pages',
    help: 'Details, seasons and episodes of what you open.',
  },
  history: { label: 'Activity', help: 'Your watch history and totals.' },
  search: { label: 'Searches', help: 'Results of what you searched for.' },
  artwork: {
    label: 'Artwork',
    help: 'Posters, backdrops, logos and photos.',
  },
  account: {
    label: 'Account and server',
    help: 'Who you are signed in as and the server’s details, which opening without a connection needs.',
  },
};

const MAX_STALE_LABELS: Record<number, string> = {
  1: 'A day',
  3: 'Three days',
  7: 'A week',
  14: 'Two weeks',
  30: 'A month',
  0: 'No limit',
};

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
  const { label, help } = CACHE_LABELS[category];
  const clear = () => void clearCategory(category).then(onCleared);
  return (
    <SettingsRow
      label={label}
      help={size ? `${help} ${formatBytes(size)}.` : help}
    >
      <div className="flex items-center gap-3">
        <Button
          intent="gray-outline"
          size="sm"
          className="rounded-full"
          disabled={!size}
          onClick={clear}
        >
          Clear
        </Button>
        <Switch
          aria-label={`Save ${label.toLowerCase()}`}
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

  return (
    <>
      <SettingsCard description={ON_DEVICE}>
        <Switch
          side="right"
          label="Save what you browse"
          help="Pages and artwork open straight away from this device, then refresh. Without a connection, whatever was saved can still be browsed."
          value={enabled}
          onValueChange={(next) => {
            setEnabled(next);
            if (!next) void clearCache().then(refresh);
          }}
        />
        {enabled && (
          <Select
            label="Show saved pages for up to"
            help="Older ones wait for the server instead. Without a connection, everything saved is shown."
            options={CACHE_MAX_STALE_DAYS.map((days) => ({
              value: String(days),
              label: MAX_STALE_LABELS[days],
            }))}
            value={String(maxStale)}
            onValueChange={(value) => setMaxStale(Number(value))}
          />
        )}
        {enabled && (
          <Select
            label="Space to use"
            help={`${total === undefined ? '' : `${formatBytes(total)} used. `}Past this, what was used longest ago goes first.`}
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
          title="What to save"
          description="Turning one off also clears it."
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
            label="Clear everything"
            help="Pages load from the server again until they are saved anew."
          >
            <Button
              intent="gray-outline"
              className="w-full rounded-full sm:w-auto"
              disabled={!total}
              onClick={() => void clearCache().then(refresh)}
            >
              Clear
            </Button>
          </SettingsRow>
        </SettingsCard>
      )}
    </>
  );
}
