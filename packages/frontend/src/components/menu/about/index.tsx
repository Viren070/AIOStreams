import React from 'react';
import type { Template } from '@aiostreams/core';

import { PageWrapper } from '@/components/shared/page-wrapper';
import { SettingsCard } from '@/components/shared/settings-card';
import { DonationModal } from '@/components/shared/donation-modal';
import { ConfigTemplatesModal } from '@/components/shared/templates';
import { useDisclosure } from '@/hooks/disclosure';
import { useStatus } from '@/context/status';
import { useUserData } from '@/context/userData';
import { useMenu } from '@/context/menu';
import { useMode } from '@/context/mode';
import { useConfigAuth } from '@/context/config-auth';
import {
  useTemplateLoader,
  type AppliedTemplateUpdate,
} from '@/hooks/templates/loader';
import {
  DocsChangelogEntry,
  ReleaseChannel,
  fetchDocsChangelog,
} from '@/lib/changelog';

import { AboutHero } from './_components/hero';
import { GetStartedCard } from './_components/get-started-card';
import { FeaturedSetups } from './_components/featured-setups';
import { Resources } from './_components/resources';
import { InterfaceMode } from './_components/interface-mode';
import { WhatsNew } from './_components/whats-new';
import { InstanceUpdatedModal } from './_components/instance-updated-modal';
import { CustomizeModal } from './_components/customize-modal';
import { TemplateUpdatesModal } from './_components/template-updates-modal';
import { useReleases } from './_components/use-releases';

export function AboutMenu() {
  return (
    <PageWrapper className="space-y-5 p-4 sm:p-8">
      <Content />
    </PageWrapper>
  );
}

