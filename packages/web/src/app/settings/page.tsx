import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useReducedMotion } from 'motion/react';
import type { IconType } from 'react-icons';
import {
  LuAppWindow,
  LuCaptions,
  LuChevronRight,
  LuCirclePlay,
  LuDatabase,
  LuDownload,
  LuHeart,
  LuInfo,
  LuKeyboard,
  LuLayoutGrid,
  LuMonitor,
  LuMonitorPlay,
  LuSmartphone,
  LuPalette,
  LuPanelsTopLeft,
  LuSearch,
  LuTv,
  LuUser,
  LuVolume2,
} from 'react-icons/lu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@aiostreams/ui/tabs';
import { Card } from '@aiostreams/ui/card';
import { Button } from '@aiostreams/ui/button';
import { TextInput } from '@aiostreams/ui/text-input';
import { cn } from '@aiostreams/ui/core/styling';
import { DonationModal } from '@aiostreams/ui/shared/donation-modal';
import { useDisclosure } from '@aiostreams/ui/hooks/disclosure';
import { useMediaQuery } from '@aiostreams/ui/hooks/media-query';
import { currentHost } from '@/lib/hosts';
import { shellHost } from '@/lib/hosts/shell';
import { navigate, to } from '@/lib/paths';
import { canPlayWithWebGpu } from '@/lib/playback/player-choice';
import { BackButton } from '@/components/back-button';
import { PageBody } from '@/components/shell/page';
import { PageScroll } from '@/components/shell/page-scroll';
import { ShortcutSettings } from './_components/shortcut-settings';
import {
  hasWords,
  searchWords,
  SettingsPageHeader,
  SettingsSearch,
} from './_components/settings-card';
import { PlaybackSection } from './playback';
import { PlayerSection } from './player';
import { AudioSection } from './audio';
import { SubtitlesSection } from './subtitles';
import { InterfaceSection } from './interface';
import { BrowsingSection } from './browsing';
import { ThemeSection } from './theme';
import { CacheSection } from './cache';
import { DownloadsSection } from './downloads';
import { AccountSection } from './account';
import { AppSection, DesktopSection, AndroidSection } from './apps';
import { AboutSection } from './about';

type Group = 'watching' | 'look' | 'app';

interface Section {
  id: string;
  label: string;
  description: string;
  icon: IconType;
  group: Group;
  Content: React.ComponentType;
}

const groupLabel = (group: Group) =>
  ({ watching: t`Watching`, look: t`Look and feel`, app: t`App` })[group];

