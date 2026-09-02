import React from 'react';
import { StatusResponse, ServiceId } from '@aiostreams/core';
import { TextInput } from '../../../ui/text-input';
import { PasswordInput } from '../../../ui/password-input';
import MarkdownLite from '../../markdown-lite';
import { ServiceLogo } from '../../service-logo';
import { ProcessedTemplate, TemplateInput } from '@/lib/templates/types';
import { NNTPServersInput } from '../../template-option';

interface TemplateCredentialInputsStepProps {
  processedTemplate: ProcessedTemplate;
  inputValues: Record<string, string>;
  onInputValuesChange: React.Dispatch<
    React.SetStateAction<Record<string, string>>
  >;
  status: StatusResponse | null;
}

/** Service id an input writes to, if it is a service credential. */
function serviceIdOf(input: TemplateInput): string | null {
  const paths = Array.isArray(input.path) ? input.path : [input.path];
  const match = paths.find((p) => p.startsWith('services.'));
  return match ? match.split('.')[1] : null;
}

/** Service credentials are already labelled "<Service> - <Field>" by addServiceInputs. */
function stripServicePrefix(label: string): string {
  const idx = label.indexOf(' - ');
  return idx === -1 ? label : label.slice(idx + 3);
}

export function TemplateCredentialInputsStep({
  processedTemplate,
  inputValues,
  onInputValuesChange,
  status,
}: TemplateCredentialInputsStepProps) {
  const groups = React.useMemo(() => {
    const byService = new Map<string | null, TemplateInput[]>();
    for (const input of processedTemplate.inputs) {
      const id = serviceIdOf(input);
      const bucket = byService.get(id);
      if (bucket) bucket.push(input);
      else byService.set(id, [input]);
    }
    // Services first, then anything the template asks for itself.
    return [...byService.entries()].sort(([a], [b]) =>
      a === null ? 1 : b === null ? -1 : 0
    );
  }, [processedTemplate.inputs]);

  if (processedTemplate.inputs.length === 0) {
    return (
      <p className="text-sm text-[--muted] py-6 text-center">
        Nothing to enter for this setup.
      </p>
    );
  }

  return (
    <form className="flex-1 min-h-0 overflow-y-auto pr-2 space-y-5">
      {groups.map(([serviceId, inputs]) => {
        const meta = serviceId
          ? status?.settings?.services?.[
              serviceId as keyof typeof status.settings.services
            ]
          : undefined;

        return (
          <div key={serviceId ?? '__template'} className="space-y-3">
            {serviceId && meta && (
              <div className="flex items-start gap-2.5">
                <ServiceLogo
                  serviceId={serviceId as ServiceId}
                  shortName={meta.shortName}
                  className="w-6 h-6 rounded mt-0.5"
                />
                <div className="min-w-0">
                  <span className="block text-sm font-medium text-white">
                    {meta.name}
                  </span>
                  {meta.signUpText && (
                    <MarkdownLite
                      className="block text-xs text-[--muted] mt-0.5 break-words"
                      stopPropagation
                    >
                      {meta.signUpText}
                    </MarkdownLite>
                  )}
                </div>
              </div>
            )}

            <div
              className={
                serviceId && meta ? 'space-y-3 pl-0 sm:pl-8' : 'space-y-3'
              }
            >
              {inputs.map((input) => (
                <InputRenderer
                  key={input.key}
                  type={input.type}
                  value={inputValues[input.key] || ''}
                  onValueChange={(newValue) =>
                    onInputValuesChange((prev) => ({
                      ...prev,
                      [input.key]: newValue,
                    }))
                  }
                  label={
                    serviceId && meta
                      ? stripServicePrefix(input.label)
                      : input.label
                  }
                  description={input.description}
                  required={input.required}
                />
              ))}
            </div>
          </div>
        );
      })}
    </form>
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
    <div>
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
    </div>
  );
}
