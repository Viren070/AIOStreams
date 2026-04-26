import { FiLink } from 'react-icons/fi';
import { Tooltip } from '@/components/ui/tooltip';

type Props = {
  section: 'presets' | 'services' | 'filters' | 'sorting' | 'formatter' | 'proxy' | 'metadata' | 'misc';
};

export function InheritedBadge({ section }: Props) {
  return (
    <Tooltip
      trigger={
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-brand-500/10 text-[--brand] border border-brand-500/20 cursor-default select-none">
          <FiLink className="w-3 h-3" />
          Inherited
        </span>
      }
    >
      This section is inherited from your parent config. Change the merge
      strategy in Miscellaneous → Parent Config to override it.
    </Tooltip>
  );
}