function sections(): Section[] {
  const host = currentHost();
  const picture = !!shellHost() || (!host.player && canPlayWithWebGpu());
  return [
    {
      id: 'playback',
      label: t`Playback`,
      description: t`Versions, next episode and skipping`,
      icon: LuCirclePlay,
      group: 'watching' as const,
      Content: PlaybackSection,
    },
    {
      id: 'player',
      label: t`Player`,
      description: picture
        ? t`The player, its controls and video`
        : t`The player and its controls`,
      icon: LuMonitorPlay,
      group: 'watching' as const,
      Content: PlayerSection,
    },
    {
      id: 'audio',
      label: t`Audio`,
      description: shellHost() ? t`Language and output` : t`Language`,
      icon: LuVolume2,
      group: 'watching' as const,
      Content: AudioSection,
    },
    {
      id: 'subtitles',
      label: t`Subtitles`,
      description: t`Language and how subtitles look`,
      icon: LuCaptions,
      group: 'watching' as const,
      Content: SubtitlesSection,
    },
    {
      id: 'interface',
      label: t`Interface`,
      description: t`Language and navigation`,
      icon: LuPanelsTopLeft,
      group: 'look' as const,
      Content: InterfaceSection,
    },
    {
      id: 'browsing',
      label: t`Browsing`,
      description: t`Home, posters, trailers and episodes`,
      icon: LuLayoutGrid,
      group: 'look' as const,
      Content: BrowsingSection,
    },
    {
      id: 'theme',
      label: t`Theme`,
      description: t`Colours, glass and custom CSS`,
      icon: LuPalette,
      group: 'look' as const,
      Content: ThemeSection,
    },
    // A touch screen has no keys to set, and a remote too few to move around.
    ...(host.tv || matchMedia('(pointer: coarse)').matches
      ? []
      : [
          {
            id: 'shortcuts',
            label: t`Shortcuts`,
            description: t`Keys, remotes and gamepads`,
            icon: LuKeyboard,
            group: 'look' as const,
            Content: ShortcutSettings,
          },
        ]),
    {
      id: 'account',
      label: t`Account`,
      description: t`Who you are signed in as`,
      icon: LuUser,
      group: 'app' as const,
      Content: AccountSection,
    },
    ...(host.downloads
      ? [
          {
            id: 'downloads',
            label: t`Downloads`,
            description: t`Where they go and how many run at once`,
            icon: LuDownload,
            group: 'app' as const,
            Content: DownloadsSection,
          },
        ]
      : []),
    {
      id: 'cache',
      label: t`Cache`,
      description: t`Pages and artwork saved on this device`,
      icon: LuDatabase,
      group: 'app' as const,
      Content: CacheSection,
    },
    ...(host.name === 'desktop'
      ? [
          {
            id: 'desktop',
            label: t`Desktop app`,
            description: t`Updates, Discord and troubleshooting`,
            icon: LuMonitor,
            group: 'app' as const,
            Content: DesktopSection,
          },
        ]
      : []),
    ...(host.name === 'android-app'
      ? [
          {
            id: 'android',
            label: t`Android app`,
            description: t`Updates and troubleshooting`,
            icon: host.tv ? LuTv : LuSmartphone,
            group: 'app' as const,
            Content: AndroidSection,
          },
        ]
      : []),
    ...(host.settings
      ? [
          {
            id: 'app',
            label: host.settings.label,
            description: host.settings.description,
            icon: LuAppWindow,
            group: 'app' as const,
            Content: AppSection,
          },
        ]
      : []),
    {
      id: 'about',
      label: t`About`,
      description: t`Versions and links`,
      icon: LuInfo,
      group: 'app' as const,
      Content: AboutSection,
    },
  ];
}

function grouped(all: Section[]): [Group, Section[]][] {
  const groups = new Map<Group, Section[]>();
  for (const s of all) groups.set(s.group, [...(groups.get(s.group) ?? []), s]);
  return [...groups.entries()];
}

/** Memoised, so a search narrows its cards without building the section again. */
const SectionContent = React.memo(function SectionContent({
  section,
}: {
  section: Section;
}) {
  return <section.Content />;
});

/** Memoised, so focus moving along the tabs leaves the open section alone. */
const SectionPanel = React.memo(function SectionPanel({
  section,
}: {
  section: Section;
}) {
  return (
    <>
      <SettingsPageHeader
        title={section.label}
        description={section.description}
        icon={section.icon}
      />
      <section.Content />
    </>
  );
});

function SearchField({
  value,
  onChange,
}: {
  value: string;
  onChange(value: string): void;
}) {
  return (
    <TextInput
      type="search"
      autoComplete="off"
      enterKeyHint="search"
      aria-label={t`Search settings`}
      placeholder={t`Search settings`}
      leftIcon={<LuSearch className="text-lg" />}
      data-ui="settings-search"
      value={value}
      onValueChange={onChange}
    />
  );
}

const SHOWN_CARD = '[data-ui=settings-card]:not([hidden])';

const WHOLE: readonly string[] = [];

function SearchResults({
  all,
  words,
}: {
  all: Section[];
  words: readonly string[];
}) {
  const list = React.useRef<HTMLDivElement>(null);
  const [none, setNone] = React.useState(false);
  // Watched rather than counted once, as lines come and go while sections load.
  React.useLayoutEffect(() => {
    const root = list.current;
    if (!root) return;
    const sync = () => {
      let found = false;
      for (const section of root.children) {
        const empty = !section.querySelector(SHOWN_CARD);
        if ((section as HTMLElement).hidden !== empty)
          (section as HTMLElement).hidden = empty;
        found ||= !empty;
      }
      setNone(!found);
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributeFilter: ['hidden'],
    });
    return () => observer.disconnect();
  }, []);
  return (
    <>
      <div ref={list} data-ui="settings-results" className="space-y-10">
        {all.map((s) => (
          <div
            key={s.id}
            data-ui="settings-panel"
            data-name={s.id}
            className="space-y-6"
          >
            <SettingsPageHeader
              title={s.label}
              description={s.description}
              icon={s.icon}
            />
            <SettingsSearch.Provider
              value={hasWords(s.label, words) ? WHOLE : words}
            >
              <SectionContent section={s} />
            </SettingsSearch.Provider>
          </div>
        ))}
      </div>
      {none && (
        <p data-ui="settings-no-results" className="text-[--muted]">
          <Trans>No setting matches.</Trans>
        </p>
      )}
    </>
  );
}

