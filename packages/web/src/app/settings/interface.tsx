import { t } from '@lingui/core/macro';
import { Select } from '@aiostreams/ui/select';
import { dateFormat } from '@/lib/format';
import { currentHost } from '@/lib/hosts';
import { HIDDEN_LOCALES, LOCALES, localeName, systemLocale } from '@/lib/i18n';
import {
  settings,
  useSetting,
  type DesktopNavigation,
  type RailNames,
  type RailShape,
  type StartPage,
  type TopBar,
  type TabNames,
  type TimeFormat,
  type TouchNavigation,
  type TvNavigation,
} from '@/lib/settings';
import { SettingsCard } from './_components/settings-card';
import { startPages } from '@/lib/start-page';
import { onDevice, followsYou } from './_components/common';

function startPageName(page: StartPage): string {
  switch (page) {
    case 'home':
      return t`Home`;
    case 'discover':
      return t`Discover`;
    case 'live':
      return t`Live TV`;
    case 'favourites':
      return t`Favourites`;
    case 'calendar':
      return t`Calendar`;
    case 'activity':
      return t`Activity`;
    case 'downloads':
      return t`Downloads`;
  }
}

/** How the navigation looks, with only what this device shows. */
function NavigationCard() {
  const tv = !!currentHost().tv;
  const touch = matchMedia('(pointer: coarse)').matches;
  const [touchNavigation, setTouchNavigation] = useSetting(
    settings.interface.touchNavigation
  );
  const [tvNavigation, setTvNavigation] = useSetting(
    settings.interface.tvNavigation
  );
  const [desktopNavigation, setDesktopNavigation] = useSetting(
    settings.interface.desktopNavigation
  );
  const [topBar, setTopBar] = useSetting(settings.interface.topBar);
  const [tabNames, setTabNames] = useSetting(settings.interface.tabNames);
  const [railShape, setRailShape] = useSetting(settings.interface.railShape);
  const [railNames, setRailNames] = useSetting(settings.interface.railNames);
  const [startPage, setStartPage] = useSetting(settings.interface.startPage);
  const rail = tv
    ? tvNavigation === 'rail'
    : touch && touchNavigation === 'rail';
  const topTabs =
    (tv ? tvNavigation : touch ? touchNavigation : desktopNavigation) === 'top';
  return (
    <SettingsCard
      name="navigation"
      title={t`Navigation`}
      description={onDevice()}
    >
      <Select
        label={t`Start on`}
        help={t`The page the app opens on. A link still opens what it points to.`}
        options={startPages().map((page) => ({
          value: page,
          label: startPageName(page),
        }))}
        value={startPage}
        onValueChange={(value) => setStartPage(value as StartPage)}
      />
      {tv && (
        <Select
          label={t`Style`}
          help={t`Side rail runs down the side of the screen; Top tabs sit along the top of each page.`}
          options={[
            { value: 'rail', label: t`Side rail` },
            { value: 'top', label: t`Top tabs` },
          ]}
          value={tvNavigation}
          onValueChange={(value) => setTvNavigation(value as TvNavigation)}
        />
      )}
      {!tv && touch && (
        <Select
          label={t`On wide screens`}
          help={t`Where the navigation goes when the screen is wide enough for a sidebar, such as a tablet held sideways.`}
          options={[
            { value: 'rail', label: t`Side rail` },
            { value: 'bar', label: t`Bottom bar` },
            { value: 'top', label: t`Top tabs` },
          ]}
          value={touchNavigation}
          onValueChange={(value) =>
            setTouchNavigation(value as TouchNavigation)
          }
        />
      )}
      {!tv && !touch && (
        <Select
          label={t`On wide screens`}
          help={t`Where the navigation goes when the window is wide enough for a sidebar.`}
          options={[
            { value: 'sidebar', label: t`Sidebar` },
            { value: 'top', label: t`Top tabs` },
          ]}
          value={desktopNavigation}
          onValueChange={(value) =>
            setDesktopNavigation(value as DesktopNavigation)
          }
        />
      )}
      {rail && (
        <Select
          label={t`Rail`}
          help={t`Docked keeps it in a column of its own. Floating hovers it over the page, a little in from the edge. Corner button shrinks it to the current page's button in the top corner, which opens into the whole menu.`}
          options={[
            { value: 'docked', label: t`Docked` },
            { value: 'floating', label: t`Floating` },
            { value: 'corner', label: t`Corner button` },
          ]}
          value={railShape}
          onValueChange={(value) => setRailShape(value as RailShape)}
        />
      )}
      {rail && railShape !== 'corner' && (
        <Select
          label={t`Page names`}
          help={
            tv
              ? t`Whether the rail names each page only while you're in it, or all the time.`
              : t`Whether the rail names each page under its icon.`
          }
          options={
            tv
              ? [
                  { value: 'auto', label: t`While you're in it` },
                  { value: 'always', label: t`Always` },
                ]
              : [
                  { value: 'auto', label: t`Shown` },
                  { value: 'never', label: t`Hidden` },
                ]
          }
          value={railNames}
          onValueChange={(value) => setRailNames(value as RailNames)}
        />
      )}
      {topTabs && (
        <Select
          label={t`Top bar`}
          help={t`How the tabs sit over the page: as floating pills, on a bar across the top, or on nothing but a fade down from the top edge.`}
          options={[
            { value: 'pill', label: t`Floating pills` },
            { value: 'bar', label: t`Bar` },
            { value: 'fade', label: t`Fade` },
          ]}
          value={topBar}
          onValueChange={(value) => setTopBar(value as TopBar)}
        />
      )}
      {/* Narrow screens other than a TV always have the bottom bar. */}
      {(!tv || topTabs) && (
        <Select
          label={t`Tab names`}
          help={
            tv
              ? t`Whether the tabs name each page beside its icon.`
              : t`Whether the bar at the bottom, and tabs along the top, name each page.`
          }
          options={[
            { value: 'shown', label: t`Shown` },
            { value: 'hidden', label: t`Hidden` },
          ]}
          value={tabNames}
          onValueChange={(value) => setTabNames(value as TabNames)}
        />
      )}
    </SettingsCard>
  );
}

