import { t } from '@lingui/core/macro';
import { Select } from '@aiostreams/ui/select';
import { Combobox } from '@aiostreams/ui/combobox';
import { Switch } from '@aiostreams/ui/switch';
import { useViews } from '../../lib/queries';
import { libraryLabel } from '../../lib/format';
import { currentHost } from '../../lib/hosts';
import {
  LOCALES,
  PSEUDO_LOCALES,
  localeName,
  systemLocale,
} from '../../lib/i18n';
import { canRefract } from '../../components/bar-surface';
import {
  settings,
  useSetting,
  MAX_FEATURED,
  type EpisodeLayout,
  type BarBackground,
  type RailNames,
  type RailShape,
  type TouchNavigation,
  type TvNavigation,
  type TvTopBar,
  type HeroMode,
  type PosterLine,
  type PosterSize,
} from '../../lib/settings';
import { SettingsCard } from '../../components/settings-card';
import { onDevice, followsYou } from './common';

const NOTHING = 'none';

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
  const [tvTopBar, setTvTopBar] = useSetting(settings.interface.tvTopBar);
  const [railShape, setRailShape] = useSetting(settings.interface.railShape);
  const [railNames, setRailNames] = useSetting(settings.interface.railNames);
  const [background, setBackground] = useSetting(
    settings.interface.barBackground
  );
  const rail = tv
    ? tvNavigation === 'rail'
    : touch && touchNavigation === 'rail';
  // A TV's docked rail and fade sit on nothing.
  const onBar = !tv || (rail ? railShape !== 'docked' : tvTopBar !== 'fade');
  return (
    <SettingsCard
      name="navigation"
      title={t`Navigation`}
      description={onDevice()}
    >
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
          ]}
          value={touchNavigation}
          onValueChange={(value) =>
            setTouchNavigation(value as TouchNavigation)
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
      {tv && tvNavigation === 'top' && (
        <Select
          label={t`Top bar`}
          help={t`How the tabs sit over the page: as floating pills, on a bar across the top, or on nothing but a fade down from the top edge.`}
          options={[
            { value: 'pill', label: t`Floating pills` },
            { value: 'bar', label: t`Bar` },
            { value: 'fade', label: t`Fade` },
          ]}
          value={tvTopBar}
          onValueChange={(value) => setTvTopBar(value as TvTopBar)}
        />
      )}
      {onBar && (
        <Select
          label={t`Background`}
          help={t`What the navigation sits on over the page: the app's own colour, or glass that shows the page through it. Liquid glass also bends what's behind its edges, which costs more on a slow device.`}
          options={[
            { value: 'solid', label: t`Solid` },
            { value: 'frosted', label: t`Frosted glass` },
            ...(canRefract
              ? [{ value: 'liquid', label: t`Liquid glass` }]
              : []),
          ]}
          value={
            background === 'liquid' && !canRefract ? 'frosted' : background
          }
          onValueChange={(value) => setBackground(value as BarBackground)}
        />
      )}
    </SettingsCard>
  );
}

/** The app's own language, each user's; test languages are listed in development only. */
function LanguageCard() {
  const [language, setLanguage] = useSetting(settings.interface.language);
  const listed = LOCALES.filter(
    (l) => !PSEUDO_LOCALES.includes(l) || import.meta.env.DEV || l === language
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
        help={t`Titles, synopses and stream names stay in the language your addons send.`}
        options={[{ value: 'auto', label: t`System (${system})` }, ...listed]}
        value={LOCALES.includes(language) ? language : 'auto'}
        onValueChange={setLanguage}
      />
    </SettingsCard>
  );
}

