import React from 'react';
import { LuExternalLink, LuStore } from 'react-icons/lu';
import { Button } from '@aiostreams/ui/button';
import { useDisclosure } from '@aiostreams/ui/hooks/disclosure';
import { useMenu } from '@/context/menu';
import { useMode } from '@/context/mode';
import { useStatus } from '@/context/status';
import { useUserData } from '@/context/userData';
import { SectionGroup, SettingsCard } from '@/components/shared/settings-card';
import { InheritedBadge } from '@/components/shared/inherited-badge';
import { ModeSwitch } from '@/components/mode-switch/mode-switch';
import type { PageId } from '@/lib/configure-pages';
import { AboutContent } from '@/components/menu/about';
import { CustomizeModal } from '@/components/menu/about/_components/customize-modal';
import { StreamServices } from '@/components/menu/services/_components/stream-services';
import {
  AutoRemoveDownloadsCard,
  CacheAndPlayCard,
  CheckLibraryCard,
  FailoverCard,
  ServiceWrapCard,
} from '@/components/menu/services/_components/builtin-settings';
import { MetadataServices } from '@/components/menu/services/_components/metadata-services';
import { PosterServices } from '@/components/menu/services/_components/poster-services';
import { useAddonsSections } from '@/components/menu/addons';
import { useFilterSections } from '@/components/menu/filters';
import { SortingContent } from '@/components/menu/sorting';
import { FormatterContent } from '@/components/menu/formatter';
import { ProxyContent } from '@/components/menu/proxy';
import { StatsContent } from '@/components/menu/stats';
import { BackgroundOptimization } from '@/components/menu/miscellaneous/_components/background-optimization';
import { PlaybackBehavior } from '@/components/menu/miscellaneous/_components/playback-behavior';
import { DisplayDebug } from '@/components/menu/miscellaneous/_components/display-debug';
import { ParentConfig } from '@/components/menu/miscellaneous/_components/parent-config';
import { Variants } from '@/components/menu/miscellaneous/_components/variants';
import { HealthChecks } from '@/components/menu/miscellaneous/_components/health-checks';
import {
  ApiCards,
  AppBlock,
  OtherAppCards,
  StremioInstall,
  useSaveInstall,
} from '@/components/menu/save-install';
import { AppPreview } from '@/components/menu/app-preview';
import { LinkedAccountsSection } from '@/components/menu/linked-accounts';
import { ProfileCard } from '@/components/menu/profile-card';
import { ProfileList } from '@/components/menu/profiles/profile-list';
import { JellyfinTrackers } from '@/components/menu/profiles/trackers';
import { FiltersPage } from './filters-page';
import { DrillIn } from './rows';

function Group({
  title,
  id,
  children,
}: {
  title: string;
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      id={id ?? `group-${title.toLowerCase().replace(/\W+/g, '-')}`}
      data-group={title}
      className="scroll-mt-36 space-y-5 border-t border-[--border] pt-8 first:border-t-0 first:pt-0"
    >
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      <SectionGroup.Provider value={title}>{children}</SectionGroup.Provider>
    </div>
  );
}

function Row({
  label,
  help,
  children,
}: {
  label: string;
  help: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-white">{label}</p>
        <p className="text-sm text-[--muted]">{help}</p>
      </div>
      {children}
    </div>
  );
}

function useAppsEnabled() {
  const { status } = useStatus();
  return status?.settings?.jellyfin?.enabled ?? false;
}

function ServicesPage() {
  const { mode } = useMode();
  return (
    <>
      <Group title="Accounts" id="services">
        <InheritedBadge section="services" />
        <StreamServices />
      </Group>
      <Group title="Metadata">
        <MetadataServices />
      </Group>
      {mode === 'pro' && (
        <Group title="How they are used">
          <ServiceWrapCard />
          <AutoRemoveDownloadsCard />
          <CheckLibraryCard />
        </Group>
      )}
    </>
  );
}

function AddonsPage() {
  const { pageTab, back } = useMenu();
  const { installed, marketplace, modals } = useAddonsSections();
  return (
    <>
      {pageTab === 'marketplace' ? (
        <DrillIn back="Addons" onBack={back}>
          {marketplace}
        </DrillIn>
      ) : (
        <>
          <InheritedBadge section="presets" />
          {installed}
        </>
      )}
      {modals}
    </>
  );
}