/** Half past seven in the evening, as `cycle` writes it. */
function sampleTime(cycle: 'h12' | 'h23'): string {
  const at = new Date();
  at.setHours(19, 30, 0, 0);
  return dateFormat({
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: cycle,
  }).format(at);
}

/** The app's own language and clock, each user's. */
function LanguageCard() {
  const [timeFormat, setTimeFormat] = useSetting(settings.interface.timeFormat);
  const [language, setLanguage] = useSetting(settings.interface.language);
  const twelve = sampleTime('h12');
  const twentyFour = sampleTime('h23');
  const listed = LOCALES.filter(
    (l) => !HIDDEN_LOCALES.includes(l) || import.meta.env.DEV || l === language
  )
    .map((l) => ({ value: l, label: localeName(l) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const system = localeName(systemLocale());
  return (
    <SettingsCard
      name="language"
      title={t`Language`}
      description={followsYou()}
    >
      <Select
        label={t`App language`}
        help={t`Titles, synopses and version names stay in the language the server sends.`}
        options={[{ value: 'auto', label: t`System (${system})` }, ...listed]}
        value={LOCALES.includes(language) ? language : 'auto'}
        onValueChange={setLanguage}
      />
      <Select
        label={t`Time format`}
        help={t`For clocks and times of day, such as the player's clock and the TV guide.`}
        options={[
          { value: 'auto', label: t`Automatic` },
          { value: '12', label: t`12-hour (${twelve})` },
          { value: '24', label: t`24-hour (${twentyFour})` },
        ]}
        value={timeFormat}
        onValueChange={(value) => setTimeFormat(value as TimeFormat)}
      />
    </SettingsCard>
  );
}

export function InterfaceSection() {
  return (
    <>
      <LanguageCard />
      <NavigationCard />
    </>
  );
}