function Content() {
  const { status } = useStatus();
  const { nextMenu, setSelectedMenu } = useMenu();
  const { userData, setUserData, uuid, password } = useUserData();
  const { isFirstTime, setIsFirstTime } = useMode();
  const loader = useTemplateLoader(status);

  const donationModal = useDisclosure(false);
  const customizeModal = useDisclosure(false);
  const templatesModal = useDisclosure(false);
  const templateUpdateModal = useDisclosure(false);

  const [startAtWelcome, setStartAtWelcome] = React.useState(false);
  const [featuredTemplateToOpen, setFeaturedTemplateToOpen] =
    React.useState<Template | null>(null);
  const [updateTargets, setUpdateTargets] = React.useState<
    AppliedTemplateUpdate[]
  >([]);
  const [deepLinkUrl, setDeepLinkUrl] = React.useState<string | undefined>();
  const [deepLinkTemplateId, setDeepLinkTemplateId] = React.useState<
    string | undefined
  >();
  const [docsEntries, setDocsEntries] = React.useState<DocsChangelogEntry[]>(
    []
  );
  const [docsLoading, setDocsLoading] = React.useState(true);

  const hasOpenedUpdateModalRef = React.useRef(false);

  const { isSignedIn, openSignIn, toggleSession } = useConfigAuth();
  const addonName =
    userData.addonName || status?.settings?.addonName || 'AIOStreams';
  const addonDescription =
    userData.addonDescription ||
    'AIOStreams consolidates multiple Stremio addons and debrid services — including its own suite of exclusive built-in addons — into a single, highly customisable super-addon.';
  const version = status?.tag || 'Unknown';
  const channel: ReleaseChannel =
    status?.channel ?? (version.startsWith('v') ? 'stable' : 'nightly');
  const githubUrl = 'https://github.com/Viren070/AIOStreams';
  const discordUrl = 'https://discord.viren070.me';
  const customHtml = status?.settings?.customHtml;

  const releases = useReleases(version, channel, true);

  const hasConfig =
    (userData.presets ?? []).length > 0 ||
    (userData.services ?? []).some((service: any) => service.enabled);

  const featuredTemplates = React.useMemo(() => {
    const ids = (status?.settings?.featuredTemplateIds ?? []).slice(0, 2);
    if (ids.length === 0) return loader.templates.slice(0, 2);
    return ids
      .map((id) => loader.templates.find((t) => t.metadata.id === id))
      .filter((t): t is Template => t !== undefined);
  }, [status?.settings?.featuredTemplateIds, loader.templates]);

  React.useEffect(() => {
    loader.loadTemplates();
  }, []);

  React.useEffect(() => {
    fetchDocsChangelog()
      .then(setDocsEntries)
      .catch(() => setDocsEntries([]))
      .finally(() => setDocsLoading(false));
  }, []);

  // A first-time visitor lands straight in the setup flow rather than being
  // asked to classify themselves before they have seen anything.
  React.useEffect(() => {
    if (isFirstTime && !uuid) {
      setStartAtWelcome(true);
      templatesModal.open();
      setIsFirstTime(false);
    }
  }, []);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const templateUrl = url.searchParams.get('template');
    const templateId = url.searchParams.get('templateId') ?? undefined;
    if (templateUrl) {
      setDeepLinkUrl(templateUrl);
      setDeepLinkTemplateId(templateId);
      templatesModal.open();
      url.searchParams.delete('template');
      url.searchParams.delete('templateId');
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

  // Reset the session guard whenever the user's identity changes (sign in /
  // out) so the modal re-fires for the new session.
  React.useEffect(() => {
    hasOpenedUpdateModalRef.current = false;
  }, [uuid]);

  React.useEffect(() => {
    if (!uuid) return;
    if (hasOpenedUpdateModalRef.current) return;
    if (loader.appliedTemplateUpdates.length === 0) return;
    hasOpenedUpdateModalRef.current = true;
    setUpdateTargets(loader.appliedTemplateUpdates);
    templateUpdateModal.open();
  }, [loader.appliedTemplateUpdates, uuid, password]);

  // Remove a template from the in-modal list and close the modal if it empties.
  const consumeUpdateTarget = (templateId: string) => {
    setUpdateTargets((prev) => {
      const next = prev.filter((u) => u.template.metadata.id !== templateId);
      if (next.length === 0) templateUpdateModal.close();
      return next;
    });
  };

  const dismissUpdate = (templateId: string, toVersion: string) => {
    setUserData((prev) => ({
      ...prev,
      appliedTemplates: (prev.appliedTemplates ?? []).map((t) =>
        t.id === templateId ? { ...t, dismissedVersion: toVersion } : t
      ),
    }));
    consumeUpdateTarget(templateId);
  };

  // Drop the applied-template entry entirely so future updates are never
  // surfaced. Also handles the orphan case where the user has since
  // reconfigured away from it.
  const forgetAppliedTemplate = (templateId: string) => {
    setUserData((prev) => ({
      ...prev,
      appliedTemplates: (prev.appliedTemplates ?? []).filter(
        (t) => t.id !== templateId
      ),
    }));
    consumeUpdateTarget(templateId);
  };

  const dismissAllCurrentUpdates = () => {
    const targets = updateTargets;
    setUserData((prev) => ({
      ...prev,
      appliedTemplates: (prev.appliedTemplates ?? []).map((t) => {
        const match = targets.find((u) => u.template.metadata.id === t.id);
        return match
          ? { ...t, dismissedVersion: match.template.metadata.version }
          : t;
      }),
    }));
    templateUpdateModal.close();
  };

  const openSetup = (options?: { welcome?: boolean; template?: Template }) => {
    setStartAtWelcome(options?.welcome ?? false);
    setFeaturedTemplateToOpen(options?.template ?? null);
    templatesModal.open();
  };

  return (
    <>
      <div className="flex flex-col gap-5 w-full">
        <AboutHero
          addonName={addonName}
          addonDescription={addonDescription}
          logo={userData.addonLogo || '/logo.png'}
          version={version}
          channel={channel}
          commit={status?.commit}
          onCustomize={customizeModal.open}
          onDonate={donationModal.open}
          isSignedIn={isSignedIn}
          onToggleSession={toggleSession}
        />

        {customHtml && (
          <SettingsCard>
            <div
              className="[&_a]:text-[--brand] [&_a:hover]:underline"
              dangerouslySetInnerHTML={{ __html: customHtml }}
            />
          </SettingsCard>
        )}

        <GetStartedCard
          isSignedIn={isSignedIn}
          hasConfig={hasConfig}
          onStartSetup={() => openSetup({ welcome: true })}
          onContinue={() => nextMenu()}
          onBrowseSetups={() => openSetup()}
          onInstall={() => setSelectedMenu('save-install')}
          onSignIn={() => openSignIn()}
        />

        <FeaturedSetups
          templates={featuredTemplates}
          totalCount={loader.templates.length}
          loading={loader.loadingTemplates}
          onOpen={(template) => openSetup({ template })}
          onBrowseAll={() => openSetup()}
        />

        <WhatsNew
          version={version}
          channel={channel}
          releases={releases}
          docsEntries={docsEntries}
          docsLoading={docsLoading}
        />

        <InterfaceMode />

        <Resources
          discordUrl={discordUrl}
          githubUrl={githubUrl}
          onDonate={donationModal.open}
        />

        <div className="flex flex-col items-center gap-0.5 text-xs text-gray-500 pt-2">
          <span>
            © {new Date().getFullYear()} AIOStreams. Developed by Viren070.
          </span>
          <span>
            This beautiful UI would not be possible without{' '}
            <a
              href="https://seanime.rahim.app/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[--brand] hover:underline"
            >
              Seanime
            </a>
          </span>
        </div>
      </div>

      <DonationModal
        open={donationModal.isOpen}
        onOpenChange={donationModal.toggle}
      />

      <CustomizeModal
        open={customizeModal.isOpen}
        onOpenChange={customizeModal.toggle}
        currentName={addonName}
        currentLogo={userData.addonLogo}
        currentDescription={userData.addonDescription}
      />

      <ConfigTemplatesModal
        open={templatesModal.isOpen}
        onOpenChange={(v) => {
          if (v) templatesModal.open();
          else {
            templatesModal.close();
            setFeaturedTemplateToOpen(null);
            setStartAtWelcome(false);
          }
        }}
        deepLinkUrl={deepLinkUrl}
        deepLinkTemplateId={deepLinkTemplateId}
        initialExpandedTemplateId={featuredTemplateToOpen?.metadata.id}
        startAtWelcome={startAtWelcome}
        onStartFresh={() => nextMenu()}
        onSignIn={() => openSignIn()}
      />

      <TemplateUpdatesModal
        open={templateUpdateModal.isOpen}
        onOpenChange={templateUpdateModal.toggle}
        updates={updateTargets}
        onApply={(update) => {
          templateUpdateModal.close();
          openSetup({ template: update.template });
        }}
        onDismiss={dismissUpdate}
        onForget={forgetAppliedTemplate}
        onDismissAll={dismissAllCurrentUpdates}
      />

      <InstanceUpdatedModal
        version={version}
        channel={channel}
        docsEntries={docsEntries}
      />
    </>
  );
}
