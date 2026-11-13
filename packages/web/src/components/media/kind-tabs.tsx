import { t } from '@lingui/core/macro';
import { PillTabs } from '@/components/pill-tabs';
import { useSearchParam } from '@/hooks/use-search-param';

export const KINDS = [
  {
    types: 'Movie,Series',
    get label() {
      return t`All`;
    },
  },
  {
    types: 'Movie',
    get label() {
      return t`Movies`;
    },
  },
  {
    types: 'Series',
    get label() {
      return t`Shows`;
    },
  },
];

export function useKindParam(): [string, (types: string) => void] {
  const [param, setParam] = useSearchParam('kind');
  const types = KINDS.find((k) => k.types === param)?.types ?? KINDS[0].types;
  return [
    types,
    (next) => setParam(next === KINDS[0].types ? undefined : next),
  ];
}

export function KindTabs({
  types,
  onChange,
}: {
  types: string;
  onChange: (types: string) => void;
}) {
  return (
    <PillTabs
      name="kind"
      options={KINDS.map((k) => ({ value: k.types, label: k.label }))}
      value={types}
      onChange={onChange}
    />
  );
}
