import React from 'react';
import { motion } from 'framer-motion';
import { CheckIcon } from 'lucide-react';
import { cn } from '../../ui/core/styling';
import { Button } from '../../ui/button';
import { WizardStep, WIZARD_STEP_LABELS } from '@/lib/templates/types';

interface SetupShellProps {
  /** Every step this run will visit, in order. */
  steps: WizardStep[];
  current: WizardStep;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

/**
 * Fixed-size chrome shared by every setup step, so the dialog never resizes
 * between them and the rail always shows how much is left.
 */
export function SetupShell({
  steps,
  current,
  title,
  description,
  children,
  footer,
}: SetupShellProps) {
  const index = steps.indexOf(current);
  const showRail = index !== -1 && steps.length > 1;

  return (
    <div className="flex-1 min-h-0 flex flex-col md:flex-row md:gap-8 min-w-0">
      {showRail && <StepRail steps={steps} index={index} />}

      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        <div className="mb-4 shrink-0 pr-10 md:pr-8">
          <h2 className="text-xl font-semibold text-white">{title}</h2>
          {description && (
            <p className="text-sm text-[--muted] mt-1">{description}</p>
          )}
        </div>

        <motion.div
          key={current}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className="flex-1 min-h-0 flex flex-col gap-3"
        >
          {children}
        </motion.div>

        {footer && (
          <div className="shrink-0 flex items-center justify-between gap-3 pt-4 mt-4 border-t border-gray-700/60">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

function StepRail({ steps, index }: { steps: WizardStep[]; index: number }) {
  return (
    <>
      {/* Desktop: the full list, so the remaining work is visible at a glance. */}
      <nav
        className="hidden md:flex w-44 shrink-0 flex-col"
        aria-label="Setup progress"
      >
        {steps.map((step, i) => {
          const done = i < index;
          const active = i === index;
          return (
            <div key={step} className="flex items-stretch gap-3">
              <div className="flex flex-col items-center">
                <span
                  className={cn(
                    'w-6 h-6 rounded-full border flex items-center justify-center text-[11px] leading-none font-semibold shrink-0 transition-colors',
                    active && 'border-brand-500 bg-brand-500 text-white',
                    done &&
                      'border-brand-500/50 bg-brand-500/20 text-[--brand]',
                    !active && !done && 'border-gray-700 text-gray-500'
                  )}
                >
                  {done ? <CheckIcon className="w-3.5 h-3.5" /> : i + 1}
                </span>
                {i < steps.length - 1 && (
                  <span
                    className={cn(
                      'w-px flex-1 min-h-5 my-1',
                      done ? 'bg-brand-500/60' : 'bg-gray-700/70'
                    )}
                  />
                )}
              </div>
              <span
                className={cn(
                  'text-sm pb-5 -mt-0.5 leading-6 transition-colors',
                  active ? 'text-white font-medium' : 'text-gray-500'
                )}
              >
                {WIZARD_STEP_LABELS[step]}
              </span>
            </div>
          );
        })}
      </nav>

      {/* Mobile: a bar plus the count, which is the part that actually matters. */}
      <div className="md:hidden mb-4 pr-10">
        <div className="flex items-center justify-between gap-3 mb-1.5">
          <span className="text-xs font-medium text-white">
            {WIZARD_STEP_LABELS[steps[index]]}
          </span>
          <span className="text-xs text-gray-500">
            Step {index + 1} of {steps.length}
          </span>
        </div>
        <div className="h-1 rounded-full bg-gray-700/70 overflow-hidden">
          <motion.div
            className="h-full bg-brand-500"
            initial={false}
            animate={{ width: `${((index + 1) / steps.length) * 100}%` }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
          />
        </div>
      </div>
    </>
  );
}

/** Back on the left, primary on the right, with an optional tertiary skip. */
export function SetupFooter({
  onBack,
  backLabel = 'Back',
  onSkip,
  skipLabel = 'Skip',
  primary,
}: {
  onBack?: () => void;
  backLabel?: string;
  onSkip?: () => void;
  skipLabel?: string;
  primary?: React.ReactNode;
}) {
  return (
    <>
      <div>
        {onBack && (
          <Button intent="gray-subtle" size="sm" onClick={onBack}>
            {backLabel}
          </Button>
        )}
      </div>
      <div className="flex items-center gap-4">
        {onSkip && (
          <button
            type="button"
            onClick={onSkip}
            className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
          >
            {skipLabel}
          </button>
        )}
        {primary}
      </div>
    </>
  );
}
