import React from 'react';
import {
  LayoutTemplateIcon,
  SlidersHorizontalIcon,
  KeyRoundIcon,
} from 'lucide-react';
import { cn } from '../../../ui/core/styling';

interface ChoiceProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  meta?: string;
  recommended?: boolean;
  onClick: () => void;
}

function Choice({
  icon,
  title,
  description,
  meta,
  recommended,
  onClick,
}: ChoiceProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group w-full text-left rounded-xl border p-4 flex items-start gap-4 transition-all',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
        recommended
          ? 'border-brand-500/60 bg-brand-500/[0.08] hover:border-brand-500 hover:bg-brand-500/[0.14]'
          : 'border-gray-700/70 bg-gray-800/40 hover:border-gray-600 hover:bg-gray-800/70'
      )}
    >
      <span
        className={cn(
          'shrink-0 w-10 h-10 rounded-lg flex items-center justify-center transition-colors',
          recommended
            ? 'bg-brand-500/20 text-[--brand]'
            : 'bg-gray-700/50 text-gray-400 group-hover:text-gray-300'
        )}
      >
        {icon}
      </span>
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-white">{title}</span>
          {recommended && (
            <span className="text-[10px] leading-none font-medium uppercase tracking-wider px-1.5 py-1 rounded bg-brand-500/20 text-[--brand]">
              Recommended
            </span>
          )}
        </span>
        <span className="block text-sm text-[--muted] mt-1">{description}</span>
        {meta && (
          <span className="block text-xs text-gray-500 mt-1.5">{meta}</span>
        )}
      </span>
    </button>
  );
}

interface WelcomeStepProps {
  onUseTemplate: () => void;
  onStartFresh: () => void;
  onSignIn?: () => void;
  /** Name of the featured template, shown so the fast path is concrete. */
  recommendedTemplateName?: string;
  templateCount: number;
  hasExistingConfig: boolean;
}

export function WelcomeStep({
  onUseTemplate,
  onStartFresh,
  onSignIn,
  recommendedTemplateName,
  templateCount,
  hasExistingConfig,
}: WelcomeStepProps) {
  return (
    <div className="flex flex-col gap-3">
      <Choice
        recommended
        icon={<LayoutTemplateIcon className="w-5 h-5" />}
        title="Use a ready-made setup"
        description={
          hasExistingConfig
            ? 'Apply a prepared configuration on top of your current one. You can still change everything afterwards.'
            : 'Start from a configuration someone has already put together. The quickest way to a working addon.'
        }
        meta={
          recommendedTemplateName
            ? `Starting with ${recommendedTemplateName} · ${templateCount} available`
            : templateCount > 0
              ? `${templateCount} available`
              : undefined
        }
        onClick={onUseTemplate}
      />

      <Choice
        icon={<SlidersHorizontalIcon className="w-5 h-5" />}
        title={hasExistingConfig ? 'Keep configuring' : 'Set it up myself'}
        description={
          hasExistingConfig
            ? 'Carry on where you left off and adjust each section by hand.'
            : 'Start from an empty configuration and choose every addon, filter and service yourself.'
        }
        onClick={onStartFresh}
      />

      {onSignIn && (
        <Choice
          icon={<KeyRoundIcon className="w-5 h-5" />}
          title="I already have a configuration"
          description="Load an existing setup with its UUID and password."
          onClick={onSignIn}
        />
      )}
    </div>
  );
}
