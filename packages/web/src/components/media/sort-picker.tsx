import { t } from '@lingui/core/macro';
import { LuArrowDownWideNarrow, LuArrowUpNarrowWide } from 'react-icons/lu';
import { IconButton } from '@aiostreams/ui/button';
import { Select } from '@aiostreams/ui/select';
import { useSearchParam } from '@/hooks/use-search-param';

/* eslint-disable lingui/no-unlocalized-strings -- Jellyfin's sort names */
export const SORTS = {
  name: 'SortName',
  added: 'DateCreated,SortName',
  released: 'PremiereDate,ProductionYear,SortName',
  rating: 'CommunityRating,SortName',
  runtime: 'Runtime,SortName',
} as const;
/* eslint-enable lingui/no-unlocalized-strings */

export type SortKey = keyof typeof SORTS;

export interface Sort {
  key: SortKey;
  descending: boolean;
}

const label = (key: SortKey) =>
  ({
    name: t`Name`,
    added: t`Date added`,
    released: t`Release date`,
    rating: t`Rating`,
    runtime: t`Runtime`,
  })[key];

/** Names start from A; the rest from the newest, best or longest. */
export const sortFor = (key: SortKey): Sort => ({
  key,
  descending: key !== 'name',
});

export function useSortParam(
  keys: SortKey[],
  fallback: SortKey
): [Sort, (next: Sort) => void] {
  const [param, setParam] = useSearchParam('sort');
  const [name, way] = (param ?? '').split('-');
  const key = keys.find((k) => k === name) ?? fallback;
  const sort =
    way === 'asc' || way === 'desc'
      ? { key, descending: way === 'desc' }
      : sortFor(key);
  const set = (next: Sort) => {
    const turned = next.descending !== sortFor(next.key).descending;
    const value = turned
      ? `${next.key}-${next.descending ? 'desc' : 'asc'}`
      : next.key;
    setParam(value === fallback ? undefined : value);
  };
  return [sort, set];
}

export function SortPicker({
  keys,
  value,
  onChange,
}: {
  keys: SortKey[];
  value: Sort;
  onChange(next: Sort): void;
}) {
  return (
    <div data-ui="sort-picker" className="flex items-center gap-1">
      <div className="w-40">
        <Select
          aria-label={t`Sort by`}
          className="rounded-full"
          options={keys.map((key) => ({ value: key, label: label(key) }))}
          value={value.key}
          onValueChange={(next) => next && onChange(sortFor(next as SortKey))}
        />
      </div>
      <IconButton
        data-name="sort-order"
        size="sm"
        intent="gray-subtle"
        className="rounded-full"
        icon={
          value.descending ? <LuArrowDownWideNarrow /> : <LuArrowUpNarrowWide />
        }
        aria-label={value.descending ? t`Descending` : t`Ascending`}
        onClick={() => onChange({ ...value, descending: !value.descending })}
      />
    </div>
  );
}
