import React, { useState, useEffect, useMemo } from 'react';
import { Template, type CommunityItemPublic } from '@aiostreams/core';
import {
  SearchIcon,
  AlertTriangleIcon,
  Trash2Icon,
  CheckIcon,
  HeartIcon,
  ScrollText,
  Share2Icon,
  UserIcon,
  PuzzleIcon,
  CloudIcon,
  CloudOffIcon,
} from 'lucide-react';
import { templateTags } from '../../../../../../core/src/utils/template-sanitise';
import { BiImport } from 'react-icons/bi';
import { Button, IconButton } from '../../../ui/button';
import { TextInput } from '../../../ui/text-input';
import { Tooltip } from '../../../ui/tooltip';
import { Drawer } from '../../../ui/drawer';
import { cn } from '../../../ui/core/styling';
import MarkdownLite from '../../markdown-lite';
import { TemplateValidation } from '@/lib/templates/types';
import { templateRequirements } from '@/lib/templates/summary';
import { useMediaQuery } from '@/hooks/media-query';
import { TemplateValidationModal } from '../validation-modal';
import { GlowCard } from '../../glow-card';
import { TemplateChangelogModal } from '../changelog';

interface TemplateBrowseStepProps {
  searchQuery: string;
  onSearchChange: (v: string) => void;
  selectedCategory: string;
  onCategoryChange: (v: string) => void;
  selectedSource: string;
  onSourceChange: (v: string) => void;
  categories: string[];
  sources: string[];
  filteredTemplates: Template[];
  allTemplates: Template[];
  loadingTemplates: boolean;
  templateValidations: Record<string, TemplateValidation>;
  isLoading: boolean;
  onLoadTemplate: (t: Template) => void;
  onImportOpen: () => void;
  onDeleteRequest: (t: Template) => void;
  totalTemplateCount: number;
  initialExpandedTemplate?: Template;
  /** Fired once the detail panel has been opened, so the caller can forget it. */
  onInitialExpandedConsumed?: () => void;
  communityItems?: Record<string, CommunityItemPublic>;
  onLike?: (id: string) => void;
  likeDisabledReason?: string;
  /** Opens the list of the user's own shared templates. */
  onMineOpen?: () => void;
  /** Shares an imported template JSON verbatim with the community. */
  onShare?: (t: Template) => void;
  /** Shown on a disabled share button when sharing is on but unavailable to this user. */
  shareDisabledReason?: string;
}

/**
 * Source is the only badge that carries a real meaning — community templates
 * are written by strangers — so it is the only one that gets a colour.
 */
export function SourceBadge({
  template,
  community,
}: {
  template: Template;
  community?: CommunityItemPublic;
}) {
  const source = template.metadata.source;
  const label =
    source === 'builtin'
      ? 'Built-in'
      : source === 'custom'
        ? 'From this instance'
        : source === 'external'
          ? 'Imported'
          : community?.federated
            ? `From ${community.origin}`
            : 'Community';

  return (
    <span
      className={cn(
        'text-[10px] leading-none font-medium px-1.5 py-1 rounded border whitespace-nowrap',
        source === 'community'
          ? 'bg-amber-500/10 text-amber-300/90 border-amber-500/25'
          : 'bg-gray-700/40 text-gray-400 border-gray-600/40'
      )}
    >
      {label}
    </span>
  );
}

interface TemplateCardProps {
  template: Template;
  validation: TemplateValidation | undefined;
  onOpenDetail: (t: Template) => void;
  community?: CommunityItemPublic;
  onLike?: (id: string) => void;
  likeDisabledReason?: string;
}

