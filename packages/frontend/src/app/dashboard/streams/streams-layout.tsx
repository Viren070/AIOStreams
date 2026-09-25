import { Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import { motion } from 'motion/react';
import { PageWrapper } from '@/components/shared/page-wrapper';
import { SectionNavSelect } from '@/components/shared/section-nav-select';
import { AnimatedNumber } from '@/components/shared/animated-number';
import { formatSpeed } from '@aiostreams/ui/core/format';
import {
  STREAMS_SECTIONS,
  DEFAULT_STREAMS_SECTION,
  type StreamsSectionId,
} from './sections';
import { useLiveStreams, liveFrameMs } from './queries';
import { GenerateProxyLinkModal } from './_components/generate-link-modal';

/**
 * Shared shell for the streams dashboard: the heading (with a live summary),
 * the mobile section selector, and an `<Outlet/>` for the active section.
 * Desktop navigation lives in the sidebar, where "Streams" expands into an
 * inline accordion of these sections.
 */
export function StreamsLayout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // Keeps the summary live on every section; the shared EventSource is
  // refcounted, so the Active page doesn't open a second one.
  const live = useLiveStreams();
  const summary = live.data?.summary;
  const frameMs = liveFrameMs(live.data);
  const current: StreamsSectionId =
    STREAMS_SECTIONS.find((s) => pathname === `/dashboard/streams/${s.id}`)
      ?.id ?? DEFAULT_STREAMS_SECTION;

  return (
    <PageWrapper className="space-y-6 p-4 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2>Streams</h2>
          <p className="text-[--muted]">
            {summary ? (
              <>
                {summary.streaming} streaming · {summary.paused + summary.idle}{' '}
                paused ·{' '}
                <AnimatedNumber
                  value={summary.totalBytesPerSec}
                  format={formatSpeed}
                  durationSec={frameMs / 1000}
                />
              </>
            ) : (
              'Everything being served through the proxy and the usenet engine'
            )}
          </p>
        </div>
        <GenerateProxyLinkModal />
      </div>

      <SectionNavSelect
        sections={STREAMS_SECTIONS}
        value={current}
        onChange={(section) =>
          navigate({ to: `/dashboard/streams/${section}` })
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
