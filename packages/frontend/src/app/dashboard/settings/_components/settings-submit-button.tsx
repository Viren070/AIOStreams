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
        'fixed right-4 top-[2rem] z-[50] h-auto w-fit p-4 !mt-0 hidden lg:block rounded-xl bg-[--background] border shadow-2xl animate-in slide-in-from-top-2 duration-300',
        className
      )}
    >
      <div className="flex items-center gap-3">
        <span className="text-sm">You have unsaved changes.</span>
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
