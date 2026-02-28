'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { Template, StatusResponse } from '@aiostreams/core';
import { useConfirmationDialog } from '@/components/shared/confirmation-dialog';
import { TemplateValidation } from '@/lib/templates/types';
import {
  getLocalStorageTemplates,
  saveLocalStorageTemplates,
  compareVersions,
} from '@/lib/templates/storage';
import {
  validateTemplate,
  detectDuplicateKeys,
} from '@/lib/templates/validator';
import { UseValidationModal } from './validationModal';

export interface UseTemplateImportParams {
  status: StatusResponse | null;
  templates: Template[];
  setTemplates: React.Dispatch<React.SetStateAction<Template[]>>;
  setTemplateValidations: React.Dispatch<
    React.SetStateAction<Record<string, TemplateValidation>>
  >;
  validationModal: UseValidationModal;
  handleLoadTemplate: (template: Template) => void;
  executeLoadTemplate: (template: Template) => void;
}

export interface UseTemplateImport {
  showImportModal: boolean;
  setShowImportModal: React.Dispatch<React.SetStateAction<boolean>>;
  importUrl: string;
  setImportUrl: React.Dispatch<React.SetStateAction<string>>;
  isImporting: boolean;
  showImportConfirmModal: boolean;
  setShowImportConfirmModal: React.Dispatch<React.SetStateAction<boolean>>;
  pendingImportTemplates: Template[];
  selectedPendingTemplateIndex: number | null;
  setSelectedPendingTemplateIndex: React.Dispatch<
    React.SetStateAction<number | null>
  >;
  showDeepLinkWarning: boolean;
  setShowDeepLinkWarning: React.Dispatch<React.SetStateAction<boolean>>;
  templateToDelete: Template | null;
  setTemplateToDelete: React.Dispatch<React.SetStateAction<Template | null>>;
  processImportedTemplate(data: any, sourceUrl?: string): void;
  handleImportFromUrl(): Promise<void>;
  handleImportFromFile(): void;
  handleConfirmImport(loadImmediately?: boolean, selectedIndex?: number): void;
  handleCancelImport(): void;
  confirmDeleteTemplate: ReturnType<typeof useConfirmationDialog>;
}

