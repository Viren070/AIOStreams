import { Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import { motion } from 'motion/react';
import { PageWrapper } from '@/components/shared/page-wrapper';
import { SectionNavSelect } from '@/components/shared/section-nav-select';
import {
  COMMUNITY_SECTIONS,
  DEFAULT_COMMUNITY_SECTION,
  type CommunitySectionId,
} from './sections';

export function CommunityLayout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const current: CommunitySectionId =
    COMMUNITY_SECTIONS.find((s) => pathname === `/dashboard/community/${s.id}`)
      ?.id ?? DEFAULT_COMMUNITY_SECTION;

  return (
    <PageWrapper className="space-y-6 p-4 sm:p-8">
      <div>
        <h2>Community</h2>
        <p className="text-[--muted]">
          Formatters and templates shared by users of this instance.
        </p>
      </div>

      <SectionNavSelect
        sections={COMMUNITY_SECTIONS}
        value={current}
        onChange={(section) =>
          navigate({ to: `/dashboard/community/${section}` })
        }
      />

      <div className="min-w-0">
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
