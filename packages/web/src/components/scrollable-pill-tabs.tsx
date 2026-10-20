import { Button } from '@aiostreams/ui/button';
import { cn } from '@aiostreams/ui/core/styling';

/** A scrollable row of pills picking one option; `name` tells rows apart for custom CSS. */
export function ScrollablePillTabs<T>({
  name,
  options,
  value,
  onChange,
}: {
  name: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div
      data-ui="pill-tabs"
      data-name={name}
      className="flex min-w-0 max-w-full items-center gap-1 overflow-x-auto rounded-full bg-gray-900 p-1 touch-pan-x [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
            className="rounded-full shrink-0 whitespace-nowrap"
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </Button>
        );
      })}
    </div>
  );
}
