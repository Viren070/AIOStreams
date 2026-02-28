'use client';
import React from 'react';
import { Button } from '../../../ui/button';
import { Alert } from '../../../ui/alert';
import { TextInput } from '../../../ui/text-input';
import { PasswordInput } from '../../../ui/password-input';
import MarkdownLite from '../../markdown-lite';
import { ProcessedTemplate } from '@/lib/templates/types';

interface TemplateCredentialInputsStepProps {
  processedTemplate: ProcessedTemplate;
  inputValues: Record<string, string>;
  onInputValuesChange: React.Dispatch<
    React.SetStateAction<Record<string, string>>
  >;
  isLoading: boolean;
  onBack: () => void;
  onConfirm: () => void;
}

export function TemplateCredentialInputsStep({
  processedTemplate,
  inputValues,
  onInputValuesChange,
  isLoading,
  onBack,
  onConfirm,
}: TemplateCredentialInputsStepProps) {
  return (
    <>
      <Alert
        intent="info"
        description="Enter your API keys and credentials below. Some addons may require additional setup in the Addons section after loading."
      />

      <form className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
        {processedTemplate.inputs.length === 0 ? (
          <div className="text-center py-4 text-gray-400 text-sm">
            No inputs required for this template
          </div>
        ) : (
          processedTemplate.inputs.map((input) => {
            const props = {
              label: input.label,
              value: inputValues[input.key] || '',
              placeholder: `Enter ${input.label}...`,
              onValueChange: (newValue: string) => {
                onInputValuesChange((prev) => ({
                  ...prev,
                  [input.key]: newValue,
                }));
              },
              required: input.required,
            };
            return (
              <React.Fragment key={input.key}>
                {input.type === 'string' ? (
                  <TextInput {...props} />
                ) : (
                  <PasswordInput {...props} />
                )}
                {input.description && (
                  <MarkdownLite className="text-xs text-[--muted] mt-1">
                    {input.description}
                  </MarkdownLite>
                )}
              </React.Fragment>
            );
          })
        )}
      </form>

      <div className="flex justify-between gap-2 pt-2 border-t border-gray-700">
        <Button intent="primary-outline" onClick={onBack}>
          Back
        </Button>
        <Button
          intent="white"
          rounded
          onClick={onConfirm}
          loading={isLoading}
          disabled={processedTemplate.inputs.some(
            (input) => input.required && !inputValues[input.key]?.trim()
          )}
        >
          Load Template
        </Button>
      </div>
    </>
  );
}
