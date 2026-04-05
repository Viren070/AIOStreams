'use client';
import React from 'react';
import { Button } from '../../../ui/button';
import { Alert } from '../../../ui/alert';
import { TextInput } from '../../../ui/text-input';
import { PasswordInput } from '../../../ui/password-input';
import MarkdownLite from '../../markdown-lite';
import { ProcessedTemplate, TemplateInput } from '@/lib/templates/types';
import { NNTPServersInput } from '../../template-option';

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

      <form className="space-y-3 flex-1 min-h-0 overflow-y-auto pr-2">
        {processedTemplate.inputs.length === 0 ? (
          <div className="text-center py-4 text-gray-400 text-sm">
            No inputs required for this template
          </div>
        ) : (
          processedTemplate.inputs.map((input) => {
            return (
              <InputRenderer
                key={input.key}
                type={input.type}
                value={inputValues[input.key] || ''}
                onValueChange={(newValue) => {
                  onInputValuesChange((prev) => ({
                    ...prev,
                    [input.key]: newValue,
                  }));
                }}
                label={input.label}
                description={input.description}
                required={input.required}
              />
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

interface InputRendererProps {
  type: TemplateInput['type'];
  value: string;
  onValueChange: (value: string) => void;
  label: string;
  description?: string;
  required?: boolean;
  placeholder?: string;
}

function InputRenderer({
  type,
  value,
  onValueChange,
  label,
  description,
  required,
  placeholder,
}: InputRendererProps) {
  return (
    <>
      {type === 'string' ? (
        <TextInput
          value={value}
          onValueChange={onValueChange}
          label={label}
          required={required}
          placeholder={placeholder}
        />
      ) : type === 'password' ? (
        <PasswordInput
          value={value}
          onValueChange={onValueChange}
          label={label}
          required={required}
          placeholder={placeholder}
        />
      ) : type === 'custom-nntp-servers' ? (
        <NNTPServersInput
          name={label}
          description={description}
          value={value || undefined}
          onChange={(newValue) => onValueChange(newValue || '')}
        />
      ) : null}
      {description && type !== 'custom-nntp-servers' && (
        <MarkdownLite className="text-xs text-[--muted] mt-1">
          {description}
        </MarkdownLite>
      )}
    </>
  );
}