export function InterfaceSection() {
  const views = useViews();
  const [featured, setFeatured] = useSetting(settings.interface.featured);
  const [heroMode, setHeroMode] = useSetting(settings.interface.heroMode);
  const [mergeNextUp, setMergeNextUp] = useSetting(
    settings.interface.mergeNextUp
  );
  const [combineSearch, setCombineSearch] = useSetting(
    settings.interface.combineSearch
  );
  const [posterSize, setPosterSize] = useSetting(settings.interface.posterSize);
  const [posterLines, setPosterLines] = useSetting(
    settings.interface.posterLines
  );
  const [episodeLayout, setEpisodeLayout] = useSetting(
    settings.interface.episodeLayout
  );

  const option = (value: string, label: string) => ({
    value,
    label,
    textValue: label,
  });
  const featuredOptions = [
    option('resume', t`Continue watching`),
    option('next-up', t`Next up`),
    ...(views.data?.Items ?? []).map((v) =>
      option(
        `view:${v.Id}`,
        [v.Name, libraryLabel(v)].filter(Boolean).join(' · ')
      )
    ),
    option(NOTHING, t`Nothing`),
  ];
  // Catalogs since removed would count towards the limit without showing.
  const known = new Set(featuredOptions.map((o) => o.value));
  const featuredValue =
    featured === 'auto'
      ? []
      : !featured.length
        ? [NOTHING]
        : views.data
          ? featured.filter((s) => known.has(s))
          : featured;
  // Nothing excludes every other choice.
  const changeFeatured = (next: string[]) => {
    const added = next.filter((v) => !featuredValue.includes(v));
    if (added.includes(NOTHING)) setFeatured([]);
    else {
      const sources = next.filter((v) => v !== NOTHING);
      setFeatured(sources.length ? sources : 'auto');
    }
  };

  return (
    <>
      <LanguageCard />
      <SettingsCard
        name="home-and-grids"
        title={t`Home and grids`}
        description={followsYou()}
      >
        <Combobox
          multiple
          label={t`Featured on home`}
          help={t`Up to ${MAX_FEATURED}, mixed together. Left empty, your first movie and series catalogs are featured.`}
          placeholder={t`Automatic`}
          emptyMessage={t`Nothing matches.`}
          options={featuredOptions}
          maxItems={MAX_FEATURED}
          value={featuredValue}
          onValueChange={changeFeatured}
        />
        <Select
          label={t`Hero`}
          help={t`Following pins it above the rows and shows the card the pointer, keyboard or remote is on, starting with a featured title, behind the whole page or in its top corner. Touch screens and narrow windows keep it rotating.`}
          options={[
            { value: 'rotate', label: t`Rotates through featured titles` },
            { value: 'follow', label: t`Follows the selected card` },
            {
              value: 'corner',
              label: t`Follows the selected card, in the corner`,
            },
            // A remote's focus opens the cards; elsewhere it rotates.
            ...(currentHost().tv
              ? [
                  {
                    value: 'open',
                    label: t`Opens the selected card out, with its details`,
                  },
                ]
              : []),
          ]}
          value={heroMode}
          onValueChange={(value) => setHeroMode(value as HeroMode)}
        />
        <Switch
          side="right"
          label={t`Merge continue watching and next up`}
          help={t`Shows next episodes in the continue watching row, after what you are partway through.`}
          value={mergeNextUp}
          onValueChange={setMergeNextUp}
        />
        <Switch
          side="right"
          label={t`Combine movie and show results`}
          help={t`Shows search results in one grid instead of a row each for movies and shows.`}
          value={combineSearch}
          onValueChange={setCombineSearch}
        />
        <Select
          label={t`Poster size`}
          help={t`How large cards are in a grid.`}
          options={[
            { value: 'small', label: t`Small` },
            { value: 'medium', label: t`Medium` },
            { value: 'large', label: t`Large` },
          ]}
          value={posterSize}
          onValueChange={(value) => setPosterSize(value as PosterSize)}
        />
        <Combobox
          multiple
          label={t`Under posters`}
          help={t`Left empty, posters stand alone. A poster without artwork still shows its title.`}
          placeholder={t`Nothing`}
          emptyMessage={t`Nothing matches.`}
          options={[option('title', t`Title`), option('year', t`Year`)]}
          value={posterLines}
          onValueChange={(value) => setPosterLines(value as PosterLine[])}
        />
      </SettingsCard>
      <SettingsCard
        name="episodes"
        title={t`Episodes`}
        description={onDevice()}
      >
        <Select
          label={t`Episode layout`}
          help={t`Automatic lists episodes on narrow screens and puts them in a row on wide ones.`}
          options={[
            { value: 'auto', label: t`Automatic` },
            { value: 'row', label: t`Row` },
            { value: 'list', label: t`List` },
          ]}
          value={episodeLayout}
          onValueChange={(value) => setEpisodeLayout(value as EpisodeLayout)}
        />
      </SettingsCard>
      <NavigationCard />
    </>
  );
}
