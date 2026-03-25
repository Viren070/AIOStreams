'use client';
import React, { useState, useEffect } from 'react';
import { Option } from '@aiostreams/core';
import { Button } from '../../../ui/button';
import { Modal } from '../../../ui/modal';
import TemplateOption from '../../../shared/template-option';
import MarkdownLite from '../../../shared/markdown-lite';
import { useMode } from '@/context/mode';
import { toast } from 'sonner';

export function AddonModal({
  open,
  onOpenChange,
  mode,
  presetMetadata,
  initialValues = {},
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode: 'add' | 'edit';
  presetMetadata?: any;
  initialValues?: Record<string, any>;
  onSubmit: (values: Record<string, any>) => void;
}) {
  const { mode: configMode } = useMode();
  const [values, setValues] = useState<Record<string, any>>(initialValues);
  useEffect(() => {
    if (open) {
      setValues(initialValues);
    } else {
      // when closing, delay the reset to allow the animation to finish
      // so that the user doesn't see the values being reset
      setTimeout(() => {
        setValues(initialValues);
      }, 150);
    }
  }, [open, initialValues]);
  let dynamicOptions: Option[] = presetMetadata?.OPTIONS || [];
  if (configMode === 'noob') {
    dynamicOptions = dynamicOptions.filter((opt: any) => {
      if (opt?.showInSimpleMode === false) return false;
      if (opt?.advanced === true) return false;
      return true;
    });
  }

  // Check if all required fields are filled
  const allRequiredFilled = dynamicOptions.every((opt: any) => {
    if (!opt.required) return true;
    const val = values.options?.[opt.id];
    // For booleans, false is valid; for others, check for empty string/null/undefined
    if (opt.type === 'boolean') return typeof val === 'boolean';
    return val !== undefined && val !== null && val !== '';
  });

  function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();

    for (const opt of dynamicOptions) {
      if (opt.constraints) {
        const val = values.options?.[opt.id];
        if (typeof val === 'string') {
          if (opt.constraints.min && val.length < opt.constraints.min) {
            toast.error(
              `${opt.name} must be at least ${opt.constraints.min} characters`
            );
            return false;
          }
          if (opt.constraints.max && val.length > opt.constraints.max) {
            toast.error(
              `${opt.name} must be at most ${opt.constraints.max} characters`
            );
            return false;
          }
        } else if (typeof val === 'number') {
          if (opt.constraints.min && val < opt.constraints.min) {
            toast.error(`${opt.name} must be at least ${opt.constraints.min}`);
            return false;
          }
          if (opt.constraints.max && val > opt.constraints.max) {
            toast.error(`${opt.name} must be at most ${opt.constraints.max}`);
            return false;
          }
        } else if (opt.type === 'multi-select') {
          if (opt.constraints.max && val.length > opt.constraints.max) {
            toast.error(
              `${opt.name} must be at most ${opt.constraints.max} items`
            );
            return false;
          }
          if (opt.constraints.min && val.length < opt.constraints.min) {
            toast.error(
              `${opt.name} must be at least ${opt.constraints.min} items`
            );
            return false;
          }
        }
      }
    }
    if (allRequiredFilled) {
      onSubmit(values);
    } else {
      toast.error('Please fill in all required fields');
    }
  }

  return (
    <Modal
      open={open}
      description={<MarkdownLite>{presetMetadata?.DESCRIPTION}</MarkdownLite>}
      onOpenChange={onOpenChange}
      title={
        mode === 'add'
          ? `Install ${presetMetadata?.NAME}`
          : `Edit ${presetMetadata?.NAME}`
      }
    >
      <form className="space-y-4" onSubmit={handleFormSubmit}>
        {dynamicOptions.map((opt: any) => (
          <div key={opt.id} className="mb-2">
            <TemplateOption
              option={opt}
              value={values.options?.[opt.id]}
              onChange={(v: any) =>
                setValues((val) => ({
                  ...val,
                  options: { ...val.options, [opt.id]: v },
                }))
              }
              disabled={false}
            />
          </div>
        ))}
        <Button
          className="w-full mt-2"
          type="submit"
          disabled={!allRequiredFilled}
        >
          {mode === 'add' ? 'Install' : 'Update'}
        </Button>
      </form>
    </Modal>
  );
}
