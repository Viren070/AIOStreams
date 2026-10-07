import { PillTabs } from './pill-tabs';

export const KINDS = [
  { label: 'All', types: 'Movie,Series' },
  { label: 'Movies', types: 'Movie' },
  { label: 'Shows', types: 'Series' },
];

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
