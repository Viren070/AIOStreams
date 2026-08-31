import React from 'react';
import { Bookmark, ChevronsUpDown, Layers, PenLine } from 'lucide-react';
import { cn } from '../../ui/core/styling';

export type FormatterKind = 'builtin' | 'customised' | 'saved' | 'custom';

// Badge hues match the cards inside the browser so the two read as one thing.
const KIND = {
  builtin: {
    label: 'Built-in',
    icon: Layers,
    badge: 'bg-green-500/20 text-green-400 border-green-500/30',
  },
  customised: {
    label: 'Customised',
    icon: Layers,
    badge: 'bg-yellow-400/20 text-yellow-400 border-yellow-400/30',
  },
  saved: {
    label: 'Saved',
    icon: Bookmark,
    badge: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
  },
  custom: {
    label: 'Custom',
    icon: PenLine,
    badge: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  },
} as const;

export interface FormatterPickerProps {
  name: string;
  kind: FormatterKind;
  detail?: React.ReactNode;
  onOpen: () => void;
}

/** Select-style trigger showing the active formatter; opens the browser. */
export function FormatterPicker({
  name,
  kind,
  detail,
  onOpen,
}: FormatterPickerProps) {
  const { label, icon: Icon, badge } = KIND[kind];
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      className={cn(
        'group/picker flex w-full items-center gap-3 rounded-lg border border-gray-800 bg-gray-900/60 px-3 py-3 text-left sm:px-4',
        'transition-colors hover:border-gray-600 hover:bg-gray-900',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--ring] ring-offset-2 ring-offset-[--background]'
      )}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-brand-500/20 bg-brand-500/10 text-[--brand]">
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-sm font-semibold text-[--foreground]">
            {name}
          </span>
          <span
            className={cn(
              'shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium',
              badge
            )}
          >
            {label}
          </span>
        </span>
        {detail && (
          <span className="mt-0.5 block text-xs text-[--muted] line-clamp-2">
            {detail}
          </span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-[--muted] transition-colors group-hover/picker:text-[--brand]">
        <span className="hidden sm:inline">Change</span>
        <ChevronsUpDown className="h-4 w-4" />
      </span>
    </button>
  );
}
