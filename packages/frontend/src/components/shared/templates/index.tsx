import React, { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { Modal } from '../../ui/modal';
import { Button } from '../../ui/button';
import {
  ConfirmationDialog,
  useConfirmationDialog,
} from '../confirmation-dialog';
import { useUserData } from '@/context/userData';
import { useStatus } from '@/context/status';
import { useMenu } from '@/context/menu';
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

import { SetupShell, SetupFooter } from './setup-shell';
import { WelcomeStep } from './steps/welcome';
import { TemplateBrowseStep } from './steps/browse';
import { TemplateServiceSelectionStep } from './steps/service-selection';
import { TemplateInputsStep } from './steps/template-inputs';
import { TemplateCredentialInputsStep } from './steps/credential-inputs';
import { ReviewStep } from './steps/review';
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
  startAtWelcome = false,
  onStartFresh,
  onSignIn,
}: ConfigTemplatesModalProps) {
  const { setUserData, userData, uuid, password } = useUserData();
  const { status } = useStatus();
  const { setSelectedMenu } = useMenu();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedSource, setSelectedSource] = useState<string>('all');
  const [mineOpen, setMineOpen] = useState(false);
  const [pendingDetailId, setPendingDetailId] = useState<string | null>(null);

  const deepLinkFetchedRef = React.useRef<string | null>(null);
  const wasOpenRef = React.useRef(false);

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
    initialStep: startAtWelcome ? 'welcome' : 'browse',
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

  // Each opening starts from the caller's entry step; the hook's initial value
  // is only read once, and the About page picks the step after mount.
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      wizard.resetTo(startAtWelcome ? 'welcome' : 'browse');
      setPendingDetailId(initialExpandedTemplateId ?? null);
    }
    wasOpenRef.current = open;
  }, [open, startAtWelcome]);

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

  const credentials = uuid ? { uuid, password } : null;
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

  // Position in `featuredTemplateIds`, which the instance owner controls.
  const featuredRank = useMemo(() => {
    const rank = new Map<string, number>();
    (status?.settings?.featuredTemplateIds ?? []).forEach((id, i) =>
      rank.set(id, i)
    );
    return rank;
  }, [status?.settings?.featuredTemplateIds]);

  const filteredTemplates = useMemo(
    () =>
      loader.templates
        .filter((template) => {
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
        })
        // Featured first, in the owner's order; sort is stable so everything
        // else keeps the order the loader produced.
        .sort(
          (a, b) =>
            (featuredRank.get(a.metadata.id) ?? Infinity) -
            (featuredRank.get(b.metadata.id) ?? Infinity)
        ),
    [
      loader.templates,
      searchQuery,
      selectedCategory,
      selectedSource,
      featuredRank,
    ]
  );

  const hasExistingConfig =
    (userData?.presets ?? []).length > 0 ||
    ((userData?.services ?? []) as any[]).some((s) => s.enabled);

  /** Services the user already holds credentials for, surfaced as a hint. */
  const configuredServices = useMemo(
    () =>
      ((userData?.services ?? []) as any[])
        .filter(
          (s) => s.credentials && Object.values(s.credentials).some((v) => !!v)
        )
        .map((s) => s.id as string),
    [userData?.services]
  );

  const recommendedTemplate = useMemo(() => {
    const ids = status?.settings?.featuredTemplateIds ?? [];
    for (const id of ids) {
      const match = loader.templates.find((t) => t.metadata.id === id);
      if (match) return match;
    }
    return loader.templates[0];
  }, [status?.settings?.featuredTemplateIds, loader.templates]);

  const step = wizard.currentStep;
  const canGoBack = wizard.wizardHistory.length > 0;

  const shell = (() => {
    switch (step) {
      case 'welcome':
        return {
          title: 'Set up AIOStreams',
          description: 'Two minutes to a working addon. Pick a starting point.',
          body: (
            <WelcomeStep
              recommendedTemplateName={recommendedTemplate?.metadata.name}
              templateCount={loader.templates.length}
              hasExistingConfig={!!uuid}
              onUseTemplate={() => {
                // The card promised a specific setup, so open it rather than
                // dropping the user into an undifferentiated list.
                setPendingDetailId(recommendedTemplate?.metadata.id ?? null);
                wizard.goToStep('browse');
              }}
              onStartFresh={() => {
                wizard.handleCancel();
                onStartFresh?.();
              }}
              onSignIn={
                uuid
                  ? undefined
                  : () => {
                      wizard.handleCancel();
                      onSignIn?.();
                    }
              }
            />
          ),
          footer: null,
        };

      case 'browse':
        return {
          title: 'Choose a setup',
          description:
            'Open one to see what it installs and what you will need.',
          body: (
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
              allTemplates={loader.templates}
              loadingTemplates={loader.loadingTemplates}
              templateValidations={loader.templateValidations}
              isLoading={wizard.isLoading}
              onLoadTemplate={(t) => {
                setPendingDetailId(t.metadata.id);
                wizard.handleLoadTemplate(t);
              }}
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
                pendingDetailId
                  ? (loader.templates.find(
                      (t) => t.metadata.id === pendingDetailId
                    ) ?? undefined)
                  : undefined
              }
              onInitialExpandedConsumed={() => setPendingDetailId(null)}
            />
          ),
          footer: canGoBack ? <SetupFooter onBack={wizard.handleBack} /> : null,
        };

      case 'selectService': {
        const processed = wizard.processedTemplate;
        if (!processed) return null;
        const canSkip = processed.allowSkipService;
        const nothingPicked = wizard.selectedServices.length === 0;
        return {
          title: 'Which services do you use?',
          description: canSkip
            ? 'Pick the ones you have accounts for. You can skip this if none apply.'
            : 'Pick the ones you have accounts for.',
          body: (
            <TemplateServiceSelectionStep
              processedTemplate={processed}
              selectedServices={wizard.selectedServices}
              onServicesChange={wizard.setSelectedServices}
              status={status}
              configuredServices={configuredServices}
            />
          ),
          footer: (
            <SetupFooter
              onBack={canGoBack ? wizard.handleBack : undefined}
              onSkip={canSkip ? wizard.handleServiceSelectionSkip : undefined}
              skipLabel="I don't use any of these"
              primary={
                <Button
                  intent="primary"
                  onClick={wizard.handleServiceSelectionNext}
                  disabled={!canSkip && nothingPicked}
                >
                  Continue
                </Button>
              }
            />
          ),
        };
      }

      case 'templateInputs':
        return {
          title: 'Options',
          description: 'Adjust this setup before it is applied.',
          body: (
            <TemplateInputsStep
              options={wizard.templateInputOptions}
              values={wizard.templateInputValues}
              onValuesChange={wizard.setTemplateInputValues}
              trusted={
                !['external', 'community'].includes(
                  wizard.pendingTemplate?.metadata?.source ?? ''
                )
              }
              selectedServices={wizard.selectedServices}
            />
          ),
          footer: (
            <SetupFooter
              onBack={canGoBack ? wizard.handleBack : undefined}
              primary={
                <Button
                  intent="primary"
                  onClick={wizard.handleTemplateInputsNext}
                >
                  Continue
                </Button>
              }
            />
          ),
        };

      case 'inputs': {
        const processed = wizard.processedTemplate;
        if (!processed) return null;
        const missing = processed.inputs.filter(
          (input) => input.required && !wizard.inputValues[input.key]?.trim()
        );
        return {
          title: 'Credentials',
          description:
            'These are stored in your configuration and never shared with other users.',
          body: (
            <TemplateCredentialInputsStep
              processedTemplate={processed}
              inputValues={wizard.inputValues}
              onInputValuesChange={wizard.setInputValues}
              status={status}
            />
          ),
          footer: (
            <SetupFooter
              onBack={canGoBack ? wizard.handleBack : undefined}
              primary={
                <div className="flex flex-col items-end gap-1">
                  <Button
                    intent="primary"
                    onClick={wizard.handleCredentialsNext}
                    disabled={missing.length > 0}
                  >
                    Continue
                  </Button>
                  {missing.length > 0 && (
                    <span className="text-xs text-gray-500">
                      {missing.length} required field
                      {missing.length === 1 ? '' : 's'} left
                    </span>
                  )}
                </div>
              }
            />
          ),
        };
      }

      case 'review': {
        const processed = wizard.processedTemplate;
        if (!processed) return null;
        return {
          title: 'Ready to apply',
          description: 'A last look before this touches your configuration.',
          body: (
            <ReviewStep
              processedTemplate={processed}
              selectedServices={wizard.selectedServices}
              inputValues={wizard.inputValues}
              status={status}
              currentUserData={hasExistingConfig ? userData : null}
              previewUserData={wizard.previewUserData}
            />
          ),
          footer: (
            <SetupFooter
              onBack={canGoBack ? wizard.handleBack : undefined}
              primary={
                <Button
                  intent="primary"
                  onClick={wizard.confirmLoadTemplate}
                  loading={wizard.isLoading}
                >
                  Apply setup
                </Button>
              }
            />
          ),
        };
      }

      default:
        return null;
    }
  })();

  return (
    <>
      <Modal
        open={open && shell !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) wizard.handleCancel();
        }}
        onOpenAutoFocus={(e) => e.preventDefault()}
        // A fixed height, not a max, so the dialog never resizes between steps.
        contentClass="max-w-5xl w-full !flex flex-col overflow-hidden h-[100svh] sm:h-[min(46rem,calc(100svh-2rem))]"
      >
        {shell && (
          <SetupShell
            // Before a setup is picked the real length is unknowable, and a
            // rail that grows is worse than no rail.
            steps={
              step === 'welcome' || step === 'browse' ? [] : wizard.plannedSteps
            }
            current={step}
            title={shell.title}
            description={shell.description}
            footer={shell.footer}
          >
            {shell.body}
          </SetupShell>
        )}
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
