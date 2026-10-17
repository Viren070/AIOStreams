import { t } from '@lingui/core/macro';
import { PillTabs } from './pill-tabs';

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
