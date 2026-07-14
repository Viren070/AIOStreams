import { Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import { motion } from 'motion/react';
import { PageWrapper } from '@/components/shared/page-wrapper';
import { SectionNavSelect } from '@/components/shared/section-nav-select';
import { SECTIONS, DEFAULT_SECTION, type SectionId } from './sections';

/**
 * Shared shell for the usenet dashboard: the heading, the mobile section
 * selector, and an `<Outlet/>` for the active section's child route. Desktop
 * navigation lives in the dashboard sidebar, where the "Usenet" item expands
 * into an inline accordion of these sections. The active section is the last
 * path segment (`/dashboard/usenet/<section>`), so it stays deep-linkable;
 * the keyed fade replays as each section route mounts.
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
          The built-in usenet engine — your library, live activity, provider
          performance and settings.
        </p>
      </div>

      <SectionNavSelect
        sections={SECTIONS}
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
