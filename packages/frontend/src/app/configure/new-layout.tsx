import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type { IconType } from 'react-icons';
import {
  LuBlocks,
  LuChartBar,
  LuChevronLeft,
  LuChevronRight,
  LuCloud,
  LuFilter,
  LuHeart,
  LuHouse,
  LuLayoutGrid,
  LuLibrary,
  LuListOrdered,
  LuLogIn,
  LuLogOut,
  LuMenu,
  LuPenLine,
  LuPlay,
  LuSave,
  LuSettings2,
  LuSlidersHorizontal,
  LuTv,
  LuUsers,
} from 'react-icons/lu';
import { SiStremio } from 'react-icons/si';
import { cn } from '@aiostreams/ui/core/styling';
import { Button } from '@aiostreams/ui/button';
import { Drawer } from '@aiostreams/ui/drawer';
import { useDisclosure } from '@aiostreams/ui/hooks/disclosure';
import { useMediaQuery } from '@aiostreams/ui/hooks/media-query';
import { DonationModal } from '@aiostreams/ui/shared/donation-modal';
import { CommandPaletteTopBarButton } from '@/components/shared/command-palette/search-button';
import { DraftRestoreBanner } from '@/components/shared/draft-restore-banner';
import { PlainSections } from '@/components/shared/settings-card';
import { useCommandPalette } from '@/context/command-palette';
import { useConfigAuth } from '@/context/config-auth';
import { PHONE_LAYOUT, useMenu, WIDE_LAYOUT } from '@/context/menu';
import { PageWrapper } from '@/components/shared/page-wrapper';
import { useSave } from '@/context/save';
import { useSession } from '@/context/session';
import { useStatus } from '@/context/status';
import { useUserData } from '@/context/userData';
import {
  PAGE_GROUPS,
  PAGES,
  pageOfField,
  WIDE_PAGES,
  type PageId,
} from '@/lib/configure-pages';
import { configProfilesQuery } from '@/lib/queries';
import { useConfigureQuickActions } from './main-sidebar';
import { PageActions, PageBody } from './pages';
import { PageToc, useToc } from './page-toc';

const ICONS: Record<PageId, IconType> = {
  home: LuHouse,
  services: LuCloud,
  addons: LuBlocks,
  catalogs: LuLibrary,
  filters: LuFilter,
  results: LuListOrdered,
  formatter: LuPenLine,
  playback: LuPlay,
  profiles: LuUsers,
  stremio: SiStremio,
  app: LuTv,
  'other-apps': LuLayoutGrid,
  configuration: LuSettings2,
  advanced: LuSlidersHorizontal,
  stats: LuChartBar,
};

function useChangedPages(): ReadonlySet<PageId> {
  const { changedFields } = useUserData();
  return React.useMemo(
    () =>
      new Set(
        changedFields.flatMap((field) => {
          const page = pageOfField(field);
          return page ? [page] : [];
        })
      ),
    [changedFields]
  );
}