function CatalogsPage() {
  const { catalogs } = useAddonsSections({ catalogsShown: true });
  return (
    <>
      <Group title="Catalogs">{catalogs}</Group>
      <Group title="Posters">
        <PosterServices />
      </Group>
    </>
  );
}

function ResultsPage() {
  const { mode } = useMode();
  const { sections, modals } = useFilterSections();
  return (
    <>
      {mode === 'pro' && (
        <Group title="Sort order" id="sortCriteria">
          <InheritedBadge section="sorting" />
          <SortingContent />
        </Group>
      )}
      <Group title="Duplicates" id="filter-tab-deduplicator">
        {sections.deduplicator}
      </Group>
      <Group title="Limits" id="filter-tab-limit">
        {sections.limit}
      </Group>
      {mode === 'pro' && (
        <Group title="Also in the list">
          <DisplayDebug />
        </Group>
      )}
      {modals}
    </>
  );
}

function FormatterPage() {
  return (
    <>
      <InheritedBadge section="formatter" />
      <FormatterContent />
    </>
  );
}

function PlaybackPage() {
  const { mode } = useMode();
  return (
    <>
      <Group title="Proxy" id="proxy">
        <InheritedBadge section="proxy" />
        <ProxyContent />
      </Group>
      <Group title="Preloading">
        <BackgroundOptimization />
      </Group>
      {mode === 'pro' && (
        <>
          <Group title="Cache and Play">
            <CacheAndPlayCard />
          </Group>
          <Group title="Failover">
            <FailoverCard />
          </Group>
        </>
      )}
      {mode === 'pro' && (
        <Group title="Next episode">
          <PlaybackBehavior />
        </Group>
      )}
    </>
  );
}

function AppPage() {
  const { uuid } = useUserData();
  const { setPage } = useMenu();
  const apps = useAppsEnabled();
  const {
    installProps,
    account,
    jellyfinConnect,
    jellyfinVersions,
    jellyfinMarkers,
    modals,
  } = useSaveInstall({ offerStremio: false });
  if (!uuid) return account;
  return (
    <>
      <Group title="Get the app">
        <AppBlock
          webAppUrl={installProps.webAppUrl}
          desktopLink={installProps.desktopLink}
          onOpenServer={(tab) =>
            tab === 'users'
              ? setPage('profiles')
              : document
                  .getElementById('connect')
                  ?.scrollIntoView({ behavior: 'smooth' })
          }
          disabled={!apps}
        />
      </Group>
      <Group title="A look at the app">
        <AppPreview />
      </Group>
      {apps && (
        <>
          <Group title="Connect" id="connect">
            <SettingsCard description="For the AIOStreams app and Jellyfin apps.">
              {jellyfinConnect}
            </SettingsCard>
          </Group>
          {jellyfinMarkers && (
            <Group title="Skip markers">
              <SettingsCard>{jellyfinMarkers}</SettingsCard>
            </Group>
          )}
          <Group title="Jellyfin apps" id="jellyfin">
            <SettingsCard description="What Jellyfin apps get for each title. If you only use the AIOStreams app, leave these as they are.">
              {jellyfinVersions}
            </SettingsCard>
          </Group>
        </>
      )}
      {modals}
    </>
  );
}

function settingsLink(webAppUrl: string, who: string) {
  return `${webAppUrl}#/settings?for=${encodeURIComponent(who)}`;
}

function ProfilesPage() {
  const apps = useAppsEnabled();
  const { uuid } = useUserData();
  const { installProps, modals } = useSaveInstall({ offerStremio: false });
  const linked = apps && !!uuid;
  return (
    <>
      <SettingsCard
        id="profiles"
        title="Profiles"
        description="Each signs in to the apps with their own history. Addons chosen for a profile also reach Stremio through an install link for that profile."
        action={
          linked && (
            <a
              href={settingsLink(installProps.webAppUrl, 'everyone')}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-[--brand] hover:underline"
            >
              App settings for everyone
              <LuExternalLink className="h-3 w-3" />
            </a>
          )
        }
      >
        <ProfileList
          rowExtra={(profile) =>
            linked && (
              <a
                href={settingsLink(
                  installProps.webAppUrl,
                  `profile:${profile.id}`
                )}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[--muted] hover:text-white hover:underline"
              >
                App settings
              </a>
            )
          }
        />
      </SettingsCard>
      {apps && (
        <SettingsCard id="trackers" title="Trackers">
          <JellyfinTrackers
            onChooseTrackers={() =>
              document
                .getElementById('profiles')
                ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }
          />
        </SettingsCard>
      )}
      {modals}
    </>
  );
}

