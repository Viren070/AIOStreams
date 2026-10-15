import React from 'react';
import { useReducedMotion } from 'motion/react';
import type { IconType } from 'react-icons';
import {
  LuAppWindow,
  LuCaptions,
  LuCirclePlay,
  LuDatabase,
  LuDownload,
  LuHeart,
  LuInfo,
  LuKeyboard,
  LuLayoutGrid,
  LuMonitor,
  LuSmartphone,
  LuPalette,
  LuTv,
  LuUser,
  LuVolume2,
} from 'react-icons/lu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@aiostreams/ui/tabs';
import { Card } from '@aiostreams/ui/card';
import { Button } from '@aiostreams/ui/button';
import { cn } from '@aiostreams/ui/core/styling';
import { DonationModal } from '@aiostreams/ui/shared/donation-modal';
import { useDisclosure } from '@aiostreams/ui/hooks/disclosure';
import { currentHost } from '../../lib/hosts';
import { shellHost } from '../../lib/hosts/shell';
import { appBridge } from '../../lib/hosts/shell/bridge';
import { PageBody } from '../../components/layout';
import { ShortcutSettings } from '../../components/shortcut-settings';
import { SettingsPageHeader } from '../../components/settings-card';
import { PlaybackSection } from './playback';
import { AudioSection } from './audio';
import { SubtitlesSection } from './subtitles';
import { InterfaceSection } from './interface';
import { ThemeSection } from './theme';
import { CacheSection } from './cache';
import { DownloadsSection } from './downloads';
import { AccountSection } from './account';
import { AppSection, DesktopSection, AndroidSection } from './apps';
import { AboutSection } from './about';

interface Section {
  id: string;
  label: string;
  description: string;
  icon: IconType;
  group: string;
  Content: React.ComponentType;
}

function sections(): Section[] {
  const host = currentHost();
  return [
    {
      id: 'playback',
      label: 'Playback',
      description: 'Next episode, controls and players',
      icon: LuCirclePlay,
      group: 'Watching',
      Content: PlaybackSection,
    },
    {
      id: 'audio',
      label: 'Audio',
      description: shellHost() ? 'Language and output' : 'Language',
      icon: LuVolume2,
      group: 'Watching',
      Content: AudioSection,
    },
    {
      id: 'subtitles',
      label: 'Subtitles',
      description: 'Language and how subtitles look',
      icon: LuCaptions,
      group: 'Watching',
      Content: SubtitlesSection,
    },
    {
      id: 'interface',
      label: 'Interface',
      description: 'Home, grids and episodes',
      icon: LuLayoutGrid,
      group: 'App',
      Content: InterfaceSection,
    },
    // A touch screen has no keys to set, and a remote too few to move around.
    ...(host.tv || matchMedia('(pointer: coarse)').matches
      ? []
      : [
          {
            id: 'shortcuts',
            label: 'Shortcuts',
            description: 'Keys, remotes and gamepads',
            icon: LuKeyboard,
            group: 'App',
            Content: ShortcutSettings,
          },
        ]),
    {
      id: 'theme',
      label: 'Theme',
      description: 'Colours and custom CSS',
      icon: LuPalette,
      group: 'App',
      Content: ThemeSection,
    },
    ...(host.downloads
      ? [
          {
            id: 'downloads',
            label: 'Downloads',
            description: 'Where they go and how many run at once',
            icon: LuDownload,
            group: 'App',
            Content: DownloadsSection,
          },
        ]
      : []),
    {
      id: 'cache',
      label: 'Cache',
      description: 'Pages and artwork saved on this device',
      icon: LuDatabase,
      group: 'App',
      Content: CacheSection,
    },
    {
      id: 'account',
      label: 'Account',
      description: 'Who you are signed in as',
      icon: LuUser,
      group: 'App',
      Content: AccountSection,
    },
    ...(host.name === 'desktop'
      ? [
          {
            id: 'desktop',
            label: 'Desktop app',
            description: 'Updates, Discord, mpv and troubleshooting',
            icon: LuMonitor,
            group: 'App',
            Content: DesktopSection,
          },
        ]
      : []),
    ...(host.name === 'android-app'
      ? [
          {
            id: 'android',
            label: 'Android app',
            description:
              appBridge()?.pip === false
                ? 'Updates, mpv and troubleshooting'
                : 'Updates, picture-in-picture, mpv and troubleshooting',
            icon: host.tv ? LuTv : LuSmartphone,
            group: 'App',
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
            group: 'App',
            Content: AppSection,
          },
        ]
      : []),
    {
      id: 'about',
      label: 'About',
      description: 'Versions and links',
      icon: LuInfo,
      group: 'App',
      Content: AboutSection,
    },
  ];
}

