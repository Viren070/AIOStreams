import { Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import { motion } from 'motion/react';
import { PageWrapper } from '@/components/shared/page-wrapper';
import { SectionNavSelect } from '@/components/shared/section-nav-select';
import {
  BLOCKLIST_SECTIONS,
  DEFAULT_BLOCKLIST_SECTION,
  type BlocklistSectionId,
} from './sections';
import { useBlocklistSnapshot } from './shared';

/**
 * Shared shell for the blocklist dashboard: the heading, the mobile section
 * selector, and an `<Outlet/>` for the active section's child route. Desktop
 * navigation lives in the dashboard sidebar, where the "Blocklists" item
 * expands into an inline accordion of these sections.
 */
export function BlocklistLayout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const snapshot = useBlocklistSnapshot().data;
  const current: BlocklistSectionId =
    BLOCKLIST_SECTIONS.find((s) => pathname === `/dashboard/blocklist/${s.id}`)
      ?.id ?? DEFAULT_BLOCKLIST_SECTION;

  return (
    <PageWrapper className="p-4 sm:p-8 space-y-6">
      <div>
        <h2>Release Blocklists</h2>
        <p className="text-[--muted]">
          {snapshot
            ? `${snapshot.counts.total} entries across ${snapshot.sources.length} sources · ${snapshot.counts.overrides} overrides`
            : 'Shared verdicts about dead, defective, fake and mislabeled releases'}
        </p>
      </div>

      <SectionNavSelect
        sections={BLOCKLIST_SECTIONS}
        value={current}
        onChange={(section) =>
          navigate({ to: `/dashboard/blocklist/${section}` })
        }
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
