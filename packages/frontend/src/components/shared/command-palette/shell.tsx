import React from 'react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command/command';

/** Every CommandItem installs a MutationObserver, so an uncapped result list
 *  makes each keystroke rebuild hundreds of them. */
const MAX_RESULTS = 50;

export interface CommandPaletteResult {
  id: string;
  label: string;
  trail: string;
  icon?: React.ReactNode;
  shortcut?: string;
  score: number;
  onSelect: () => void;
}

export interface CommandPaletteShellProps {
  open: boolean;
  onClose: () => void;
  /** Accessible name for the command list, e.g. 'Settings search'. */
  label: string;
  placeholder: string;
  /** Shown while the query is empty and there is no `idleGroup`. */
  emptyHint: string;
  query: string;
  onQueryChange: (value: string) => void;
  /** True when the (deferred) query is blank, so `results` is not yet meaningful. */
  isIdle: boolean;
  /** Pre-sorted, best first. Capped for rendering. */
  results: CommandPaletteResult[];
  /** Rendered in place of the results while idle, e.g. a quick-actions group. */
  idleGroup?: React.ReactNode;
}

/** The dialog chrome shared by the configure and dashboard command palettes. */
export function CommandPaletteShell({
  open,
  onClose,
  label,
  placeholder,
  emptyHint,
  query,
  onQueryChange,
  isIdle,
  results,
  idleGroup,
}: CommandPaletteShellProps) {
  return (
    <CommandDialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      hideCloseButton
      contentClass="max-w-2xl p-0"
      commandProps={{ shouldFilter: false, label }}
    >
      <CommandInput
        placeholder={placeholder}
        autoFocus
        value={query}
        onValueChange={onQueryChange}
      />
      <CommandList className="max-h-[60vh]">
        <CommandEmpty>{isIdle ? emptyHint : 'No matches.'}</CommandEmpty>

        {isIdle
          ? idleGroup
          : results.length > 0 && (
              <CommandGroup>
                {results.slice(0, MAX_RESULTS).map((result) => (
                  <CommandItem
                    key={result.id}
                    value={result.id}
                    leftIcon={result.icon}
                    onSelect={result.onSelect}
                  >
                    <span>{result.label}</span>
                    <span className="ml-auto text-xs text-[--muted] capitalize">
                      {result.trail}
                    </span>
                    {result.shortcut && (
                      <CommandShortcut>{result.shortcut}</CommandShortcut>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
      </CommandList>
    </CommandDialog>
  );
}
