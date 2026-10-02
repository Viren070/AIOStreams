import { cn } from '@aiostreams/ui/core/styling';
import { inputLabels } from '../lib/input';

/** An input as the keys to press: `Shift+N` is two. */
export function KeyCaps({
  input,
  className,
}: {
  input: string;
  className?: string;
}) {
  return (
    <span
      data-ui="key-caps"
      className={cn('inline-flex items-center gap-1', className)}
    >
      {inputLabels(input).map((label, i) => (
        <kbd
          key={i}
          className="inline-flex h-6 min-w-6 items-center justify-center whitespace-nowrap rounded-md border border-white/15 bg-white/[0.06] px-1.5 font-sans text-xs font-medium text-gray-200"
        >
          {label}
        </kbd>
      ))}
    </span>
  );
}
