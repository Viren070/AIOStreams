import React, { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { Modal } from '../../ui/modal';
import {
  ConfirmationDialog,
  useConfirmationDialog,
} from '../confirmation-dialog';
import { useUserData } from '@/context/userData';
import { useStatus } from '@/context/status';
import { useMenu } from '@/context/menu';
import { useMode } from '@/context/mode';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { Template } from '@aiostreams/core';
import { APIError, likeCommunityItem } from '@/lib/api';
import { myCommunityQuery } from '@/lib/queries';
import {
  SHARE_TEMPLATE_CONFIRMATION,
  shareOutcomeMessage,
  shareTemplateJson,
} from '@/lib/templates/share';
import {
  sanitiseTemplateConfig,
  templateTags,
} from '../../../../../core/src/utils/template-sanitise';
import { MyTemplatesModal } from './my-templates-modal';

import { useValidationModal } from '@/hooks/templates/validationModal';
import { useTemplateLoader } from '@/hooks/templates/loader';
import { useTemplateWizard } from '@/hooks/templates/wizard';
import { useTemplateImport } from '@/hooks/templates/import';

import { TemplateBrowseStep } from './steps/browse';
import { TemplateServiceSelectionStep } from './steps/service-selection';
import { TemplateInputsStep } from './steps/template-inputs';
import { TemplateCredentialInputsStep } from './steps/credential-inputs';
import { TemplateValidationModal } from './validation-modal';
import { TemplateImportModal } from './import-modal';

import type { ConfigTemplatesModalProps } from '@/lib/templates/types';

export function ConfigTemplatesModal({
  open,
  onOpenChange,
  openImportModal = false,
  deepLinkUrl,
  deepLinkTemplateId,
  initialExpandedTemplateId,
}: ConfigTemplatesModalProps) {
  const { setUserData, userData, uuid, password } = useUserData();
  const { status } = useStatus();
  const { setSelectedMenu } = useMenu();
  const { mode, setMode } = useMode();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedSource, setSelectedSource] = useState<string>('all');
  const [mineOpen, setMineOpen] = useState(false);

  const deepLinkFetchedRef = React.useRef<string | null>(null);

  const validationModal = useValidationModal();

  const loader = useTemplateLoader(status);

  const wizard = useTemplateWizard({
    status,
    userData,
    setUserData,
    validationModal,
    templateValidations: loader.templateValidations,
    setSelectedMenu,
    onOpenChange,
    mode,
  });

  const importer = useTemplateImport({
    status,
    templates: loader.templates,
    setTemplates: loader.setTemplates,
    setTemplateValidations: loader.setTemplateValidations,
    validationModal,
    handleLoadTemplate: wizard.handleLoadTemplate,
    executeLoadTemplate: wizard.executeLoadTemplate,
  });

  // load templates when modal opens, and optionally open the import modal
  useEffect(() => {
    if (open) {
      try {
        loader.loadTemplates();
        if (openImportModal) {
          importer.setShowImportModal(true);
        }
      } catch (error) {
        let msg = 'Failed to load templates';
        if (error instanceof APIError) {
          msg += `: ${error.message}`;
        } else {
          console.error('Error loading templates:', error);
        }
        toast.error(msg);
      }
    }
  }, [open]);

  // auto-fetch template from deep-link URL when the modal first opens
  useEffect(() => {
    if (open && deepLinkUrl && deepLinkFetchedRef.current !== deepLinkUrl) {
      deepLinkFetchedRef.current = deepLinkUrl;
      importer.setShowDeepLinkWarning(true);
      const doFetch = async () => {
        try {
          const response = await fetch(deepLinkUrl);
          if (!response.ok)
            throw new Error(`HTTP error! status: ${response.status}`);
          const data = await response.json();
          importer.processImportedTemplate(data, deepLinkUrl);
        } catch (error) {
          toast.error(
            'Failed to load template from link: ' + (error as Error).message
          );
        }
      };
      doFetch();
    }
  }, [open, deepLinkUrl]);

  // auto-select a template by ID once the confirm list is populated
  useEffect(() => {
    if (deepLinkTemplateId && importer.pendingImportTemplates.length > 0) {
      const idx = importer.pendingImportTemplates.findIndex(
        (t) => t.metadata.id === deepLinkTemplateId
      );
      if (idx !== -1) importer.setSelectedPendingTemplateIndex(idx);
    }
  }, [importer.pendingImportTemplates, deepLinkTemplateId]);

  const categories = useMemo(
    () => [
      'all',
      ...Array.from(
        new Set(loader.templates.flatMap((t) => templateTags(t.metadata)))
      ),
    ],
    [loader.templates]
  );

  const sources = ['all', 'builtin', 'custom', 'external', 'community'];

  const credentials = uuid && password ? { uuid, password } : null;
  const communityTemplatesOn = status?.settings.community?.templates !== 'off';
  const mine = useQuery({
    ...myCommunityQuery(credentials),
    enabled: open && !!credentials && communityTemplatesOn,
  });
  // Imported JSON is shared verbatim so hand-written inputs and conditionals survive.
  const shareJson = useMutation({
    mutationFn: (template: Template) =>
      shareTemplateJson(credentials!, template, mine.data),
    onSuccess: ({ item, updated }) => {
      toast.success(shareOutcomeMessage(item, updated));
      mine.refetch();
      void loader.loadTemplates();
    },
    onError: (e: any) => toast.error(e?.message ?? 'Failed to share'),
  });
  const pendingShare = React.useRef<Template | null>(null);
  const shareConfirm = useConfirmationDialog({
    ...SHARE_TEMPLATE_CONFIRMATION,
    onConfirm: () => {
      if (pendingShare.current) shareJson.mutate(pendingShare.current);
    },
  });
  const like = useMutation({
    mutationFn: (id: string) => likeCommunityItem(credentials!, id),
    onSuccess: (result, id) => {
      loader.setCommunityItems((prev) =>
        prev[id]
          ? { ...prev, [id]: { ...prev[id], likes: result.likes } }
          : prev
      );
    },
    onError: (e: any) => toast.error(e?.message ?? 'Failed to like'),
  });

  const filteredTemplates = useMemo(
    () =>
      loader.templates.filter((template) => {
        const matchesSearch =
          template.metadata.name
            .toLowerCase()
            .includes(searchQuery.toLowerCase()) ||
          template.metadata.description
            .toLowerCase()
            .includes(searchQuery.toLowerCase()) ||
          template.metadata.services?.some((service) =>
            service.toLowerCase().includes(searchQuery.toLowerCase())
          );

        const matchesCategory =
          selectedCategory === 'all' ||
          templateTags(template.metadata).includes(selectedCategory);

        const matchesSource =
          selectedSource === 'all' ||
          template.metadata.source === selectedSource;

        return matchesSearch && matchesCategory && matchesSource;
      }),
    [loader.templates, searchQuery, selectedCategory, selectedSource]
  );

  return (
    <>
      <Modal
        open={open && wizard.currentStep === 'browse'}
        onOpenChange={(isOpen) => {
          if (!isOpen) wizard.handleCancel();
        }}
        onOpenAutoFocus={(e) => e.preventDefault()}
        title="Templates"
        description="Browse and load pre-configured templates for your AIOStreams setup"
        contentClass="max-w-5xl w-full"
      >
        <div className="space-y-4 min-w-0 overflow-hidden">
          <TemplateBrowseStep
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            selectedCategory={selectedCategory}
            onCategoryChange={setSelectedCategory}
            selectedSource={selectedSource}
            onSourceChange={setSelectedSource}
            categories={categories}
            sources={sources}
            filteredTemplates={filteredTemplates}
            loadingTemplates={loader.loadingTemplates}
            templateValidations={loader.templateValidations}
            isLoading={wizard.isLoading}
            onLoadTemplate={wizard.handleLoadTemplate}
            onImportOpen={() => importer.setShowImportModal(true)}
            onDeleteRequest={(t) => {
              importer.setTemplateToDelete(t);
              importer.confirmDeleteTemplate.open();
            }}
            totalTemplateCount={loader.templates.length}
            communityItems={loader.communityItems}
            onLike={credentials ? (id) => like.mutate(id) : undefined}
            likeDisabledReason={
              credentials
                ? undefined
                : 'Create or load your configuration (UUID and password) first; likes are tied to it'
            }
            onMineOpen={
              credentials && communityTemplatesOn
                ? () => setMineOpen(true)
                : undefined
            }
            onShare={
              credentials && communityTemplatesOn
                ? (t) => {
                    pendingShare.current = t;
                    shareConfirm.open();
                  }
                : undefined
            }
            shareDisabledReason={
              communityTemplatesOn && !credentials
                ? 'Create or load your configuration (UUID and password) first; shared templates are tied to it'
                : undefined
            }
            initialExpandedTemplate={
              initialExpandedTemplateId
                ? (loader.templates.find(
                    (t) => t.metadata.id === initialExpandedTemplateId
                  ) ?? undefined)
                : undefined
            }
          />
        </div>
      </Modal>

      {/* Template Inputs */}
      <Modal
        open={open && wizard.currentStep === 'templateInputs'}
        onOpenChange={(isOpen) => {
          if (!isOpen) wizard.handleCancel();
        }}
        title="Template Options"
        description="Customise this template to your needs"
        contentClass="max-w-xl max-h-[120vh]"
      >
        <div className="space-y-4">
          <TemplateInputsStep
            mode={mode}
            onModeChange={setMode}
            options={wizard.templateInputOptions}
            values={wizard.templateInputValues}
            onValuesChange={wizard.setTemplateInputValues}
            trusted={
              !['external', 'community'].includes(
                wizard.pendingTemplate?.metadata?.source ?? ''
              )
            }
            selectedServices={wizard.selectedServices}
            onBack={wizard.handleBack}
            onNext={wizard.handleTemplateInputsNext}
          />
        </div>
      </Modal>

      {/* Service Selection */}
      <Modal
        open={open && wizard.currentStep === 'selectService'}
        onOpenChange={(isOpen) => {
          if (!isOpen) wizard.handleCancel();
        }}
        title="Select Services"
        description="Choose which services you want to use with this template"
        contentClass="max-w-xl"
      >
        <div className="flex flex-col gap-4 overflow-hidden max-h-[calc(100svh-8rem)] md:max-h-[calc(100svh-10rem)]">
          {wizard.processedTemplate && (
            <TemplateServiceSelectionStep
              processedTemplate={wizard.processedTemplate}
              selectedServices={wizard.selectedServices}
              onServicesChange={wizard.setSelectedServices}
              onBack={wizard.handleBack}
              onSkip={wizard.handleServiceSelectionSkip}
              onNext={wizard.handleServiceSelectionNext}
              status={status}
            />
          )}
        </div>
      </Modal>

      {/* Credential Inputs */}
      <Modal
        open={open && wizard.currentStep === 'inputs'}
        onOpenChange={(isOpen) => {
          if (!isOpen) wizard.handleCancel();
        }}
        title="Enter Credentials"
        description="Provide your API keys and credentials for the selected services and addons"
        contentClass="max-w-xl"
      >
        <div className="flex flex-col gap-4 overflow-hidden max-h-[calc(100svh-8rem)] md:max-h-[calc(100svh-10rem)]">
          {wizard.processedTemplate && (
            <TemplateCredentialInputsStep
              processedTemplate={wizard.processedTemplate}
              inputValues={wizard.inputValues}
              onInputValuesChange={wizard.setInputValues}
              isLoading={wizard.isLoading}
              onBack={wizard.handleBack}
              onConfirm={wizard.confirmLoadTemplate}
            />
          )}
        </div>
      </Modal>

      {/* Import Modals */}
      <TemplateImportModal
        showImportModal={importer.showImportModal}
        onImportModalChange={importer.setShowImportModal}
        importUrl={importer.importUrl}
        onImportUrlChange={importer.setImportUrl}
        isImporting={importer.isImporting}
        onImportFromUrl={importer.handleImportFromUrl}
        onImportFromFile={importer.handleImportFromFile}
        showImportConfirmModal={importer.showImportConfirmModal}
        onImportConfirmModalChange={importer.setShowImportConfirmModal}
        pendingImportTemplates={importer.pendingImportTemplates}
        selectedPendingTemplateIndex={importer.selectedPendingTemplateIndex}
        onSelectedIndexChange={importer.setSelectedPendingTemplateIndex}
        showDeepLinkWarning={importer.showDeepLinkWarning}
        onConfirmImport={importer.handleConfirmImport}
        onCancelImport={importer.handleCancelImport}
        status={status}
      />

      <TemplateValidationModal
        open={validationModal.show}
        template={validationModal.template}
        data={validationModal.data}
        onProceed={validationModal.onProceed}
        proceedLabel={validationModal.proceedLabel}
        onClose={validationModal.close}
      />

      <ConfirmationDialog {...importer.confirmDeleteTemplate} />
      <ConfirmationDialog {...shareConfirm} />

      {credentials && (
        <MyTemplatesModal
          open={mineOpen}
          onOpenChange={setMineOpen}
          credentials={credentials}
          userData={userData}
          filterCredentials={(data) =>
            sanitiseTemplateConfig(
              data,
              (type: string) =>
                status?.settings.presets.find((p) => p.ID === type)?.OPTIONS
            )
          }
          onChanged={() => void loader.loadTemplates()}
        />
      )}
    </>
  );
}
