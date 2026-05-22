import React from 'react';
import { useFormContext, useFormState } from 'react-hook-form';
import { FiRotateCcw, FiSave } from 'react-icons/fi';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { cn } from '@/components/ui/core/styling';

/**
 * Ported 1:1 from seanime's `settings-submit-button.tsx`, minus jotai — dirty
 * state comes straight from `useFormState()` so no cross-component atom is
 * needed (each tab has its own <Form>).
 */

export function SettingsSubmitButton({ isPending }: { isPending: boolean }) {
  const { isDirty } = useFormState();
  return (
    <Field.Submit
      role="save"
      size="md"
      className={cn('text-md group', isDirty && 'animate-pulse')}
      intent="primary"
      rounded
      loading={isPending}
      leftIcon={<FiSave />}
    >
      Save
    </Field.Submit>
  );
}

export function SettingsIsDirty({
  isPending,
  className,
}: {
  isPending?: boolean;
  className?: string;
}) {
  const { isDirty, isSubmitting, isValidating } = useFormState();
  const { reset } = useFormContext();
  if (!isDirty) return null;
  return (
    <Alert
      intent="info"
      className={cn(
        'fixed z-[50] h-auto p-4 !mt-0 rounded-xl bg-[--background] border shadow-2xl',
        'inset-x-4 bottom-4 w-auto animate-in slide-in-from-bottom-4 duration-300',
        'lg:inset-x-auto lg:bottom-auto lg:right-4 lg:top-[2rem] lg:w-fit',
        'lg:slide-in-from-top-2',
        className
      )}
    >
      <div className="flex items-center gap-3">
        <span className="flex-1 text-sm lg:flex-none">
          You have unsaved changes.
        </span>
        <Button
          size="sm"
          intent="gray-link"
          onClick={() => reset()}
          leftIcon={<FiRotateCcw />}
        >
          Reset
        </Button>
        <Field.Submit
          role="save"
          size="sm"
          intent="primary-link"
          disabled={isSubmitting || isValidating}
          loading={isPending}
          leftIcon={<FiSave />}
        >
          Save
        </Field.Submit>
      </div>
    </Alert>
  );
}
