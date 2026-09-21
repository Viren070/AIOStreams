import React from 'react';
import { Template } from '@aiostreams/core';
import { PuzzleIcon, CloudIcon, CloudOffIcon } from 'lucide-react';
import { GlowCard } from '@/components/shared/glow-card';
import { Skeleton } from '@/components/ui/skeleton';
import MarkdownLite from '@/components/shared/markdown-lite';
import { SourceBadge } from '@/components/shared/templates/steps/browse';
import { templateRequirements } from '@/lib/templates/summary';

/**
 * Same information hierarchy as the cards in the setup browser — title, source,
 * two lines, then what it needs — so the two can't drift apart.
 */
function FeaturedCard({
  template,
  onOpen,
}: {
  template: Template;
  onOpen: () => void;
}) {
  const {
    addons,
    services,
    servicesChosenDuringSetup,
    skipsServiceSelection,
    addonsVary,
  } = templateRequirements(template);

  return (
    <GlowCard className="bg-gray-900/60 border-gray-800 hover:border-gray-600 transition-colors duration-200 rounded-lg">
      <button
        type="button"
        onClick={onOpen}
        className="text-left w-full h-full p-4 flex flex-col focus-visible:outline-none"
      >
        <div className="flex items-start gap-2 mb-1.5">
          <h4 className="flex-1 min-w-0 text-base font-semibold text-white truncate">
            {template.metadata.name}
          </h4>
          <SourceBadge template={template} />
        </div>

        <div className="text-sm text-gray-400 line-clamp-3 mb-3">
          <MarkdownLite>{template.metadata.description}</MarkdownLite>
        </div>

        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
          <span className="truncate max-w-[10rem]">
            by {template.metadata.author}
          </span>
          {addons.length > 0 && (
            <span className="flex items-center gap-1">
              <PuzzleIcon className="w-3.5 h-3.5" />
              {addonsVary ? 'up to ' : ''}
              {addons.length} addon{addons.length === 1 ? '' : 's'}
            </span>
          )}
          {services.length > 0 ? (
            <span className="flex items-center gap-1 min-w-0">
              <CloudIcon className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">
                Needs {services.slice(0, 2).join(', ')}
                {services.length > 2 ? ` +${services.length - 2}` : ''}
              </span>
            </span>
          ) : servicesChosenDuringSetup ? (
            <span className="flex items-center gap-1 min-w-0">
              <CloudIcon className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">You pick the services</span>
            </span>
          ) : skipsServiceSelection ? (
            <span className="flex items-center gap-1 min-w-0">
              <CloudOffIcon className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">No service to pick</span>
            </span>
          ) : null}
        </div>
      </button>
    </GlowCard>
  );
}

export function FeaturedSetups({
  templates,
  totalCount,
  loading,
  onOpen,
  onBrowseAll,
}: {
  templates: Template[];
  totalCount: number;
  loading: boolean;
  onOpen: (template: Template) => void;
  onBrowseAll: () => void;
}) {
  if (loading) {
    return (
      <div>
        <div className="flex items-center justify-between mb-3">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-32 w-full rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (templates.length === 0) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-semibold text-white">Featured setups</h3>
        <button
          type="button"
          onClick={onBrowseAll}
          className="text-sm text-[--brand] hover:underline transition-colors"
        >
          Browse all {totalCount} →
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {templates.map((template) => (
          <FeaturedCard
            key={template.metadata.id}
            template={template}
            onOpen={() => onOpen(template)}
          />
        ))}
      </div>
    </div>
  );
}
