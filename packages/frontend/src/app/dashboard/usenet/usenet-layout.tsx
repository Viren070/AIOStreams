import React from 'react';
import { Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import { motion, AnimatePresence } from 'motion/react';
import { BiChevronDown, BiCheck } from 'react-icons/bi';
import { PageWrapper } from '@/components/shared/page-wrapper';
import { cn } from '@/components/ui/core/styling';
import { SECTIONS, DEFAULT_SECTION, type SectionId } from './sections';

// ---------------------------------------------------------------------------
// Section navigation
// ---------------------------------------------------------------------------
// Desktop navigation lives in the dashboard sidebar: the "Usenet" item expands
// into an inline accordion of these sections. The layout only renders the mobile
// selector below (the mobile sidebar is a drawer, so an in-page switcher stays
// handy on touch). Both drive the child routes (`/dashboard/usenet/<section>`).

/**
 * Mobile: a full-width pill showing only the active section's icon+label. Tapping
 * it expands a dropdown overlay (with a dim scrim) listing all sections; picking
 * one collapses back. Effectively a branded `<select>`. Closes on outside-tap +
 * Escape. The pill sits at the top of the page, so the menu always opens
 * downward (always room below).
 */
function NavSelect({
  value,
  onChange,
}: {
  value: SectionId;
  onChange: (v: SectionId) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const active = SECTIONS.find((s) => s.id === value) ?? SECTIONS[0];
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
              {SECTIONS.map((s) => {
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

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/**
 * Shared shell for the usenet dashboard: the heading, the mobile section
 * selector, and an `<Outlet/>` for the active section's child route. The active
 * section is the last path segment (`/dashboard/usenet/<section>`), so it stays
 * deep-linkable; the keyed fade replays as each section route mounts.
 */
export function UsenetLayout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const current: SectionId =
    SECTIONS.find((s) => pathname === `/dashboard/usenet/${s.id}`)?.id ??
    DEFAULT_SECTION;

  return (
    <PageWrapper className="p-4 sm:p-8 space-y-6">
      <div>
        <h2>Usenet</h2>
        <p className="text-[--muted]">
          Native NNTP engine — library, live activity, provider performance and
          configuration.
        </p>
      </div>

      {/* Mobile section selector; desktop navigates via the sidebar accordion. */}
      <NavSelect
        value={current}
        onChange={(section) => navigate({ to: `/dashboard/usenet/${section}` })}
      />

      <div className="min-w-0">
        {/* Re-key the fade by route so each section transitions in on navigate. */}
        <motion.div
          key={pathname}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
        >
          <Outlet />
        </motion.div>
      </div>
    </PageWrapper>
  );
}