const TAB_REST_MS = 350;

export function SettingsPage({
  tab,
  onTabChange,
}: {
  tab: string;
  onTabChange(tab: string): void;
}) {
  const all = React.useMemo(sections, []);
  const donation = useDisclosure(false);
  // With no marker sliding, the tabs keep the usual focus mark.
  const still = useReducedMotion();
  const active = all.find((s) => s.id === tab) ?? all[0];
  // Passing through tabs would build every section on the way.
  const [focused, setFocused] = React.useState<string | null>(null);
  const resting = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  React.useEffect(() => () => clearTimeout(resting.current), []);
  const groups = new Map<string, Section[]>();
  for (const s of all) groups.set(s.group, [...(groups.get(s.group) ?? []), s]);

  return (
    <PageBody>
      <h1 data-ui="page-title" className="text-3xl font-bold">
        Settings
      </h1>
      <Tabs
        value={active.id}
        onValueChange={onTabChange}
        activationMode="manual"
        marked={focused ?? undefined}
        variant="pill"
        className="grid w-full grid-cols-1 gap-6 lg:grid-cols-[240px,1fr]"
        triggerClass={cn(
          'h-9 w-fit rounded-lg border-0 px-3 text-base lg:w-full lg:justify-start',
          'data-[state=active]:bg-[--subtle] data-[state=active]:text-white dark:hover:text-white',
          'transition duration-200 hover:bg-[--subtle]/50 focus-visible:ring-0 focus-visible:ring-offset-0',
          'motion-reduce:[[data-tv]_&]:focus-visible:bg-white/20'
        )}
        // The sliding marker carries the focus mark, so the two move together.
        indicatorClass="group-focus-visible:outline group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-[--ring] [[data-tv]_&]:group-focus-visible:bg-white/20 [[data-tv]_&]:group-focus-visible:outline-none [html[data-pointer-focus]_&]:!outline-none"
        listClass="h-fit w-full flex flex-wrap lg:block lg:flex-nowrap"
      >
        <TabsList
          data-ui="settings-tabs"
          data-sticky
          data-nav-enter="[role=tab][data-state=active]"
          className="max-w-full flex-wrap lg:sticky lg:top-6 lg:space-y-3"
        >
          {[...groups.entries()].map(([group, items]) => (
            <Card
              key={group}
              data-ui="settings-tab-group"
              data-name={group.toLowerCase()}
              className="contents border-0 bg-transparent lg:block lg:border lg:border-white/10 lg:bg-gray-950/70 lg:p-2"
            >
              <p className="hidden px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[--muted] lg:block">
                {group}
              </p>
              {items.map((s) => (
                <TabsTrigger
                  key={s.id}
                  value={s.id}
                  data-ui="settings-tab"
                  data-name={s.id}
                  data-focus={still && !currentHost().tv ? undefined : 'own'}
                  className="group"
                  onFocus={() => {
                    setFocused(s.id);
                    clearTimeout(resting.current);
                    resting.current = setTimeout(
                      () => onTabChange(s.id),
                      TAB_REST_MS
                    );
                  }}
                  onBlur={() => {
                    setFocused(null);
                    clearTimeout(resting.current);
                  }}
                >
                  <s.icon className="mr-3 text-xl transition-transform duration-200 group-hover:translate-x-0.5" />
                  {s.label}
                </TabsTrigger>
              ))}
            </Card>
          ))}
          <div className="flex basis-full justify-center pt-1">
            <Button
              data-ui="settings-donate"
              size="sm"
              intent="gray-outline"
              className="rounded-full"
              leftIcon={<LuHeart />}
              onClick={donation.open}
            >
              Donate
            </Button>
          </div>
        </TabsList>
        <div className="min-w-0">
          {all.map((s) => (
            <TabsContent
              key={s.id}
              value={s.id}
              tabIndex={-1}
              data-ui="settings-panel"
              data-name={s.id}
              className="space-y-6 duration-300 animate-in fade-in-0 slide-in-from-bottom-2"
            >
              {s.id === active.id && (
                <>
                  <SettingsPageHeader
                    title={s.label}
                    description={s.description}
                    icon={s.icon}
                  />
                  <s.Content />
                </>
              )}
            </TabsContent>
          ))}
        </div>
      </Tabs>
      <DonationModal open={donation.isOpen} onOpenChange={donation.toggle} />
    </PageBody>
  );
}
