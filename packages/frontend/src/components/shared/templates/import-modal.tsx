'use client';
import React from 'react';
import { Template, StatusResponse } from '@aiostreams/core';
import { BiImport } from 'react-icons/bi';
import { Modal } from '../../ui/modal';
import { Button } from '../../ui/button';
import { TextInput } from '../../ui/text-input';
import { Alert } from '../../ui/alert';
import MarkdownLite from '../markdown-lite';
import { cn } from '../../ui/core/styling';
import * as constants from '../../../../../core/src/utils/constants';

interface TemplateImportModalProps {
  // Import URL/File modal
  showImportModal: boolean;
  onImportModalChange: (open: boolean) => void;
  importUrl: string;
  onImportUrlChange: (url: string) => void;
  isImporting: boolean;
  onImportFromUrl: () => void;
  onImportFromFile: () => void;

  // Confirm import modal
  showImportConfirmModal: boolean;
  onImportConfirmModalChange: (open: boolean) => void;
  pendingImportTemplates: Template[];
  selectedPendingTemplateIndex: number | null;
  onSelectedIndexChange: (idx: number | null) => void;
  showDeepLinkWarning: boolean;
  onConfirmImport: (loadImmediately?: boolean, selectedIndex?: number) => void;
  onCancelImport: () => void;
  status: StatusResponse | null;
}

export function TemplateImportModal({
  showImportModal,
  onImportModalChange,
  importUrl,
  onImportUrlChange,
  isImporting,
  onImportFromUrl,
  onImportFromFile,
  showImportConfirmModal,
  onImportConfirmModalChange,
  pendingImportTemplates,
  selectedPendingTemplateIndex,
  onSelectedIndexChange,
  showDeepLinkWarning,
  onConfirmImport,
  onCancelImport,
  status,
}: TemplateImportModalProps) {
  return (
    <>
      {/* Import Template Modal */}
      <Modal
        open={showImportModal}
        onOpenChange={onImportModalChange}
        title="Import Template"
        description="Import a template from a URL or local file"
      >
        <div className="space-y-4">
          <div className="flex gap-2">
            <TextInput
              placeholder="Enter template URL..."
              value={importUrl}
              onValueChange={onImportUrlChange}
              className="flex-1"
            />
            <Button
              intent="primary"
              onClick={onImportFromUrl}
              loading={isImporting}
              disabled={!importUrl.trim()}
            >
              Go
            </Button>
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-700" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-gray-900 px-2 text-gray-400">or</span>
            </div>
          </div>

          <Button
            intent="primary"
            className="w-full"
            leftIcon={<BiImport className="w-4 h-4" />}
            onClick={onImportFromFile}
          >
            Import from File
          </Button>
        </div>
      </Modal>

      {/* Import Confirmation Modal */}
      <Modal
        open={showImportConfirmModal}
        onOpenChange={onImportConfirmModalChange}
        title="Confirm Import"
        description={
          pendingImportTemplates.length === 1
            ? 'Review the template details before importing'
            : `${pendingImportTemplates.length} templates will be imported`
        }
      >
        <div className="space-y-4">
          {showDeepLinkWarning && (
            <Alert
              intent="warning"
              isClosable={false}
              title="Externally Linked Template"
              description="This template is being loaded from an external URL that was passed via a link. Only proceed if you recognise the source and trust where this link came from. If you did not expect to see this, click Cancel."
            />
          )}

          {pendingImportTemplates.length === 1 ? (
            <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 space-y-3">
              <div>
                <div className="text-xs text-gray-400 mb-1">Name</div>
                <div className="text-sm font-semibold text-white flex items-center gap-2">
                  {pendingImportTemplates[0].metadata.name}
                  <span className="text-[10px] text-gray-400 bg-gray-800 px-1.5 py-0.5 rounded">
                    v{pendingImportTemplates[0].metadata.version || '1.0.0'}
                  </span>
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-400 mb-1">Description</div>
                <MarkdownLite className="text-sm text-gray-300">
                  {pendingImportTemplates[0].metadata.description}
                </MarkdownLite>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-gray-400 mb-1">Author</div>
                  <div className="text-sm text-gray-300">
                    {pendingImportTemplates[0].metadata.author}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-400 mb-1">Category</div>
                  <div className="text-sm text-gray-300">
                    {pendingImportTemplates[0].metadata.category}
                  </div>
                </div>
              </div>
              {pendingImportTemplates[0].metadata.services &&
                pendingImportTemplates[0].metadata.services.length > 0 && (
                  <div>
                    <div className="text-xs text-gray-400 mb-1">Services</div>
                    <div className="flex flex-wrap gap-1.5">
                      {pendingImportTemplates[0].metadata.services.map(
                        (service) => (
                          <span
                            key={service}
                            className="text-xs bg-green-600/30 text-green-300 px-2 py-0.5 rounded"
                          >
                            {constants.SERVICE_DETAILS[
                              service as keyof typeof constants.SERVICE_DETAILS
                            ]?.name || service}
                          </span>
                        )
                      )}
                    </div>
                  </div>
                )}
            </div>
          ) : (
            <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
              <p className="text-xs text-gray-400 mb-3">
                Click a template to select it, then use &ldquo;Use Selected
                Template&rdquo; to apply it - or import them all at once.
              </p>
              <div className="space-y-1 max-h-[300px] overflow-y-auto">
                {pendingImportTemplates.map((template, idx) => (
                  <div
                    key={idx}
                    onClick={() =>
                      onSelectedIndexChange(
                        idx === selectedPendingTemplateIndex ? null : idx
                      )
                    }
                    className={cn(
                      'flex items-center gap-3 py-2 px-2 rounded cursor-pointer transition-colors border',
                      selectedPendingTemplateIndex === idx
                        ? 'bg-white/10 border-white/20'
                        : 'border-transparent hover:bg-gray-700/50'
                    )}
                  >
                    <div
                      className={cn(
                        'w-3 h-3 rounded-full border-2 flex-shrink-0 transition-colors',
                        selectedPendingTemplateIndex === idx
                          ? 'bg-white border-white'
                          : 'border-gray-500'
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-white truncate">
                        {template.metadata.name}
                      </div>
                      <div className="text-xs text-gray-400 truncate">
                        {template.metadata.category} • v
                        {template.metadata.version || '1.0.0'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Alert
            intent="info"
            description={`The template${pendingImportTemplates.length !== 1 ? 's' : ''} will be saved to your browser's local storage and added to your templates list.`}
          />

          <div className="flex justify-between gap-2 pt-2 border-t border-gray-700">
            <Button intent="primary-outline" onClick={onCancelImport}>
              Cancel
            </Button>
            <div className="flex gap-2">
              {pendingImportTemplates.length === 1 ? (
                <>
                  <Button
                    intent="gray-outline"
                    onClick={() => onConfirmImport(false)}
                  >
                    OK
                  </Button>
                  <Button
                    intent="white"
                    rounded
                    onClick={() => onConfirmImport(true)}
                  >
                    Use This Template Now
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    intent="gray-outline"
                    onClick={() => onConfirmImport(false)}
                  >
                    Import All
                  </Button>
                  {selectedPendingTemplateIndex !== null && (
                    <Button
                      intent="white"
                      rounded
                      onClick={() =>
                        onConfirmImport(true, selectedPendingTemplateIndex)
                      }
                    >
                      Use Selected Template
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}
