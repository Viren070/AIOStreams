import { Button } from '@aiostreams/ui/button';
import { cn } from '@aiostreams/ui/core/styling';
import { tab, tabList } from '@/lib/input';

const PILL_LIMIT = 12;
const PILL_CHARACTERS = 120;

/** A few short options read as pills; a long list wants a searchable picker. */
export const fitsAsPills = (labels: string[]) =>
  labels.length <= PILL_LIMIT &&
  labels.reduce((n, label) => n + label.length, 0) <= PILL_CHARACTERS;

/** A row of pills picking one option; `name` tells rows apart for custom CSS. */
export function PillTabs<T>({
  name,
  options,
  value,
  onChange,
  className,
}: {
  name: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      data-ui="pill-tabs"
      data-name={name}
      {...tabList}
      className={cn(
        'flex w-fit max-w-full flex-none gap-1 overflow-x-auto rounded-full bg-gray-900 p-1 [scrollbar-width:none]',
        className
      )}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Button
            key={option.label}
            data-ui="pill-tab"
            data-selected={selected || undefined}
            size="xs"
            intent={selected ? 'white' : 'gray-basic'}
            className="rounded-full"
            {...tab(selected, () => onChange(option.value))}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </Button>
        );
      })}
    </div>
  );
}