function TemplateCard({
  template,
  validation,
  onOpenDetail,
  community,
  onLike,
  likeDisabledReason,
}: TemplateCardProps) {
  const hasWarnings = (validation?.warnings.length ?? 0) > 0;
  const hasErrors = (validation?.errors.length ?? 0) > 0;

  const {
    addons,
    services,
    servicesChosenDuringSetup,
    skipsServiceSelection,
    addonsVary,
  } = templateRequirements(template);

  return (
    <GlowCard
      glowSize="350px"
      glowOpacity={0.08}
      transitionDuration="0.3s"
      className={cn(
        'flex flex-col bg-gray-900/60 border-gray-800 rounded-lg p-4',
        'hover:border-gray-600 transition-colors duration-200'
      )}
    >
      <button
        type="button"
        onClick={() => onOpenDetail(template)}
        className="flex-1 flex flex-col text-left focus-visible:outline-none"
      >
        <div className="flex items-start gap-2 mb-1.5">
          <h3 className="flex-1 min-w-0 text-base font-semibold text-white truncate">
            {template.metadata.name}
          </h3>
          <div className="flex items-center gap-1.5 shrink-0">
            {(hasErrors || hasWarnings) && (
              <AlertTriangleIcon
                className={cn(
                  'w-3.5 h-3.5',
                  hasErrors ? 'text-red-300' : 'text-yellow-400'
                )}
              />
            )}
            <SourceBadge template={template} community={community} />
          </div>
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

      {community && (
        <div className="mt-3 pt-2.5 border-t border-gray-800/80 flex">
          <Tooltip
            trigger={
              <span>
                <button
                  type="button"
                  disabled={!onLike || community.federated}
                  onClick={(e) => {
                    e.stopPropagation();
                    onLike?.(community.id);
                  }}
                  className={cn(
                    'flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors',
                    !onLike || community.federated
                      ? 'border-gray-800 text-gray-500 cursor-not-allowed'
                      : 'border-gray-700 text-gray-400 hover:border-pink-500/40 hover:text-pink-300'
                  )}
                >
                  <HeartIcon className="w-3.5 h-3.5" />
                  {community.likes}
                </button>
              </span>
            }
          >
            {community.federated
              ? 'Likes only work for templates published on this instance'
              : (likeDisabledReason ?? 'Like this template')}
          </Tooltip>
        </div>
      )}
    </GlowCard>
  );
}

/**
 * Everything a template does, shown before the user commits to it — the
 * requirements in particular, which used to only surface three steps later.
 */
