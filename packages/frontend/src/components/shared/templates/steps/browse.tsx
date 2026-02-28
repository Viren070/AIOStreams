'use client';
import React, { useState, useRef, useEffect } from 'react';
import { Template } from '@aiostreams/core';
import {
  SearchIcon,
  AlertTriangleIcon,
  Trash2Icon,
  CheckIcon,
} from 'lucide-react';
import { BiImport } from 'react-icons/bi';
import { Button, IconButton } from '../../../ui/button';
import { TextInput } from '../../../ui/text-input';
import { Tooltip } from '../../../ui/tooltip';
import { Modal } from '../../../ui/modal';
import { cn } from '../../../ui/core/styling';
import MarkdownLite from '../../markdown-lite';
import * as constants from '../../../../../../core/src/utils/constants';
import { asConfigArray } from '@/lib/templates/processors/conditionals';
import { TemplateValidation } from '@/lib/templates/types';
import { TemplateValidationModal } from '../validation-modal';
import { GlowCard } from '../../glow-card';

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
  loadingTemplates: boolean;
  templateValidations: Record<string, TemplateValidation>;
  isLoading: boolean;
  onLoadTemplate: (t: Template) => void;
  onImportOpen: () => void;
  onDeleteRequest: (t: Template) => void;
  totalTemplateCount: number;
}

interface TemplateCardProps {
  template: Template;
  validation: TemplateValidation | undefined;
  isLoading: boolean;
  onLoadTemplate: (t: Template) => void;
  onDeleteRequest: (t: Template) => void;
  onReadMore: (t: Template) => void;
}

