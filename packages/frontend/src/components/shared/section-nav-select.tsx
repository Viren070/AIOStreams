import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { BiChevronDown, BiCheck } from 'react-icons/bi';
import { cn } from '@/components/ui/core/styling';

/** A dashboard feature's sub-section, shared by its layout, the router and
 *  the sidebar accordion. */
export interface DashboardSection<Id extends string = string> {
  id: Id;
  label: string;
  icon: React.ElementType;
}

/**
 * Mobile: a full-width pill showing only the active section's icon+label. Tapping
 * it expands a dropdown overlay (with a dim scrim) listing all sections; picking
 * one collapses back. Effectively a branded `<select>`. Closes on outside-tap +
 * Escape. The pill sits at the top of the page, so the menu always opens
 * downward (always room below). Hidden on `sm+`, where the sidebar accordion
 * handles section navigation.
 */
export function SectionNavSelect<Id extends string>({
  sections,
  value,
  onChange,
}: {
  sections: readonly DashboardSection<Id>[];
  value: Id;
  onChange: (v: Id) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const active = sections.find((s) => s.id === value) ?? sections[0];
  const ActiveIcon = active.icon;

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative sm:hidden">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-11 w-full items-center gap-2.5 rounded-full border border-[--border] bg-[--subtle]/40 px-4 text-sm font-medium"
      >
        <ActiveIcon className="shrink-0 text-lg text-[--muted]" />
        <span className="flex-1 text-left">{active.label}</span>
        <BiChevronDown
          className={cn(
            'text-lg text-[--muted] transition-transform',
            open && 'rotate-180'
          )}
        />
      </button>
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-black/30"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
            />
            <motion.ul
              role="listbox"
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.98 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              className="absolute inset-x-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-[--border] bg-[--background] shadow-lg"
            >
              {sections.map((s) => {
                const sel = s.id === value;
                const Icon = s.icon;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={sel}
                      onClick={() => {
                        onChange(s.id);
                        setOpen(false);
                      }}
                      className={cn(
                        'flex w-full items-center gap-3 px-4 py-3 text-sm transition-colors',
                        sel
                          ? 'bg-[--subtle] font-medium text-[--foreground]'
                          : 'text-[--muted] hover:bg-[--subtle]/40 hover:text-[--foreground]'
                      )}
                    >
                      <Icon className="shrink-0 text-lg" />
                      <span className="flex-1 text-left">{s.label}</span>
                      {sel && <BiCheck className="text-lg text-[--muted]" />}
                    </button>
                  </li>
                );
              })}
            </motion.ul>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
