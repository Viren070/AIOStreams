import type { KeyboardEvent } from 'react';
import { cn } from '@aiostreams/ui/core/styling';

/** Ids linking a `ToggleGroup`'s tabs to the `tabpanel` they switch. */
export function tabIds(idPrefix: string, value: string) {
  return {
    tab: `${idPrefix}-tab-${value}`,
    panel: `${idPrefix}-panel`,
  };
}

export function ToggleGroup<T extends string>({
  options,
  value,
  onChange,
  idPrefix,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  idPrefix: string;
  label: string;
}) {
  const onKeyDown = (e: KeyboardEvent) => {
    const i = options.findIndex((o) => o.value === value);
    let next: number;
    if (e.key === 'ArrowRight') next = (i + 1) % options.length;
    else if (e.key === 'ArrowLeft')
      next = (i - 1 + options.length) % options.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = options.length - 1;
    else return;
    e.preventDefault();
    const v = options[next].value;
    onChange(v);
    document.getElementById(tabIds(idPrefix, v).tab)?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      className="flex gap-1"
      onKeyDown={onKeyDown}
    >
      {options.map((o) => {
        const selected = value === o.value;
        const ids = tabIds(idPrefix, o.value);
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            id={ids.tab}
            aria-selected={selected}
            aria-controls={selected ? ids.panel : undefined}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={cn(
              'px-2.5 py-1 rounded-md text-xs font-medium border transition-colors',
              selected
                ? 'border-brand bg-brand/10 text-brand'
                : 'border-[--border] text-[--muted] hover:text-[--foreground]'
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