function TemplateCard({
  template,
  validation,
  isLoading,
  onLoadTemplate,
  onDeleteRequest,
  onReadMore,
}: TemplateCardProps) {
  const descRef = useRef<HTMLDivElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const [showAddonsModal, setShowAddonsModal] = useState(false);

  const hasWarnings = validation && validation.warnings.length > 0;
  const hasErrors = validation && validation.errors.length > 0;

  const addons = asConfigArray(template.config?.presets)
    .map((preset: any) => preset.options?.name)
    .filter((name: any) => typeof name === 'string');

  // Detect text overflow; re-check when description changes or container resizes
  useEffect(() => {
    const el = descRef.current;
    if (!el) return;
    const check = () => setIsOverflowing(el.scrollHeight > el.clientHeight);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [template.metadata.description]);

  return (
    <>
      <GlowCard
        glowSize="350px"
        glowOpacity={0.08}
        transitionDuration="0.3s"
        className="flex flex-col bg-gray-900 border-gray-800 hover:border-gray-600 transition-colors duration-200 rounded-lg p-4"
      >
        <div className="flex items-start gap-2 mb-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-base font-semibold text-white truncate">
                {template.metadata.name}
              </h3>
              <span className="text-[10px] text-gray-400 bg-gray-800 px-1.5 py-0.5 rounded flex-shrink-0">
                v{template.metadata.version || '1.0.0'}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {template.metadata.source === 'builtin' && (
              <span className="text-xs bg-brand-500/20 text-brand-300 px-2 py-0.5 rounded border border-brand-500/30">
                Built-in
              </span>
            )}
            {template.metadata.source === 'custom' && (
              <span className="text-xs bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded border border-purple-500/30">
                Custom
              </span>
            )}
            {template.metadata.source === 'external' && (
              <span className="text-xs bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded border border-emerald-500/30">
                External
              </span>
            )}
            {(hasWarnings || hasErrors) && (
              <button
                onClick={() => setShowValidation(true)}
                title="View validation issues"
                className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${
                  hasErrors
                    ? 'text-red-400 hover:bg-red-950/40'
                    : 'text-yellow-400 hover:bg-yellow-950/40'
                }`}
              >
                <AlertTriangleIcon className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        <div className="mb-3">
          <div
            ref={descRef}
            className="overflow-hidden max-h-[10rem] text-sm text-gray-400"
            style={
              isOverflowing
                ? {
                    WebkitMaskImage:
                      'linear-gradient(to bottom, black 60%, transparent 100%)',
                    maskImage:
                      'linear-gradient(to bottom, black 60%, transparent 100%)',
                  }
                : undefined
            }
          >
            <MarkdownLite>{template.metadata.description}</MarkdownLite>
          </div>
          {isOverflowing && (
            <button
              onClick={() => onReadMore(template)}
              className="mt-2 w-full text-center text-xs text-gray-500 hover:text-[--brand] transition-colors font-medium py-1  rounded hover:border-gray-700 hover:bg-gray-900/50"
            >
              Read full description ↓
            </button>
          )}
        </div>

        <div className="flex-1 space-y-3">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-gray-500 text-xs mb-1.5">Category</div>
              <span className="text-xs bg-gray-800/60 text-gray-300 px-2 py-1 rounded inline-block">
                {template.metadata.category}
              </span>
            </div>
            <div>
              <div className="text-gray-500 text-xs mb-1.5">Author</div>
              <span className="text-xs text-gray-300">
                {template.metadata.author}
              </span>
            </div>
          </div>

          {addons.length > 0 && (
            <div>
              <div className="text-gray-500 text-xs mb-1.5">Addons</div>
              <div className="flex flex-wrap gap-1.5">
                {addons.slice(0, 5).map((addon) => (
                  <span
                    key={addon}
                    className="text-xs bg-blue-600/30 text-blue-300 px-2 py-0.5 rounded"
                  >
                    {addon}
                  </span>
                ))}
                {addons.length > 5 && (
                  <button
                    onClick={() => setShowAddonsModal(true)}
                    className="text-xs bg-blue-600/30 text-blue-300 px-2 py-0.5 rounded hover:bg-blue-600/50 transition-colors"
                  >
                    +{addons.length - 5} more
                  </button>
                )}
              </div>
            </div>
          )}

          {template.metadata.services &&
            template.metadata.services.length > 0 && (
              <div>
                <div className="text-gray-500 text-xs mb-1.5">Services</div>
                <div className="flex flex-wrap gap-1.5">
                  {template.metadata.services.map((service) => (
                    <span
                      key={service}
                      className="text-xs bg-green-600/30 text-green-300 px-2 py-0.5 rounded"
                    >
                      {constants.SERVICE_DETAILS[
                        service as keyof typeof constants.SERVICE_DETAILS
                      ]?.name || service}
                    </span>
                  ))}
                </div>
              </div>
            )}
        </div>

        <div className="flex gap-2 mt-4 pt-3 border-t border-gray-800/80">
          {template.metadata.source === 'external' && (
            <IconButton
              icon={<Trash2Icon className="w-4 h-4" />}
              intent="alert-outline"
              onClick={(e) => {
                e.stopPropagation();
                onDeleteRequest(template);
              }}
            />
          )}
          <Button
            intent="primary"
            size="md"
            leftIcon={<CheckIcon className="w-4 h-4" />}
            onClick={() => onLoadTemplate(template)}
            loading={isLoading}
            className="flex-1"
          >
            Load Template
          </Button>
        </div>
      </GlowCard>

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

      <Modal
        open={showAddonsModal}
        onOpenChange={(o) => !o && setShowAddonsModal(false)}
        title={`Addons — ${template.metadata.name}`}
      >
        <div className="flex flex-wrap gap-2 py-1">
          {addons.map((addon) => (
            <span
              key={addon}
              className="text-sm bg-blue-600/30 text-blue-300 px-3 py-1 rounded"
            >
              {addon}
            </span>
          ))}
        </div>
      </Modal>
    </>
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
  loadingTemplates,
  templateValidations,
  isLoading,
  onLoadTemplate,
  onImportOpen,
  onDeleteRequest,
  totalTemplateCount,
}: TemplateBrowseStepProps) {
  const [expandedTemplate, setExpandedTemplate] = useState<Template | null>(
    null
  );

  return (
    <>
      <div className="space-y-3 min-w-0">
        <TextInput
          placeholder="Search templates..."
          value={searchQuery}
          onValueChange={onSearchChange}
          leftIcon={<SearchIcon className="w-4 h-4" />}
        />

        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm text-gray-400 flex-shrink-0">Source:</span>
          <div className="flex gap-1.5 overflow-x-auto min-w-0 flex-1 pb-2">
            {sources.map((source: string) => {
              const sourceDescription: Record<string, string> = {
                all: 'All sources',
                builtin: 'Provided with AIOStreams',
                custom: 'Added by the instance hoster',
                external: 'Imported by you',
              };
              const colorClasses: Record<string, string> = {
                all: 'bg-gray-700/50 text-gray-300 hover:bg-gray-700',
                builtin:
                  selectedSource === 'builtin'
                    ? 'bg-brand-500/20 text-brand-300 border border-brand-500/30'
                    : 'bg-brand-500/10 text-brand-400 hover:bg-brand-500/20 border border-brand-500/20',
                custom:
                  selectedSource === 'custom'
                    ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                    : 'bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 border border-purple-500/20',
                external:
                  selectedSource === 'external'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20',
              };
              const tooltipColorClasses: Record<string, string> = {
                all: 'bg-gray-800 text-white border-gray-700',
                builtin: 'bg-brand-600 text-white border-brand-500',
                custom: 'bg-purple-600 text-white border-purple-500',
                external: 'bg-emerald-600 text-white border-emerald-500',
              };
              return (
                <Tooltip
                  key={source}
                  className={cn('mb-2', tooltipColorClasses[source])}
                  trigger={
                    <button
                      onClick={() => onSourceChange(source)}
                      className={`px-3 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap flex-shrink-0 ${
                        selectedSource === source && source === 'all'
                          ? 'bg-gray-600 text-white'
                          : colorClasses[source]
                      }`}
                    >
                      {source.charAt(0).toUpperCase() + source.slice(1)}
                    </button>
                  }
                >
                  {sourceDescription[source]}
                </Tooltip>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm text-gray-400 flex-shrink-0">Category:</span>
          <div className="flex gap-1.5 overflow-x-auto min-w-0 flex-1 pb-2">
            {categories.map((category) => (
              <Button
                key={category}
                intent={
                  selectedCategory === category ? 'primary' : 'gray-outline'
                }
                size="sm"
                onClick={() => onCategoryChange(category)}
                className="whitespace-nowrap flex-shrink-0"
              >
                {category.charAt(0).toUpperCase() + category.slice(1)}
              </Button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[640px] overflow-y-auto pr-2">
        {loadingTemplates ? (
          <div className="col-span-2 text-center py-8 text-gray-400">
            Loading templates...
          </div>
        ) : filteredTemplates.length === 0 ? (
          <div className="col-span-2 text-center py-8 text-gray-400">
            No templates found matching your search
          </div>
        ) : (
          filteredTemplates.map((template) => (
            <TemplateCard
              key={template.metadata.id}
              template={template}
              validation={templateValidations[template.metadata.id]}
              isLoading={isLoading}
              onLoadTemplate={onLoadTemplate}
              onDeleteRequest={onDeleteRequest}
              onReadMore={setExpandedTemplate}
            />
          ))
        )}
      </div>

      <div className="flex justify-between items-center pt-2 border-t border-gray-700">
        <div className="text-sm text-gray-400">
          {totalTemplateCount} template
          {totalTemplateCount !== 1 ? 's' : ''} available
        </div>
        <div className="flex gap-2">
          <Tooltip
            trigger={
              <IconButton
                intent="primary-outline"
                icon={<BiImport />}
                onClick={onImportOpen}
              />
            }
          >
            Import Template
          </Tooltip>
        </div>
      </div>

      <Modal
        open={expandedTemplate !== null}
        onOpenChange={(o) => {
          if (!o) setExpandedTemplate(null);
        }}
        title={expandedTemplate?.metadata.name ?? ''}
        contentClass="max-w-2xl"
      >
        {expandedTemplate && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs bg-gray-800 text-gray-300 px-2 py-1 rounded">
                v{expandedTemplate.metadata.version || '1.0.0'}
              </span>
              <span className="text-xs text-gray-400">
                by {expandedTemplate.metadata.author}
              </span>
              <span className="text-xs bg-gray-800/60 text-gray-300 px-2 py-1 rounded">
                {expandedTemplate.metadata.category}
              </span>
              {expandedTemplate.metadata.source === 'builtin' && (
                <span className="text-xs bg-brand-500/20 text-brand-300 px-2 py-0.5 rounded border border-brand-500/30">
                  Built-in
                </span>
              )}
              {expandedTemplate.metadata.source === 'custom' && (
                <span className="text-xs bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded border border-purple-500/30">
                  Custom
                </span>
              )}
              {expandedTemplate.metadata.source === 'external' && (
                <span className="text-xs bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded border border-emerald-500/30">
                  External
                </span>
              )}
            </div>
            <div className="max-h-[55vh] overflow-y-auto pr-1">
              <MarkdownLite className="text-sm text-gray-300 [&_a]:text-[--brand] [&_a:hover]:underline [&_ul]:list-disc [&_ul]:pl-4 [&_li]:mb-0.5">
                {expandedTemplate.metadata.description}
              </MarkdownLite>
            </div>
            <div className="flex justify-end pt-2 border-t border-gray-700">
              <Button
                intent="primary"
                leftIcon={<CheckIcon className="w-4 h-4" />}
                onClick={() => {
                  onLoadTemplate(expandedTemplate);
                  setExpandedTemplate(null);
                }}
                loading={isLoading}
              >
                Load Template
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
