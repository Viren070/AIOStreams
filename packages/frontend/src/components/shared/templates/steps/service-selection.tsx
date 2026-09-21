import React from 'react';
import { StatusResponse, ServiceId } from '@aiostreams/core';
import { CheckIcon } from 'lucide-react';
import { cn } from '../../../ui/core/styling';
import MarkdownLite from '../../markdown-lite';
import { ServiceLogo } from '../../service-logo';
import { SERVICE_GROUPS, serviceInGroup } from '@/lib/services';
import { ProcessedTemplate } from '@/lib/templates/types';

interface TemplateServiceSelectionStepProps {
  processedTemplate: ProcessedTemplate;
  selectedServices: string[];
  onServicesChange: (updater: (prev: string[]) => string[]) => void;
  status: StatusResponse | null;
  /** Service IDs that already have credentials saved, shown as a hint. */
  configuredServices: string[];
}

export function TemplateServiceSelectionStep({
  processedTemplate,
  selectedServices,
  onServicesChange,
  status,
  configuredServices,
}: TemplateServiceSelectionStepProps) {
  const toggle = (serviceId: string) =>
    onServicesChange((prev) =>
      prev.includes(serviceId)
        ? prev.filter((s) => s !== serviceId)
        : [...prev, serviceId]
    );

  const available = processedTemplate.services.filter(
    (serviceId) =>
      !!status?.settings?.services?.[
        serviceId as keyof typeof status.settings.services
      ]
  );

  const groups = SERVICE_GROUPS.map((group) => ({
    ...group,
    services: available.filter((id) => serviceInGroup(id, group.id)),
  })).filter((group) => group.services.length > 0);

  // A single heading adds noise rather than structure.
  const showHeadings = groups.length > 1;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-4">
      {groups.map((group) => (
        <div key={group.id} className="space-y-2">
          {showHeadings && (
            <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">
              {group.label}
            </div>
          )}
          {group.services.map((serviceId) => {
            const service =
              status!.settings.services[
                serviceId as keyof StatusResponse['settings']['services']
              ]!;
            const isSelected = selectedServices.includes(serviceId);
            const isConfigured = configuredServices.includes(serviceId);

            return (
              <button
                key={serviceId}
                type="button"
                role="checkbox"
                aria-checked={isSelected}
                onClick={() => toggle(serviceId)}
                className={cn(
                  'w-full p-3 rounded-lg border text-left transition-colors flex items-center gap-3',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
                  isSelected
                    ? 'border-brand-500/70 bg-brand-500/10'
                    : 'border-gray-700/70 bg-gray-800/40 hover:border-gray-600 hover:bg-gray-800/70'
                )}
              >
                <span
                  className={cn(
                    'w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-colors',
                    isSelected
                      ? 'bg-brand-500 border-brand-500 text-white'
                      : 'border-gray-600'
                  )}
                >
                  {isSelected && <CheckIcon className="w-3.5 h-3.5" />}
                </span>

                <ServiceLogo
                  serviceId={serviceId as ServiceId}
                  shortName={service.shortName}
                  className="w-8 h-8"
                />

                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-white text-sm">
                      {service.name}
                    </span>
                    {isConfigured && (
                      <span className="text-[10px] leading-none font-medium px-1.5 py-1 rounded bg-gray-700/60 text-gray-400">
                        Already configured
                      </span>
                    )}
                  </span>
                  {service.signUpText && (
                    <MarkdownLite
                      className="block text-xs text-[--muted] mt-0.5 line-clamp-1"
                      stopPropagation
                    >
                      {service.signUpText}
                    </MarkdownLite>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
