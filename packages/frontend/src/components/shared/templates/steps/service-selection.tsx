'use client';
import React from 'react';
import { StatusResponse } from '@aiostreams/core';
import { CheckIcon } from 'lucide-react';
import { Button } from '../../../ui/button';
import { Alert } from '../../../ui/alert';
import MarkdownLite from '../../markdown-lite';
import { ProcessedTemplate } from '@/lib/templates/types';

interface TemplateServiceSelectionStepProps {
  processedTemplate: ProcessedTemplate;
  selectedServices: string[];
  onServicesChange: (updater: (prev: string[]) => string[]) => void;
  onBack: () => void;
  onSkip: () => void;
  onNext: () => void;
  status: StatusResponse | null;
}

export function TemplateServiceSelectionStep({
  processedTemplate,
  selectedServices,
  onServicesChange,
  onBack,
  onSkip,
  onNext,
  status,
}: TemplateServiceSelectionStepProps) {
  return (
    <>
      <Alert
        intent="info"
        description={
          processedTemplate.allowSkipService
            ? 'Select the services you want to use with this template. You can skip this step if services are not needed.'
            : 'Select the services you want to use with this template.'
        }
      />

      <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
        {processedTemplate.services.map((serviceId) => {
          const service =
            status?.settings?.services?.[
              serviceId as keyof typeof status.settings.services
            ];
          if (!service) return null;

          const isSelected = selectedServices.includes(serviceId);
          return (
            <button
              key={serviceId}
              onClick={() => {
                onServicesChange((prev) =>
                  prev.includes(serviceId)
                    ? prev.filter((s) => s !== serviceId)
                    : [...prev, serviceId]
                );
              }}
              className={`w-full p-3 rounded-lg border-2 text-left transition-colors ${
                isSelected
                  ? 'border-[--brand] bg-brand-400/20'
                  : 'border-gray-700 bg-gray-800/50 hover:border-gray-600'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="font-semibold text-white">{service.name}</div>
                  {service.signUpText && (
                    <MarkdownLite
                      className="text-sm text-[--muted] mt-1"
                      stopPropagation
                    >
                      {service.signUpText}
                    </MarkdownLite>
                  )}
                </div>
                {isSelected && (
                  <CheckIcon className="w-5 h-5 text-[--brand] flex-shrink-0 ml-2" />
                )}
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex justify-between gap-2 pt-2 border-t border-gray-700">
        <Button intent="primary-outline" onClick={onBack}>
          Back
        </Button>
        <div className="flex gap-2">
          {processedTemplate.allowSkipService && (
            <Button intent="gray-outline" onClick={onSkip}>
              Skip
            </Button>
          )}
          <Button
            intent="white"
            rounded
            onClick={onNext}
            disabled={
              !processedTemplate.allowSkipService &&
              selectedServices.length === 0
            }
          >
            Next
          </Button>
        </div>
      </div>
    </>
  );
}
