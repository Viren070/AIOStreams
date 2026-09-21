import React from 'react';
import { StatusResponse, ServiceId, UserData } from '@aiostreams/core';
import {
  PuzzleIcon,
  CloudIcon,
  KeyRoundIcon,
  GitCompareIcon,
} from 'lucide-react';
import { Alert } from '../../../ui/alert';
import { Modal } from '../../../ui/modal';
import { Button } from '../../../ui/button';
import { ServiceLogo } from '../../service-logo';
import { UserDataDiffViewer } from '../../userdata-diff-viewer';
import { templateRequirements } from '@/lib/templates/summary';
import { ProcessedTemplate } from '@/lib/templates/types';

interface ReviewStepProps {
  processedTemplate: ProcessedTemplate;
  selectedServices: string[];
  inputValues: Record<string, string>;
  status: StatusResponse | null;
  currentUserData: UserData | null;
  previewUserData: () => any | null;
}

function Section({
  icon,
  title,
  count,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-gray-700/70 bg-gray-800/40 p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-gray-500">{icon}</span>
        <span className="text-sm font-medium text-white">{title}</span>
        <span className="text-xs text-gray-500">{count}</span>
      </div>
      {children}
    </div>
  );
}

export function ReviewStep({
  processedTemplate,
  selectedServices,
  inputValues,
  status,
  currentUserData,
  previewUserData,
}: ReviewStepProps) {
  const [diffOpen, setDiffOpen] = React.useState(false);
  const { metadata } = processedTemplate.template;

  const preview = diffOpen ? previewUserData() : null;

  const { addons } = templateRequirements(processedTemplate.template);

  const filledCredentials = processedTemplate.inputs.filter((input) =>
    inputValues[input.key]?.trim()
  );

  return (
    <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-3">
      <div className="rounded-lg border border-brand-500/50 bg-brand-500/[0.08] p-4">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="font-semibold text-white">{metadata.name}</span>
          <span className="text-xs text-gray-400">
            v{metadata.version || '1.0.0'} · by {metadata.author}
          </span>
        </div>
      </div>

      {addons.length > 0 && (
        <Section
          icon={<PuzzleIcon className="w-4 h-4" />}
          title="Addons"
          count={addons.length}
        >
          <div className="flex flex-wrap gap-1.5">
            {addons.map((addon: string, i: number) => (
              <span
                key={`${addon}-${i}`}
                className="text-xs bg-gray-700/50 text-gray-300 px-2 py-1 rounded"
              >
                {addon}
              </span>
            ))}
          </div>
        </Section>
      )}

      {selectedServices.length > 0 && (
        <Section
          icon={<CloudIcon className="w-4 h-4" />}
          title="Services"
          count={selectedServices.length}
        >
          <div className="flex flex-wrap gap-2">
            {selectedServices.map((serviceId) => {
              const meta =
                status?.settings?.services?.[
                  serviceId as keyof typeof status.settings.services
                ];
              return (
                <span
                  key={serviceId}
                  className="flex items-center gap-2 text-xs bg-gray-700/50 text-gray-300 pl-1 pr-2.5 py-1 rounded"
                >
                  <ServiceLogo
                    serviceId={serviceId as ServiceId}
                    shortName={meta?.shortName ?? serviceId}
                    className="w-5 h-5 rounded"
                  />
                  {meta?.name ?? serviceId}
                </span>
              );
            })}
          </div>
        </Section>
      )}

      {processedTemplate.inputs.length > 0 && (
        <Section
          icon={<KeyRoundIcon className="w-4 h-4" />}
          title="Credentials"
          count={filledCredentials.length}
        >
          <div className="space-y-1.5">
            {processedTemplate.inputs.map((input) => {
              const filled = !!inputValues[input.key]?.trim();
              return (
                <div
                  key={input.key}
                  className="flex items-center justify-between gap-3 text-xs"
                >
                  <span className="text-gray-400 truncate">{input.label}</span>
                  <span
                    className={
                      filled
                        ? 'text-gray-500 font-mono shrink-0'
                        : 'text-gray-600 italic shrink-0'
                    }
                  >
                    {filled ? '••••••••' : 'not set'}
                  </span>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      <Alert
        intent="info"
        description="Applying this replaces the matching parts of your current configuration. Nothing is saved to your account until you save on the Save & Install page."
      />

      {currentUserData && (
        <>
          <button
            type="button"
            onClick={() => setDiffOpen(true)}
            className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition-colors"
          >
            <GitCompareIcon className="w-4 h-4" />
            See exactly what changes
          </button>

          <Modal
            open={diffOpen}
            onOpenChange={setDiffOpen}
            title="Changes this setup makes"
            description="Your current configuration on the left, the result of applying this setup on the right."
            contentClass="max-w-4xl"
          >
            <div className="space-y-4">
              {preview ? (
                <UserDataDiffViewer
                  oldConfig={currentUserData}
                  newConfig={preview}
                />
              ) : (
                <Alert
                  intent="alert"
                  description="Could not work out the changes for this setup."
                />
              )}
              <div className="flex justify-end pt-2">
                <Button
                  intent="gray-outline"
                  onClick={() => setDiffOpen(false)}
                >
                  Close
                </Button>
              </div>
            </div>
          </Modal>
        </>
      )}
    </div>
  );
}
