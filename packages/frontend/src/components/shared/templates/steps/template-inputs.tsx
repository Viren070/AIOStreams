import React from 'react';
import { Option } from '@aiostreams/core';
import { ChevronDownIcon } from 'lucide-react';
import { cn } from '../../../ui/core/styling';
import TemplateOption from '../../template-option';
import { getVisibleOptions } from '@/lib/templates/processors';

interface TemplateInputsStepProps {
  options: Option[];
  values: Record<string, any>;
  onValuesChange: React.Dispatch<React.SetStateAction<Record<string, any>>>;
  trusted: boolean;
  selectedServices: string[];
}

export function TemplateInputsStep({
  options,
  values,
  onValuesChange,
  trusted,
  selectedServices,
}: TemplateInputsStepProps) {
  const [showAdvanced, setShowAdvanced] = React.useState(false);

  const simpleOptions = getVisibleOptions(
    'noob',
    options,
    values,
    selectedServices
  );
  const allOptions = getVisibleOptions(
    'pro',
    options,
    values,
    selectedServices
  );

  const simpleIds = new Set(simpleOptions.map((o) => o.id));
  const advancedOptions = allOptions.filter((o) => !simpleIds.has(o.id));

  const render = (opt: Option) => (
    <TemplateOption
      key={opt.id}
      option={opt}
      value={values[opt.id] ?? opt.default}
      trusted={trusted}
      onChange={(v) => onValuesChange((prev) => ({ ...prev, [opt.id]: v }))}
    />
  );

  // Everything this template asks is advanced, so there is nothing to hide behind.
  const advancedOnly = simpleOptions.length === 0 && advancedOptions.length > 0;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto pr-2 space-y-3">
      {allOptions.length === 0 ? (
        <p className="text-sm text-[--muted] py-6 text-center">
          This setup has no options to configure.
        </p>
      ) : (
        <>
          {simpleOptions.map(render)}

          {advancedOptions.length > 0 && (
            <div className="pt-1">
              {!advancedOnly && (
                <button
                  type="button"
                  onClick={() => setShowAdvanced((v) => !v)}
                  className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition-colors"
                >
                  <ChevronDownIcon
                    className={cn(
                      'w-4 h-4 transition-transform',
                      showAdvanced && 'rotate-180'
                    )}
                  />
                  {showAdvanced ? 'Hide' : 'Show'} {advancedOptions.length}{' '}
                  advanced option{advancedOptions.length === 1 ? '' : 's'}
                </button>
              )}
              {(showAdvanced || advancedOnly) && (
                <div className="space-y-3 mt-3">
                  {advancedOptions.map(render)}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