export function useTemplateImport({
  status,
  templates,
  setTemplates,
  setTemplateValidations,
  validationModal,
  handleLoadTemplate,
  executeLoadTemplate,
}: UseTemplateImportParams): UseTemplateImport {
  const [showImportModal, setShowImportModal] = useState(false);
  const [importUrl, setImportUrl] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [showImportConfirmModal, setShowImportConfirmModal] = useState(false);
  const [pendingImportTemplates, setPendingImportTemplates] = useState<
    Template[]
  >([]);
  const [selectedPendingTemplateIndex, setSelectedPendingTemplateIndex] =
    useState<number | null>(null);
  const [showDeepLinkWarning, setShowDeepLinkWarning] = useState(false);
  const [templateToDelete, setTemplateToDelete] = useState<Template | null>(
    null
  );

  const handleDeleteTemplate = (templateId: string) => {
    setTemplates((prev) => prev.filter((t) => t.metadata.id !== templateId));

    const localTemplates = getLocalStorageTemplates();
    const updatedTemplates = localTemplates.filter(
      (t) => t.metadata.id !== templateId
    );
    saveLocalStorageTemplates(updatedTemplates);

    toast.success('Template deleted successfully');
  };

  const confirmDeleteTemplate = useConfirmationDialog({
    title: 'Delete Template',
    description:
      'Are you sure you want to delete this template? This action cannot be undone.',
    actionText: 'Delete',
    actionIntent: 'alert-subtle',
    onConfirm: () => {
      if (templateToDelete) {
        handleDeleteTemplate(templateToDelete.metadata.id);
      }
    },
  });

  const processImportedTemplate = (
    data: any,
    sourceUrl?: string,
    rawJson?: string
  ) => {
    try {
      const isArray = Array.isArray(data);
      const templateData = isArray ? data : [data];

      const importedTemplates: Template[] = [];
      const allImportWarnings: string[] = [];

      if (rawJson) {
        const dupWarnings = detectDuplicateKeys(rawJson);
        allImportWarnings.push(...dupWarnings);
      }

      for (const item of templateData) {
        if (!item.config) {
          toast.error('Invalid template: missing config field');
          return;
        }

        const templateId =
          item.metadata?.id ||
          `imported-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        // Skip if the existing template is newer
        const existingTemplate = templates.find(
          (t) => t.metadata.id === templateId
        );
        if (
          existingTemplate &&
          (existingTemplate.metadata.source === 'builtin' ||
            existingTemplate.metadata.source === 'custom')
        ) {
          if (
            compareVersions(
              item.metadata.version,
              existingTemplate.metadata.version
            ) !== 1
          ) {
            console.log(
              `Skipping template "${item.metadata.name}" because it is not newer than the existing template`
            );
            continue;
          }
        }

        const importedTemplate: Template = {
          metadata: {
            id: templateId,
            name: item.metadata?.name || 'Imported Template',
            description: item.metadata?.description || 'Imported from JSON',
            author: item.metadata?.author || 'Unknown',
            version: item.metadata?.version || '1.0.0',
            category: item.metadata?.category || 'Custom',
            services: item.metadata?.services,
            serviceRequired: item.metadata?.serviceRequired,
            source: 'external',
            setToSaveInstallMenu: true,
            sourceUrl,
            inputs: item.metadata?.inputs,
          },
          config: item.config || item,
        };

        if (status) {
          const validation = validateTemplate(importedTemplate, status);

          if (validation.errors.length > 0) {
            setShowImportModal(false);
            setImportUrl('');
            validationModal.open({
              template: importedTemplate,
              data: validation,
              onProceed: null,
              proceedLabel: 'Import Anyway',
            });
            return;
          }

          setTemplateValidations((prev) => ({
            ...prev,
            [importedTemplate.metadata.id]: validation,
          }));

          if (validation.warnings.length > 0) {
            const prefix =
              templateData.length > 1
                ? `[${importedTemplate.metadata.name}] `
                : '';
            allImportWarnings.push(
              ...validation.warnings.map((w) => `${prefix}${w}`)
            );
          }
        }

        importedTemplates.push(importedTemplate);
      }

      if (importedTemplates.length === 0) {
        toast.info(
          'There were no templates to import as existing templates are newer or the same version.'
        );
        return;
      }

      if (allImportWarnings.length > 0) {
        const syntheticValidation: TemplateValidation = {
          isValid: true,
          errors: [],
          warnings: allImportWarnings,
        };
        setShowImportModal(false);
        setImportUrl('');
        validationModal.open({
          template: importedTemplates[0],
          data: syntheticValidation,
          proceedLabel: 'Import Anyway',
          onProceed: () => {
            setPendingImportTemplates(importedTemplates);
            setShowImportConfirmModal(true);
          },
        });
        return;
      }

      setShowImportModal(false);
      setImportUrl('');
      setPendingImportTemplates(importedTemplates);
      setShowImportConfirmModal(true);
    } catch (error) {
      toast.error('Invalid template format: ' + (error as Error).message);
    }
  };

  const handleImportFromUrl = async () => {
    if (!importUrl.trim()) {
      toast.error('Please enter a URL');
      return;
    }

    setIsImporting(true);
    try {
      const response = await fetch(importUrl);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const rawJson = await response.text();
      const data = JSON.parse(rawJson);
      processImportedTemplate(data, importUrl, rawJson);
    } catch (error) {
      toast.error('Failed to import template: ' + (error as Error).message);
    } finally {
      setIsImporting(false);
    }
  };

  const handleImportFromFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        processImportedTemplate(data, undefined, text);
      } catch (error) {
        toast.error('Failed to read file: ' + (error as Error).message);
      }
    };
    input.click();
  };

  const handleConfirmImport = (
    loadImmediately = false,
    selectedIndex?: number
  ) => {
    const localTemplates = getLocalStorageTemplates();

    const existingTemplateIds = new Set(
      pendingImportTemplates.map((t) => t.metadata.id)
    );
    const filteredLocalTemplates = localTemplates.filter(
      (t) => !existingTemplateIds.has(t.metadata.id)
    );

    const updatedTemplates = [
      ...pendingImportTemplates,
      ...filteredLocalTemplates,
    ];
    saveLocalStorageTemplates(updatedTemplates);

    setTemplates((prev) => {
      const filtered = prev.filter(
        (t) => !existingTemplateIds.has(t.metadata.id)
      );
      return [...pendingImportTemplates, ...filtered];
    });

    const overwriteCount = localTemplates.filter((t) =>
      existingTemplateIds.has(t.metadata.id)
    ).length;

    if (overwriteCount > 0) {
      toast.success(
        `Successfully imported ${pendingImportTemplates.length} template${pendingImportTemplates.length !== 1 ? 's' : ''} (${overwriteCount} overwritten)`
      );
    } else {
      toast.success(
        `Successfully imported ${pendingImportTemplates.length} template${pendingImportTemplates.length !== 1 ? 's' : ''}`
      );
    }

    if (
      loadImmediately &&
      (pendingImportTemplates.length === 1 || selectedIndex !== undefined)
    ) {
      const idx = selectedIndex ?? 0;
      setShowImportConfirmModal(false);
      executeLoadTemplate(pendingImportTemplates[idx]);
      setPendingImportTemplates([]);
      setSelectedPendingTemplateIndex(null);
      setShowDeepLinkWarning(false);
    } else {
      setShowImportConfirmModal(false);
      setPendingImportTemplates([]);
      setSelectedPendingTemplateIndex(null);
      setShowDeepLinkWarning(false);
    }
  };

  const handleCancelImport = () => {
    setShowImportConfirmModal(false);
    setPendingImportTemplates([]);
    setSelectedPendingTemplateIndex(null);
    setShowDeepLinkWarning(false);
  };

  return {
    showImportModal,
    setShowImportModal,
    importUrl,
    setImportUrl,
    isImporting,
    showImportConfirmModal,
    setShowImportConfirmModal,
    pendingImportTemplates,
    selectedPendingTemplateIndex,
    setSelectedPendingTemplateIndex,
    showDeepLinkWarning,
    setShowDeepLinkWarning,
    templateToDelete,
    setTemplateToDelete,
    processImportedTemplate,
    handleImportFromUrl,
    handleImportFromFile,
    handleConfirmImport,
    handleCancelImport,
    confirmDeleteTemplate,
  };
}
