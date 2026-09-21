import React from 'react';
import ReactMarkdown from 'react-markdown';
import { motion } from 'framer-motion';
import { ExternalLinkIcon } from 'lucide-react';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';
import { Drawer } from '@/components/ui/drawer';
import { Alert } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/components/ui/core/styling';
import {
  GithubRelease,
  ReleaseChannel,
  DOCS_CHANGELOG_URL,
} from '@/lib/changelog';
import { useMediaQuery } from '@/hooks/media-query';
import { UseReleases } from './use-releases';

/**
 * A collapsed row costs nothing to render, which is what makes showing the
 * whole history viable — the old box could only afford five at a time because
 * every card rendered a full release body.
 */
function ReleaseRow({
  release,
  isNewer,
}: {
  release: GithubRelease;
  isNewer: boolean;
}) {
  const body = release.body?.replace(release.tag_name, '').trim();

  return (
    <AccordionItem
      value={release.tag_name}
      className={cn(
        'rounded-lg border overflow-hidden transition-colors',
        isNewer
          ? 'border-brand-500/50 bg-brand-500/[0.06]'
          : 'border-gray-700/60 bg-gray-800/30'
      )}
    >
      <AccordionTrigger
        className="px-3.5 py-2.5 gap-3 hover:bg-gray-700/20"
        triggerIconClass="text-gray-500"
      >
        <span className="flex items-center gap-3 min-w-0 flex-1">
          <span
            className={cn(
              'text-sm font-semibold',
              isNewer ? 'text-[--brand]' : 'text-gray-200'
            )}
          >
            {release.tag_name}
          </span>
          {isNewer && (
            <span className="text-[10px] leading-none font-medium px-1.5 py-1 rounded bg-brand-500/20 text-[--brand]">
              Newer
            </span>
          )}
          <span className="ml-auto text-xs text-gray-500 shrink-0">
            {new Date(release.published_at).toLocaleDateString()}
          </span>
        </span>
      </AccordionTrigger>

      <AccordionContent className="px-3.5 pb-3.5 pt-0.5 space-y-3">
        <div className="prose prose-invert prose-sm max-w-none min-w-0 [&_p]:text-sm [&_ul]:text-sm [&_li]:text-sm [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_pre]:overflow-x-auto [&_pre]:max-w-full [&_*]:break-words">
          <ReactMarkdown>{body || 'No changelog provided.'}</ReactMarkdown>
        </div>
        <a
          href={release.html_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-white transition-colors"
        >
          View on GitHub
          <ExternalLinkIcon className="w-3 h-3" />
        </a>
      </AccordionContent>
    </AccordionItem>
  );
}

export function ReleasesDrawer({
  open,
  onOpenChange,
  channel,
  releases,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channel: ReleaseChannel;
  releases: UseReleases;
}) {
  const isDesktop = useMediaQuery('(min-width: 640px)');
  const { loadMore, hasMore, loadingMore, loading, error } = releases;

  const observerRef = React.useRef<IntersectionObserver | null>(null);
  const loadMoreRef = React.useRef(loadMore);
  loadMoreRef.current = loadMore;

  // A callback ref, not an effect: Radix mounts the drawer body in a later
  // commit than the one where `open` flips, so an effect keyed on `open` runs
  // while the sentinel is still null and never re-runs — which is why nothing
  // past the first page was ever fetched.
  const sentinelRef = React.useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    if (!node) {
      observerRef.current = null;
      return;
    }
    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMoreRef.current();
      },
      { rootMargin: '300px' }
    );
    observerRef.current.observe(node);
  }, []);

  React.useEffect(() => () => observerRef.current?.disconnect(), []);

  const newerTags = new Set(releases.newer.map((r) => r.tag_name));

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      side={isDesktop ? 'right' : 'bottom'}
      size={isDesktop ? 'lg' : 'full'}
      title="All releases"
      description={
        channel === 'nightly'
          ? 'Every nightly build, newest first.'
          : 'Every release, newest first.'
      }
      contentClass="flex flex-col"
    >
      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        {error && (
          <Alert
            intent="alert"
            title="Error"
            description={error}
            className="mb-2"
          />
        )}

        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-11 w-full rounded-lg" />
            ))}
          </div>
        ) : (
          <Accordion
            type="multiple"
            defaultValue={
              newerTags.size
                ? releases.newer.map((r) => r.tag_name).slice(0, 5)
                : releases.releases[0]
                  ? [releases.releases[0].tag_name]
                  : []
            }
            className="space-y-2"
          >
            {releases.releases.map((release, i) => (
              <motion.div
                key={release.id || release.tag_name}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.18,
                  delay: Math.min(i, 8) * 0.03,
                  ease: 'easeOut',
                }}
              >
                <ReleaseRow
                  release={release}
                  isNewer={newerTags.has(release.tag_name)}
                />
              </motion.div>
            ))}
          </Accordion>
        )}

        <div ref={sentinelRef} className="h-px" />

        {loadingMore && (
          <div className="space-y-2 pt-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-11 w-full rounded-lg" />
            ))}
          </div>
        )}

        {!loading && hasMore && !loadingMore && (
          <div className="flex justify-center py-4">
            <button
              type="button"
              onClick={loadMore}
              className="text-xs text-gray-500 hover:text-white transition-colors"
            >
              Load older releases
            </button>
          </div>
        )}

        {!loading && !hasMore && releases.releases.length > 0 && (
          <p className="text-center text-xs text-gray-600 py-4">
            That&apos;s everything.
          </p>
        )}
      </div>

      <div className="pt-3 mt-3 border-t border-gray-700/60">
        <a
          href={DOCS_CHANGELOG_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-[--brand] hover:underline"
        >
          Read the written changelog
          <ExternalLinkIcon className="w-3.5 h-3.5" />
        </a>
      </div>
    </Drawer>
  );
}
