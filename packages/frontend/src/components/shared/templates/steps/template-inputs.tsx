'use client';
import React from 'react';
import { Option } from '@aiostreams/core';
import { Button } from '../../../ui/button';
import { ModeSwitch } from '../../../ui/mode-switch/mode-switch';
import TemplateOption from '../../template-option';
import { Mode } from '@/context/mode';
import { evaluateTemplateCondition } from '@/lib/templates/processors/conditionals';

interface TemplateInputsStepProps {
  mode: Mode;
  onModeChange: (m: Mode) => void;
  options: Option[];
  values: Record<string, any>;
  onValuesChange: React.Dispatch<React.SetStateAction<Record<string, any>>>;
  trusted: boolean;
  selectedServices: string[];
  onBack: () => void;
  onNext: () => void;
}

export function TemplateInputsStep({
  mode,
  onModeChange,
  options,
  values,
  onValuesChange,
  trusted,
  selectedServices,
  onBack,
  onNext,
}: TemplateInputsStepProps) {
  const visibleOptions = (
    mode === 'noob'
      ? options.filter(
          (opt) => opt.advanced !== true && opt.showInSimpleMode !== false
        )
      : options
  ).filter((opt) =>
    (opt as any).__if
      ? evaluateTemplateCondition((opt as any).__if, values, selectedServices)
      : true
  );

  return (
    <>
      <ModeSwitch
        value={mode}
        onChange={onModeChange}
        size="sm"
        className="w-full"
      />

      <div className="space-y-3 max-h-[400px] overflow-y-auto pr-3">
        {visibleOptions.length === 0 ? (
          <div className="text-center py-6 text-gray-400 text-sm">
            No options available in simple mode. Switch to Advanced to see all
            options.
          </div>
        ) : (
          visibleOptions.map((opt) => (
            <TemplateOption
              key={opt.id}
              option={opt}
              value={values[opt.id] ?? opt.default}
              trusted={trusted}
              onChange={(v) =>
                onValuesChange((prev) => ({ ...prev, [opt.id]: v }))
              }
            />
          ))
        )}
      </div>

      <div className="flex justify-between gap-2 pt-2 border-t border-gray-700">
        <Button intent="primary-outline" onClick={onBack}>
          Back
        </Button>
        <Button intent="white" rounded onClick={onNext}>
          Next
        </Button>
      </div>
    </>
  );
}