function TemplateDetail({
  template,
  validation,
  isLoading,
  onLoadTemplate,
  onDeleteRequest,
  onShare,
  shareDisabledReason,
  community,
  onClose,
}: {
  template: Template;
  validation: TemplateValidation | undefined;
  isLoading: boolean;
  onLoadTemplate: (t: Template) => void;
  onDeleteRequest: (t: Template) => void;
  onShare?: (t: Template) => void;
  shareDisabledReason?: string;
  community?: CommunityItemPublic;
  onClose: () => void;
}) {
  const [showValidation, setShowValidation] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);

  const {
    addons,
    services,
    servicesChosenDuringSetup,
    skipsServiceSelection,
    addonsVary,
  } = templateRequirements(template);
  const hasChangelog =
    (template.metadata.changelog?.length ?? 0) > 0 ||
    !!template.metadata.changelogUrl;
  const hasWarnings = (validation?.warnings.length ?? 0) > 0;
  const hasErrors = (validation?.errors.length ?? 0) > 0;

  return (
    <div className="flex flex-col gap-5 h-full min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto pr-1 flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2">
          <SourceBadge template={template} community={community} />
          <span className="text-xs text-gray-500">
            v{template.metadata.version || '1.0.0'} · by{' '}
            {template.metadata.author}
          </span>
        </div>

        {(hasErrors || hasWarnings) && (
          <button
            type="button"
            onClick={() => setShowValidation(true)}
            className={cn(
              'flex items-center gap-2 text-left text-xs rounded-lg border px-3 py-2 transition-colors',
              hasErrors
                ? 'border-red-400/30 bg-red-500/5 text-red-200 hover:bg-red-500/10'
                : 'border-yellow-400/30 bg-yellow-500/5 text-yellow-300 hover:bg-yellow-500/10'
            )}
          >
            <AlertTriangleIcon className="w-4 h-4 shrink-0" />
            {hasErrors
              ? `${validation!.errors.length} problem${validation!.errors.length === 1 ? '' : 's'} with this template — view details`
              : `${validation!.warnings.length} warning${validation!.warnings.length === 1 ? '' : 's'} — view details`}
          </button>
        )}

        {(services.length > 0 ||
          addons.length > 0 ||
          servicesChosenDuringSetup ||
          skipsServiceSelection) && (
          <div className="rounded-lg border border-gray-700/70 bg-gray-800/40 p-4 space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">
              What this sets up
            </div>
            {services.length > 0 ? (
              <div className="flex items-start gap-2.5 text-sm">
                <CloudIcon className="w-4 h-4 text-gray-500 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <div className="text-gray-300">
                    {template.metadata.serviceRequired === true
                      ? 'You will need an account for'
                      : 'Optionally works with'}
                  </div>
                  <div className="text-gray-400 mt-0.5">
                    {services.join(', ')}
                  </div>
                </div>
              </div>
            ) : servicesChosenDuringSetup ? (
              <div className="flex items-start gap-2.5 text-sm">
                <CloudIcon className="w-4 h-4 text-gray-500 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <div className="text-gray-300">
                    {template.metadata.serviceRequired === true
                      ? 'Needs a debrid or usenet service'
                      : 'Works with or without a service'}
                  </div>
                  <div className="text-gray-400 mt-0.5">
                    You choose which ones during setup.
                  </div>
                </div>
              </div>
            ) : skipsServiceSelection ? (
              <div className="flex items-start gap-2.5 text-sm">
                <CloudOffIcon className="w-4 h-4 text-gray-500 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <div className="text-gray-300">No service to pick</div>
                  <div className="text-gray-400 mt-0.5">
                    This setup does not ask you to choose a service.
                  </div>
                </div>
              </div>
            ) : null}
            {addons.length > 0 && (
              <div className="flex items-start gap-2.5 text-sm">
                <PuzzleIcon className="w-4 h-4 text-gray-500 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <div className="text-gray-300">
                    {addonsVary ? 'Up to ' : ''}
                    {addons.length} addon{addons.length === 1 ? '' : 's'}
                    {addonsVary && (
                      <span className="text-gray-500">
                        {' '}
                        — the exact set depends on your answers
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {addons.map((addon, i) => (
                      <span
                        key={`${addon}-${i}`}
                        className="text-xs bg-gray-700/50 text-gray-300 px-2 py-0.5 rounded"
                      >
                        {addon}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        <MarkdownLite className="text-sm text-gray-300 [&_a]:text-[--brand] [&_a:hover]:underline [&_ul]:list-disc [&_ul]:pl-4 [&_li]:mb-0.5">
          {template.metadata.description}
        </MarkdownLite>

        <div className="flex flex-wrap items-center gap-1.5">
          {templateTags(template.metadata).map((tag) => (
            <span
              key={tag}
              className="text-xs bg-gray-800/60 text-gray-400 px-2 py-1 rounded"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 pt-3 border-t border-gray-700/60">
        {hasChangelog && (
          <Tooltip
            trigger={
              <IconButton
                icon={<ScrollText className="w-4 h-4" />}
                intent="gray-outline"
                onClick={() => setShowChangelog(true)}
              />
            }
          >
            View changelog
          </Tooltip>
        )}
        {template.metadata.source === 'external' && (
          <>
            <Tooltip
              trigger={
                <IconButton
                  icon={<Trash2Icon className="w-4 h-4" />}
                  intent="alert-outline"
                  onClick={() => {
                    onClose();
                    onDeleteRequest(template);
                  }}
                />
              }
            >
              Delete this imported template
            </Tooltip>
            {(onShare || shareDisabledReason) && (
              <Tooltip
                trigger={
                  <span>
                    <IconButton
                      icon={<Share2Icon className="w-4 h-4" />}
                      intent="gray-outline"
                      disabled={!onShare}
                      onClick={() => onShare?.(template)}
                    />
                  </span>
                }
              >
                {onShare
                  ? 'Share this JSON with the community (updates your existing submission of the same name)'
                  : shareDisabledReason}
              </Tooltip>
            )}
          </>
        )}
        <Button
          intent="primary"
          leftIcon={<CheckIcon className="w-4 h-4" />}
          onClick={() => onLoadTemplate(template)}
          loading={isLoading}
          className="flex-1"
        >
          Use this setup
        </Button>
      </div>

      {showValidation && validation && (
        <TemplateValidationModal
          open={showValidation}
          template={template}
          data={validation}
          onProceed={null}
          proceedLabel=""
          onClose={() => setShowValidation(false)}
        />
      )}

      <TemplateChangelogModal
        open={showChangelog}
        onOpenChange={(o) => !o && setShowChangelog(false)}
        templateName={template.metadata.name}
        changelog={template.metadata.changelog}
        changelogUrl={template.metadata.changelogUrl}
      />
    </div>
  );
}

const SOURCE_LABELS: Record<string, string> = {
  all: 'All',
  builtin: 'Built-in',
  custom: 'This instance',
  external: 'Imported',
  community: 'Community',
};

const SOURCE_DESCRIPTIONS: Record<string, string> = {
  all: 'Every source',
  builtin: 'Provided with AIOStreams',
  custom: 'Added by whoever hosts this instance',
  external: 'Templates you imported yourself',
  community: 'Shared by other users — review before applying',
};

/** One pill idiom for both filter rows, so they read as the same control. */
function FilterPill({
  active,
  onClick,
  children,
  count,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'px-2.5 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0',
        active
          ? 'bg-brand-500/20 text-[--brand] border-brand-500/50'
          : 'bg-gray-800/50 text-gray-400 border-gray-700/70 hover:border-gray-600 hover:text-gray-300'
      )}
    >
      {children}
      {count !== undefined && (
        <span className="ml-1.5 text-[10px] leading-none text-gray-500">
          {count}
        </span>
      )}
    </button>
  );
}

export function TemplateBrowseStep({
  searchQuery,
  onSearchChange,
  selectedCategory,
  onCategoryChange,
  selectedSource,
  onSourceChange,
  categories,
  sources,
  filteredTemplates,
  allTemplates,
  loadingTemplates,
  templateValidations,
  isLoading,
  onLoadTemplate,
  onImportOpen,
  onDeleteRequest,
  totalTemplateCount,
  initialExpandedTemplate,
  onInitialExpandedConsumed,
  communityItems,
  onLike,
  likeDisabledReason,
  onMineOpen,
  onShare,
  shareDisabledReason,
}: TemplateBrowseStepProps) {
  const [detailTemplate, setDetailTemplate] = useState<Template | null>(null);
  const isDesktop = useMediaQuery('(min-width: 640px)');

  // Pre-open the detail panel when a featured card was clicked, and when the
  // template first resolves from the loader (templates load async).
  useEffect(() => {
    if (!initialExpandedTemplate) return;
    setDetailTemplate(initialExpandedTemplate);
    onInitialExpandedConsumed?.();
  }, [initialExpandedTemplate?.metadata.id]);

  const sourceCounts = useMemo(() => {
    const counts: Record<string, number> = { all: allTemplates.length };
    for (const template of allTemplates) {
      const source = template.metadata.source ?? 'builtin';
      counts[source] = (counts[source] ?? 0) + 1;
    }
    return counts;
  }, [allTemplates]);

  const visibleSources = sources.filter(
    (source) => source === 'all' || (sourceCounts[source] ?? 0) > 0
  );

  return (
    <>
      <div className="space-y-2.5 min-w-0">
        <TextInput
          placeholder="Search setups..."
          value={searchQuery}
          onValueChange={onSearchChange}
          leftIcon={<SearchIcon className="w-4 h-4" />}
        />

        <div className="flex gap-1.5 overflow-x-auto min-w-0 pb-1">
          {visibleSources.map((source) => (
            <Tooltip
              key={source}
              trigger={
                <FilterPill
                  active={selectedSource === source}
                  onClick={() => onSourceChange(source)}
                  count={sourceCounts[source] ?? 0}
                >
                  {SOURCE_LABELS[source] ?? source}
                </FilterPill>
              }
            >
              {SOURCE_DESCRIPTIONS[source] ?? source}
            </Tooltip>
          ))}
        </div>

        {categories.length > 1 && (
          <div className="flex gap-1.5 overflow-x-auto min-w-0 pb-1">
            {categories.map((category) => (
              <FilterPill
                key={category}
                active={selectedCategory === category}
                onClick={() => onCategoryChange(category)}
              >
                {category.charAt(0).toUpperCase() + category.slice(1)}
              </FilterPill>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2 gap-3 overflow-y-auto pr-2 auto-rows-min">
        {loadingTemplates ? (
          <div className="col-span-full text-center py-8 text-gray-400 text-sm">
            Loading setups...
          </div>
        ) : filteredTemplates.length === 0 ? (
          <div className="col-span-full text-center py-8 text-gray-400 text-sm">
            No setups match your search.
          </div>
        ) : (
          filteredTemplates.map((template) => (
            <TemplateCard
              key={template.metadata.id}
              template={template}
              validation={templateValidations[template.metadata.id]}
              onOpenDetail={setDetailTemplate}
              community={communityItems?.[template.metadata.id]}
              onLike={onLike}
              likeDisabledReason={likeDisabledReason}
            />
          ))
        )}
      </div>

      <div className="flex justify-between items-center gap-3 pt-3 border-t border-gray-700/60">
        <span className="text-xs text-gray-500">
          {filteredTemplates.length === totalTemplateCount
            ? `${totalTemplateCount} setup${totalTemplateCount === 1 ? '' : 's'}`
            : `${filteredTemplates.length} of ${totalTemplateCount}`}
        </span>
        <div className="flex gap-2">
          {onMineOpen && (
            <Tooltip
              trigger={
                <IconButton
                  intent="gray-outline"
                  size="sm"
                  icon={<UserIcon className="w-4 h-4" />}
                  onClick={onMineOpen}
                />
              }
            >
              My shared templates
            </Tooltip>
          )}
          <Tooltip
            trigger={
              <IconButton
                intent="gray-outline"
                size="sm"
                icon={<BiImport />}
                onClick={onImportOpen}
              />
            }
          >
            Import a template
          </Tooltip>
        </div>
      </div>

      <Drawer
        open={detailTemplate !== null}
        onOpenChange={(o) => {
          if (!o) setDetailTemplate(null);
        }}
        side={isDesktop ? 'right' : 'bottom'}
        size={isDesktop ? 'lg' : 'full'}
        title={detailTemplate?.metadata.name ?? ''}
        contentClass="flex flex-col"
      >
        {detailTemplate && (
          <TemplateDetail
            template={detailTemplate}
            validation={templateValidations[detailTemplate.metadata.id]}
            isLoading={isLoading}
            onLoadTemplate={(t) => {
              setDetailTemplate(null);
              onLoadTemplate(t);
            }}
            onDeleteRequest={onDeleteRequest}
            onShare={onShare}
            shareDisabledReason={shareDisabledReason}
            community={communityItems?.[detailTemplate.metadata.id]}
            onClose={() => setDetailTemplate(null)}
          />
        )}
      </Drawer>
    </>
  );
}