function DonateButton({ onClick }: { onClick(): void }) {
  return (
    <div className="flex basis-full justify-center pt-1">
      <Button
        data-ui="settings-donate"
        size="sm"
        intent="gray-outline"
        className="rounded-full"
        leftIcon={<LuHeart />}
        onClick={onClick}
      >
        <Trans>Donate</Trans>
      </Button>
    </div>
  );
}

function NarrowSettings({
  all,
  picked,
  query,
  words,
  onQuery,
  onDonate,
}: {
  all: Section[];
  picked: Section | undefined;
  query: string;
  words: readonly string[];
  onQuery(query: string): void;
  onDonate(): void;
}) {
  const [listY, setListY] = React.useState(0);
  const open = (id: string) => {
    setListY(window.scrollY);
    navigate(to.settings(id));
  };
  return (
    <div className="relative">
      {/* Kept under an open section, where a back swipe shows it as it was left. */}
      <div
        data-back-under={to.settings()}
        data-back-y={listY}
        inert={!!picked}
        className={cn(
          'isolate',
          picked &&
            'invisible absolute inset-x-0 top-0 [content-visibility:hidden]'
        )}
      >
        <PageBody>
          <h1 data-ui="page-title" className="text-3xl font-bold">
            <Trans>Settings</Trans>
          </h1>
          <SearchField value={query} onChange={onQuery} />
          {words.length ? (
            <SearchResults all={all} words={words} />
          ) : (
            <div data-ui="settings-tabs" data-nav-start className="space-y-4">
              {grouped(all).map(([group, items]) => (
                <div key={group} className="space-y-2">
                  <p className="px-1 text-[10px] font-semibold uppercase tracking-wider text-[--muted]">
                    {groupLabel(group)}
                  </p>
                  <Card
                    data-ui="settings-tab-group"
                    data-name={group}
                    className="divide-y-2 divide-gray-700/40 overflow-clip rounded-xl border-white/10 bg-gray-950/70"
                  >
                    {items.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        data-ui="settings-tab"
                        data-name={s.id}
                        className="flex w-full items-center gap-3 p-3 text-start transition-colors active:bg-gray-900 focus-visible:!-outline-offset-2 [@media(hover:hover)]:hover:bg-gray-900"
                        onClick={() => open(s.id)}
                      >
                        <s.icon className="flex-none text-xl text-[--muted]" />
                        <span className="min-w-0 flex-1">
                          <span className="block font-semibold">{s.label}</span>
                          <span className="block text-sm text-[--muted]">
                            {s.description}
                          </span>
                        </span>
                        <LuChevronRight className="flex-none text-[--muted] rtl:-scale-x-100" />
                      </button>
                    ))}
                  </Card>
                </div>
              ))}
              <DonateButton onClick={onDonate} />
            </div>
          )}
        </PageBody>
      </div>
      {picked && (
        <div data-back-slide className="relative isolate">
          <PageBody>
            <div
              data-ui="settings-panel"
              data-name={picked.id}
              className="space-y-6 duration-300 animate-in fade-in-0 slide-in-from-bottom-2"
            >
              <SettingsPageHeader
                title={picked.label}
                description={picked.description}
                icon={picked.icon}
                leading={<BackButton fallback={to.settings()} />}
              />
              <SectionContent section={picked} />
            </div>
          </PageBody>
        </div>
      )}
      <PageScroll key={picked?.id ?? 'list'} />
    </div>
  );
}