function PageList({
  current,
  onOpen,
  wide,
  changed,
}: {
  current: PageId | null;
  onOpen: (page: PageId) => void;
  wide: boolean;
  changed: ReadonlySet<PageId>;
}) {
  const { pages } = useMenu();
  return (
    <nav className="space-y-5">
      {PAGE_GROUPS.map((group, index) => {
        const shown = group.pages.filter((page) => pages.includes(page));
        if (!shown.length) return null;
        return (
          <div key={group.label ?? index} className="space-y-1">
            {group.label && (
              <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-[--muted]">
                {group.label}
              </p>
            )}
            <ul
              className={cn(
                !wide &&
                  'divide-y divide-[--border] overflow-hidden rounded-xl border border-[--border] bg-gray-950/50'
              )}
            >
              {shown.map((page) => {
                const Icon = ICONS[page];
                const active = page === current;
                return (
                  <li key={page}>
                    <button
                      type="button"
                      onClick={() => onOpen(page)}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex w-full items-center gap-3 text-left transition-colors focus-visible:outline-none',
                        wide
                          ? 'rounded-lg px-3 py-1.5 text-sm hover:bg-[--subtle] focus-visible:bg-[--subtle]'
                          : 'px-4 py-3 text-base hover:bg-[--subtle] focus-visible:bg-[--subtle]',
                        active ? 'bg-[--subtle] text-white' : 'text-gray-300'
                      )}
                    >
                      <Icon
                        className={cn(
                          'h-4 w-4 shrink-0',
                          active ? 'text-brand-300' : 'text-[--muted]'
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {PAGES[page].title}
                      </span>
                      {changed.has(page) && (
                        <span
                          role="img"
                          aria-label="Unsaved changes"
                          title="Unsaved changes"
                          className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400"
                        />
                      )}
                      {!wide && (
                        <LuChevronRight className="h-4 w-4 shrink-0 text-[--muted]" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function Brand() {
  const { status } = useStatus();
  const { userData, uuid } = useUserData();
  const { user } = useSession();
  const saved = useQuery({
    ...configProfilesQuery,
    enabled: !!user && !!uuid,
  }).data?.profiles.find((p) => p.uuid === uuid);
  const which = !uuid
    ? 'Not created yet'
    : saved?.label || saved?.alias || `${uuid.slice(0, 8)}…`;
  return (
    <div className="flex items-center gap-3 px-3">
      <img
        src={userData.addonLogo || '/logo.png'}
        alt=""
        className="h-8 w-8 shrink-0 object-contain"
      />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-white">
          {userData.addonName || status?.settings?.addonName || 'AIOStreams'}
        </p>
        <p className="truncate text-xs text-[--muted]">{which}</p>
      </div>
    </div>
  );
}

function Footer({
  onDonate,
  donate = true,
}: {
  onDonate: () => void;
  donate?: boolean;
}) {
  const navigate = useNavigate();
  const { status } = useStatus();
  const { isSignedIn, toggleSession } = useConfigAuth();
  const item =
    'flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-left text-sm text-gray-300 hover:bg-[--subtle]';
  const version = status?.channel === 'nightly' ? 'nightly' : status?.tag;
  return (
    <div className="space-y-0.5">
      <button
        type="button"
        className={item}
        onClick={(e) =>
          e.ctrlKey || e.metaKey
            ? window.open('/dashboard', '_blank')
            : navigate({ to: '/dashboard' })
        }
      >
        <LuLayoutGrid className="h-4 w-4 text-[--muted]" />
        Dashboard
      </button>
      {donate && (
        <button type="button" className={item} onClick={onDonate}>
          <LuHeart className="h-4 w-4 text-[--muted]" />
          Donate
        </button>
      )}
      <button type="button" className={item} onClick={toggleSession}>
        {isSignedIn ? (
          <LuLogOut className="h-4 w-4 text-[--muted]" />
        ) : (
          <LuLogIn className="h-4 w-4 text-[--muted]" />
        )}
        {isSignedIn ? 'Sign out' : 'Sign in'}
      </button>
      {version && (
        <p className="px-3 pt-2 text-[11px] text-[--muted]">{version}</p>
      )}
    </div>
  );
}

function Sidebar({
  current,
  changed,
  onOpen,
  onSearch,
  onDonate,
}: {
  current: PageId;
  changed: ReadonlySet<PageId>;
  onOpen: (page: PageId) => void;
  onSearch: () => void;
  onDonate: () => void;
}) {
  return (
    <>
      <Brand />
      <div className="flex">
        <CommandPaletteTopBarButton label="Search settings" onOpen={onSearch} />
      </div>
      <div className="-mx-3 min-h-0 flex-1 overflow-y-auto px-3">
        <PageList current={current} onOpen={onOpen} wide changed={changed} />
      </div>
      <Footer onDonate={onDonate} />
    </>
  );
}

function SaveButton({ className }: { className?: string }) {
  const { uuid, unsaved } = useUserData();
  const { handleSave, loading } = useSave();
  const { setPage } = useMenu();
  return (
    <Button
      intent={unsaved ? 'primary' : 'gray-outline'}
      rounded
      className={className}
      loading={loading}
      leftIcon={<LuSave className="h-4 w-4" />}
      onClick={() => (uuid ? handleSave() : setPage('configuration'))}
    >
      {uuid ? (unsaved ? 'Save changes' : 'Saved') : 'Create'}
    </Button>
  );
}

function SignInButton({ compact }: { compact: boolean }) {
  const { isSignedIn, openSignIn } = useConfigAuth();
  if (isSignedIn) return null;
  return compact ? (
    <button
      type="button"
      aria-label="Sign in"
      onClick={() => openSignIn()}
      className="rounded-full p-2 text-[--muted] hover:text-white"
    >
      <LuLogIn className="h-5 w-5" />
    </button>
  ) : (
    <Button
      intent="gray-outline"
      rounded
      leftIcon={<LuLogIn className="h-4 w-4" />}
      onClick={() => openSignIn()}
    >
      Sign in
    </Button>
  );
}

export function NewLayout() {
  const { page, pageTab, listed, setPage, showPages, back, fadeIn } = useMenu();
  const { uuid, unsaved } = useUserData();
  const { open: openSearch } = useCommandPalette();
  const donation = useDisclosure(false);
  const drawer = useDisclosure(false);
  useConfigureQuickActions(donation.open);
  const wide = useMediaQuery(WIDE_LAYOUT);
  const phone = useMediaQuery(PHONE_LAYOUT);
  const changed = useChangedPages();
  const open = (next: PageId) => setPage(next);
  const info = PAGES[page];
  const body = React.useRef<HTMLDivElement>(null);
  const toc = useToc(body, `${page}:${pageTab}:${listed}`);
  const contents = toc.length > 1;
  const width = WIDE_PAGES.includes(page)
    ? 'max-w-screen-2xl'
    : contents
      ? 'max-w-5xl xl:max-w-[76rem]'
      : 'max-w-5xl';

  const search = (
    <div className="flex">
      <CommandPaletteTopBarButton label="Search settings" onOpen={openSearch} />
    </div>
  );

  const donate = (
    <button
      type="button"
      aria-label="Donate"
      onClick={donation.open}
      className={cn(
        'rounded-full p-2 text-[--muted] hover:text-red-300',
        phone && '-mr-2'
      )}
    >
      <LuHeart className="h-5 w-5" />
    </button>
  );

  if (phone && listed) {
    return (
      <div className="space-y-6 px-4 pb-10">
        <div className="sticky top-0 z-10 -mx-4 flex items-center gap-1 bg-gray-950/85 px-4 pb-2 pt-[max(1rem,env(safe-area-inset-top))] backdrop-blur">
          <button
            type="button"
            aria-label="Home"
            onClick={back}
            className="-ml-2 rounded-full p-2 text-[--muted] hover:text-white"
          >
            <LuChevronLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <Brand />
          </div>
          {donate}
        </div>
        {search}
        <DraftRestoreBanner />
        <PageList current={null} onOpen={open} wide={false} changed={changed} />
        <Footer onDonate={donation.open} donate={false} />
        <DonationModal open={donation.isOpen} onOpenChange={donation.toggle} />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      {wide && (
        <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col gap-5 border-r border-[--border] px-3 py-5">
          <Sidebar
            current={page}
            changed={changed}
            onOpen={open}
            onSearch={openSearch}
            onDonate={donation.open}
          />
        </aside>
      )}
      {!wide && !phone && (
        <Drawer
          open={drawer.isOpen}
          onOpenChange={drawer.toggle}
          side="left"
          hideCloseButton
          contentClass="flex w-64 flex-col gap-5 overflow-hidden rounded-none border-0 border-r border-[--border] px-3 py-5"
        >
          <Sidebar
            current={page}
            changed={changed}
            onOpen={(next) => {
              drawer.close();
              open(next);
            }}
            onSearch={() => {
              drawer.close();
              openSearch();
            }}
            onDonate={() => {
              drawer.close();
              donation.open();
            }}
          />
        </Drawer>
      )}
      <main className="flex min-w-0 flex-1 flex-col">
        <header
          data-slide-above
          className="sticky top-0 z-20 border-b border-[--border] bg-gray-950/85 backdrop-blur"
        >
          <div
            className={cn(
              'mx-auto flex items-center gap-3 px-4 py-3 sm:px-8',
              width
            )}
          >
            {!wide && (
              <button
                type="button"
                aria-label={!phone || page === 'home' ? 'All pages' : 'Back'}
                onClick={
                  !phone ? drawer.open : page === 'home' ? showPages : back
                }
                className="-ml-2 rounded-full p-2 text-[--muted] hover:text-white"
              >
                {!phone || page === 'home' ? (
                  <LuMenu className="h-5 w-5" />
                ) : (
                  <LuChevronLeft className="h-5 w-5" />
                )}
              </button>
            )}
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-lg font-semibold text-white">
                {info.title}
              </h1>
              <p className="hidden truncate text-sm text-[--muted] sm:block">
                {info.description}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <PageActions page={page} />
              <SignInButton compact={!wide} />
              {!wide && donate}
              {!phone && <SaveButton />}
            </div>
          </div>
          {contents && (
            <div className={cn('mx-auto -mb-px px-4 sm:px-8 xl:hidden', width)}>
              <PageToc entries={toc} layout="row" />
            </div>
          )}
        </header>
        {/* Down to the bottom of the window, so a short page's slide still
            covers the one beneath it. */}
        <div
          data-slide-scope
          className={cn(
            'mx-auto flex w-full flex-1 gap-10 bg-[--background] px-4 pb-28 pt-6 sm:px-8',
            width
          )}
        >
          <div ref={body} className="min-w-0 flex-1 space-y-6">
            <DraftRestoreBanner />
            <PlainSections.Provider value={true}>
              <PageWrapper
                key={page}
                className="space-y-6"
                {...(fadeIn ? {} : { initial: false })}
              >
                <PageBody page={page} />
              </PageWrapper>
            </PlainSections.Provider>
          </div>
          {contents && (
            <aside className="hidden w-48 shrink-0 xl:block">
              <div className="sticky top-28">
                <PageToc entries={toc} layout="column" />
              </div>
            </aside>
          )}
        </div>
      </main>
      {phone && (uuid ? unsaved : true) && (
        <div
          data-slide-above
          className="fixed inset-x-0 bottom-0 z-30 border-t border-[--border] bg-gray-950/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur"
        >
          <SaveButton className="w-full" />
        </div>
      )}
      <DonationModal open={donation.isOpen} onOpenChange={donation.toggle} />
    </div>
  );
}
