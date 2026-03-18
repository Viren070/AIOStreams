'use client';
import React from 'react';
import { Template } from '@aiostreams/core';
import { AlertTriangleIcon } from 'lucide-react';
import { Modal } from '../../ui/modal';
import { Button } from '../../ui/button';
import { TemplateValidation } from '@/lib/templates/types';

interface TemplateValidationModalProps {
  open: boolean;
  template: Template | null;
  data: TemplateValidation | null;
  onProceed: (() => void) | null;
  proceedLabel: string;
  onClose: () => void;
}

export function TemplateValidationModal({
  open,
  template,
  data,
  onProceed,
  proceedLabel,
  onClose,
}: TemplateValidationModalProps) {
  if (!data || !template) return null;

  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={
        data.errors.length > 0
          ? `Template Errors - ${template.metadata.name}`
          : `Template Warnings - ${template.metadata.name}`
      }
      contentClass="max-w-2xl"
    >
      <div className="space-y-4">
        <div className="space-y-4 overflow-y-auto max-h-[60vh] pr-1">
          {data.errors.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangleIcon className="w-4 h-4 text-red-400 flex-shrink-0" />
                <span className="text-sm font-semibold text-red-400">
                  {data.errors.length} error
                  {data.errors.length !== 1 ? 's' : ''} - template cannot be
                  loaded
                </span>
              </div>
              <ul className="space-y-1.5">
                {data.errors.map((err, idx) => (
                  <li
                    key={idx}
                    className="text-xs text-red-300 bg-red-950/40 border border-red-900/50 rounded px-3 py-2 break-words font-mono"
                  >
                    {err}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.warnings.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangleIcon className="w-4 h-4 text-yellow-400 flex-shrink-0" />
                <span className="text-sm font-semibold text-yellow-400">
                  {data.warnings.length} warning
                  {data.warnings.length !== 1 ? 's' : ''}
                  {data.errors.length === 0 ? ' - you may still proceed' : ''}
                </span>
              </div>
              <ul className="space-y-1.5">
                {data.warnings.map((warn, idx) => (
                  <li
                    key={idx}
                    className="text-xs text-yellow-300 bg-yellow-950/40 border border-yellow-900/50 rounded px-3 py-2 break-words font-mono"
                  >
                    {warn}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-700">
          <Button intent="primary-outline" onClick={onClose}>
            {data.errors.length > 0 ? 'Close' : 'Cancel'}
          </Button>
          {data.errors.length === 0 && onProceed !== null && (
            <Button
              intent="white"
              rounded
              onClick={() => {
                onClose();
                onProceed();
              }}
            >
              {proceedLabel}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
