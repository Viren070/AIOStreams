import React from 'react';
import { GlowCard } from '../../../shared/glow-card';
import { cn } from '../../../ui/core/styling';
import { FormatterPreviewBox } from '../preview/preview-box';
import type { CardPreview } from './use-card-previews';

interface FormatterCardProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  badge?: React.ReactNode;
  preview?: CardPreview;
  active?: boolean;
  actions?: React.ReactNode;
  tags?: string[];
  /** Replaces the title row, used for inline rename. */
  header?: React.ReactNode;
}

export function FormatterCard({
  title,
  description,
  badge,
  preview,
  active = false,
  actions,
  tags,
  header,
}: FormatterCardProps) {
  return (
    <GlowCard
      glowSize="350px"
      glowOpacity={0.08}
      transitionDuration="0.3s"
      className={cn(
        'flex flex-col gap-3 bg-gray-900 border-gray-800 hover:border-gray-600 transition-colors duration-200 rounded-lg p-4',
        active && 'border-[--brand] ring-1 ring-[--brand]/40'
      )}
    >
      {header ?? (
        <div className="space-y-1">
          {/* Badges wrap under the title on narrow screens instead of squeezing it. */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="flex-1 min-w-[8rem] text-base font-semibold text-white truncate">
              {title}
            </h3>
            {(active || badge) && (
              <div className="flex flex-wrap items-center gap-1.5">
                {active && (
                  <span className="text-xs bg-brand-500/20 text-brand-300 px-2 py-0.5 rounded border border-brand-500/30">
                    Active
                  </span>
                )}
                {badge}
              </div>
            )}
          </div>
          {description && (
            <div className="text-xs text-gray-400 max-h-28 overflow-y-auto whitespace-pre-wrap break-words pr-1">
              {description}
            </div>
          )}
        </div>
      )}

      {tags && tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.map((tag) => (
            <span
              key={tag}
              className="text-[10px] uppercase tracking-wide bg-gray-800/80 text-gray-300 px-1.5 py-0.5 rounded border border-gray-700"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {preview?.error ? (
        <div className="rounded-md border border-red-600/60 bg-red-700/30 p-3 text-xs text-red-300 break-words">
          {preview.error}
        </div>
      ) : (
        <FormatterPreviewBox
          compact
          name={preview?.name ?? ' '}
          description={preview?.description ?? ' '}
          className={cn(!preview && 'animate-pulse')}
        />
      )}

      {actions && (
        <div className="flex items-center gap-2 flex-wrap mt-auto">
          {actions}
        </div>
      )}
    </GlowCard>
  );
}