function StremioPage() {
  const { uuid } = useUserData();
  const { installProps, account, modals } = useSaveInstall();
  return (
    <>
      {uuid ? (
        <>
          <SettingsCard
            title="Install"
            description="Installing once is enough: you are told when a change needs a reinstall."
          >
            {installProps.variantSelector}
            <StremioInstall {...installProps} />
          </SettingsCard>
          <LinkedAccountsSection manifestUrl={installProps.manifestUrl} />
        </>
      ) : (
        account
      )}
      {modals}
    </>
  );
}

function OtherAppsPage() {
  const { uuid } = useUserData();
  const { setPage } = useMenu();
  const { installProps, account, modals } = useSaveInstall({
    offerStremio: false,
  });
  if (!uuid) return account;
  return (
    <>
      <SettingsCard title="Apps">
        <OtherAppCards
          {...installProps}
          onOpenJellyfin={() => setPage('app')}
        />
      </SettingsCard>
      <SettingsCard title="Programmatic access">
        <ApiCards {...installProps} />
      </SettingsCard>
      {modals}
    </>
  );
}

function ConfigurationPage() {
  const { status } = useStatus();
  const { userData, uuid } = useUserData();
  const { mode, setMode } = useMode();
  const { account, backup, dangerZone, modals } = useSaveInstall({
    offerStremio: false,
  });
  const customize = useDisclosure(false);
  const addonName =
    userData.addonName || status?.settings?.addonName || 'AIOStreams';
  return (
    <>
      <Group title="This configuration">
        {account}
        <SettingsCard
          id="addonName"
          title="Name and look"
          description="What Stremio and the apps call this configuration."
        >
          <div className="flex items-center gap-3">
            <img
              src={userData.addonLogo || '/logo.png'}
              alt=""
              className="h-10 w-10 shrink-0 rounded-lg object-contain"
            />
            <span className="min-w-0 flex-1 truncate text-sm text-white">
              {addonName}
            </span>
            <Button intent="gray-outline" rounded onClick={customize.open}>
              Change
            </Button>
          </div>
        </SettingsCard>
        {uuid && <ProfileCard />}
        {backup}
      </Group>
      <Group title="This page">
        <SettingsCard>
          <Row
            label="Advanced options"
            help="Advanced shows sorting, variants and every advanced option."
          >
            <ModeSwitch
              value={mode}
              onChange={setMode}
              className="w-full shrink-0 sm:h-10 sm:w-48"
            />
          </Row>
        </SettingsCard>
      </Group>
      <Group title="Danger zone">{dangerZone}</Group>
      {modals}
      <CustomizeModal
        open={customize.isOpen}
        onOpenChange={customize.toggle}
        currentName={addonName}
        currentLogo={userData.addonLogo}
        currentBackground={userData.addonBackground}
        currentDescription={userData.addonDescription}
      />
    </>
  );
}

function AdvancedPage() {
  const { mode } = useMode();
  return (
    <>
      <Group title="Parent config">
        <ParentConfig />
      </Group>
      {mode === 'pro' && (
        <>
          <Group title="Variants">
            <Variants />
          </Group>
          <Group title="Health checks">
            <HealthChecks />
          </Group>
        </>
      )}
    </>
  );
}

const PAGE_BODIES: Record<PageId, React.ComponentType> = {
  home: AboutContent,
  services: ServicesPage,
  addons: AddonsPage,
  catalogs: CatalogsPage,
  filters: FiltersPage,
  results: ResultsPage,
  formatter: FormatterPage,
  playback: PlaybackPage,
  app: AppPage,
  profiles: ProfilesPage,
  stremio: StremioPage,
  'other-apps': OtherAppsPage,
  configuration: ConfigurationPage,
  advanced: AdvancedPage,
  stats: StatsContent,
};

export function PageBody({ page }: { page: PageId }) {
  const Body = PAGE_BODIES[page];
  return <Body key={page} />;
}

export function PageActions({ page }: { page: PageId }) {
  const { pageTab, setPage } = useMenu();
  if (page === 'addons' && pageTab !== 'marketplace') {
    return (
      <Button
        intent="primary-subtle"
        rounded
        leftIcon={<LuStore className="h-4 w-4" />}
        onClick={() => setPage('addons', 'marketplace')}
      >
        Browse addons
      </Button>
    );
  }
  return null;
}