function WideSettings({
  all,
  active,
  query,
  words,
  onQuery,
  onDonate,
}: {
  all: Section[];
  active: Section;
  query: string;
  words: readonly string[];
  onQuery(query: string): void;
  onDonate(): void;
}) {
  // With no marker sliding, the tabs keep the usual focus mark.
  const still = useReducedMotion();
  // Built in the background, so a key can cut short a section still building.
  const shown = React.useDeferredValue(active.id);
  const [focused, setFocused] = React.useState<string | null>(null);
  const searching = words.length > 0;
  const open = (id: string) => {
    onQuery('');
    navigate(to.settings(id), { replace: true });
  };

  return (
    <PageBody>
      <h1 data-ui="page-title" className="text-3xl font-bold">
        <Trans>Settings</Trans>
      </h1>
      <Tabs
        value={searching ? '' : shown}
        onValueChange={open}
        activationMode="manual"
        marked={focused ?? undefined}
        variant="pill"
        className="grid w-full grid-cols-[240px,1fr] gap-6"
        triggerClass={cn(
          'h-9 w-full justify-start rounded-lg border-0 px-3 text-base',
          'data-[state=active]:bg-[--subtle] data-[state=active]:text-white dark:hover:text-white',
          'transition duration-200 hover:bg-white/[0.03] focus-visible:ring-0 focus-visible:ring-offset-0',
          'motion-reduce:[[data-tv]_&]:focus-visible:bg-white/20'
        )}
        // The sliding marker carries the focus mark, so the two move together.
        indicatorClass="group-focus-visible:outline group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-[--ring] [[data-tv]_&]:group-focus-visible:bg-white/20 [[data-tv]_&]:group-focus-visible:outline-none [html[data-pointer-focus]_&]:!outline-none"
        listClass="block h-fit w-full space-y-3"
      >
        <div
          data-sticky
          className="sticky top-6 z-[1] flex max-h-[calc(100vh-3rem)] flex-col gap-3 self-start"
        >
          <SearchField value={query} onChange={onQuery} />
          <TabsList
            data-ui="settings-tabs"
            data-nav-enter="[role=tab][data-state=active]"
            className="min-h-0 overflow-y-auto"
          >
            {grouped(all).map(([group, items]) => (
              <Card
                key={group}
                data-ui="settings-tab-group"
                data-name={group}
                className="border border-white/10 bg-gray-950/70 p-2"
              >
                <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[--muted]">
                  {groupLabel(group)}
                </p>
                {items.map((s) => (
                  <TabsTrigger
                    key={s.id}
                    value={s.id}
                    data-ui="settings-tab"
                    data-name={s.id}
                    data-nav-start={
                      (!searching && s.id === active.id) || undefined
                    }
                    data-focus={still && !currentHost().tv ? undefined : 'own'}
                    className="group"
                    onFocus={() => {
                      setFocused(s.id);
                      // Results stay up while focus passes the tabs to reach them.
                      if (!searching) open(s.id);
                    }}
                    onBlur={() => setFocused(null)}
                  >
                    <s.icon className="me-3 text-xl transition-transform duration-200 group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5" />
                    {s.label}
                  </TabsTrigger>
                ))}
              </Card>
            ))}
            <DonateButton onClick={onDonate} />
          </TabsList>
        </div>
        <div className="min-w-0">
          {searching ? (
            <SearchResults all={all} words={words} />
          ) : (
            all.map((s) => (
              <TabsContent
                key={s.id}
                value={s.id}
                tabIndex={-1}
                data-ui="settings-panel"
                data-name={s.id}
                className="space-y-6 duration-300 animate-in fade-in-0 slide-in-from-bottom-2"
              >
                {s.id === shown && <SectionPanel section={s} />}
              </TabsContent>
            ))
          )}
        </div>
      </Tabs>
    </PageBody>
  );
}

export function SettingsPage({ tab }: { tab: string }) {
  const all = React.useMemo(sections, []);
  const donation = useDisclosure(false);
  const wide = useMediaQuery('(min-width: 1024px)');
  const [query, setQuery] = React.useState('');
  const typed = React.useMemo(() => searchWords(query), [query]);
  // Every section builds for a search, which typing shouldn't wait on.
  const words = React.useDeferredValue(typed);
  const picked = all.find((s) => s.id === tab);
  const shared = {
    all,
    query,
    words,
    onQuery: setQuery,
    onDonate: donation.open,
  };

  return (
    <>
      {wide ? (
        <WideSettings {...shared} active={picked ?? all[0]} />
      ) : (
        <NarrowSettings {...shared} picked={picked} />
      )}
      <DonationModal open={donation.isOpen} onOpenChange={donation.toggle} />
    </>
  );
}
