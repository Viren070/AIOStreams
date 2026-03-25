'use client';
import React, { useState } from 'react';
import { Button } from '../../../ui/button';
import { Modal } from '../../../ui/modal';
import { Popover } from '../../../ui/popover';
import { Tooltip } from '../../../ui/tooltip';
import { Alert } from '../../../ui/alert';
import MarkdownLite from '../../../shared/markdown-lite';
import { PlusIcon } from 'lucide-react';
import * as constants from '../../../../../../core/src/utils/constants';

export function AddonCard({
  preset,
  onAdd,
}: {
  preset: any;
  onAdd: () => void;
}) {
  const [showBuiltinModal, setShowBuiltinModal] = useState(false);

  return (
    <>
      <div className="border border-[rgb(255_255_255_/_5%)] relative overflow-hidden bg-gray-900/70 rounded-xl p-3 flex flex-col h-full">
        {/* Built-in ribbon - top-right */}
        {preset.BUILTIN && (
          <div
            className="absolute -right-[30px] top-[20px] bg-[rgb(var(--color-brand-500))] text-white text-xs font-semibold py-1 w-[120px] text-center transform rotate-45 shadow-md z-[2] cursor-pointer hover:bg-[rgb(var(--color-brand-600))] transition-colors"
            onClick={() => setShowBuiltinModal(true)}
            title="Click to learn more about built-in addons"
          >
            Built-in
          </div>
        )}

        <div className="z-[1] relative flex flex-col flex-1 gap-3">
          {/* Logo and Name */}
          <div className="flex gap-3 pr-16">
            {preset.ID === 'custom' ? (
              <div className="relative rounded-md size-12 bg-gray-950 overflow-hidden flex items-center justify-center">
                <PlusIcon className="w-6 h-6 text-[--brand]" />
              </div>
            ) : preset.LOGO ? (
              <div className="relative rounded-md size-12 bg-gray-900 overflow-hidden">
                <img
                  src={preset.LOGO}
                  alt={preset.NAME}
                  className="w-full h-full object-cover"
                />
              </div>
            ) : (
              <div className="relative rounded-md size-12 bg-gray-950 overflow-hidden flex items-center justify-center">
                <p className="text-2xl font-bold">
                  {preset.NAME[0].toUpperCase()}
                </p>
              </div>
            )}

            <div>
              <p className="font-semibold line-clamp-1">{preset.NAME}</p>
              <p className="text-xs line-clamp-1 tracking-wide opacity-30">
                {preset.ID}
              </p>
            </div>
          </div>

          {/* Description */}
          {preset.DESCRIPTION && (
            <Popover
              trigger={
                <p className="text-sm text-[--muted] line-clamp-2 cursor-pointer">
                  <MarkdownLite>{preset.DESCRIPTION}</MarkdownLite>
                </p>
              }
            >
              <p className="text-sm">
                <MarkdownLite>{preset.DESCRIPTION}</MarkdownLite>
              </p>
            </Popover>
          )}

          <div className="flex flex-wrap gap-1.5">
            {preset.SUPPORTED_SERVICES?.map((sid: string) => {
              const service =
                constants.SERVICE_DETAILS[
                  sid as keyof typeof constants.SERVICE_DETAILS
                ];
              return (
                <Tooltip
                  key={sid}
                  side="top"
                  trigger={
                    <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-[--brand]/10 text-[--brand] border border-[--brand]/20">
                      {service?.shortName || sid}
                    </span>
                  }
                >
                  {service?.name || sid}
                </Tooltip>
              );
            })}
            {preset.SUPPORTED_RESOURCES?.map((res: string) => (
              <span
                key={res}
                className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20"
              >
                {res}
              </span>
            ))}
            {preset.SUPPORTED_STREAM_TYPES?.map((type: string) => (
              <span
                key={type}
                className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-green-500/10 text-green-400 border border-green-500/20"
              >
                {type}
              </span>
            ))}
          </div>

          {/* Spacer to push button to bottom */}
          <div className="flex-1"></div>

          {preset.DISABLED ? (
            <div className="mt-auto">
              <Alert
                intent="alert"
                className="w-full overflow-x-auto whitespace-nowrap"
                description={
                  <MarkdownLite>{preset.DISABLED.reason}</MarkdownLite>
                }
              />
            </div>
          ) : (
            <div className="mt-auto">
              <Button
                size="md"
                className="w-full"
                intent="primary-subtle"
                onClick={onAdd}
              >
                Configure
              </Button>
            </div>
          )}
        </div>
      </div>

      <Modal
        open={showBuiltinModal}
        onOpenChange={setShowBuiltinModal}
        title="What are Built-in Addons?"
      >
        <div className="space-y-4">
          <p className="text-sm leading-relaxed">
            Built-in addons are addons whose code lives directly inside
            AIOStreams. You still install and configure them from the
            marketplace just like any other addon (such as Comet or Torrentio),
            but they run locally on this AIOStreams instance.
          </p>
          <div className="bg-[--subtle] rounded-lg p-3 space-y-2">
            <p className="text-sm font-medium">Why does this matter?</p>
            <ul className="text-sm text-[--muted] space-y-1.5 list-disc list-inside">
              <li>Not affected by rate limits from other addon servers</li>
              <li>Faster response times since there's no network delay</li>
              <li>
                Exclusive to AIOStreams and can't be installed directly to
                Stremio
              </li>
            </ul>
          </div>
          <p className="text-xs text-[--muted] italic">
            Think of it like having the addon server built into AIOStreams
            itself!
          </p>
        </div>
      </Modal>
    </>
  );
}
