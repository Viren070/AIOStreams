import { Select } from '@aiostreams/ui/select';
import { Combobox } from '@aiostreams/ui/combobox';
import { Switch } from '@aiostreams/ui/switch';
import { useViews } from '../../lib/queries';
import { libraryLabel } from '../../lib/format';
import { currentHost } from '../../lib/hosts';
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
import { ON_DEVICE, FOLLOWS_YOU } from './common';

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
    <SettingsCard title="Navigation" description={ON_DEVICE}>
      {tv && (
        <Select
          label="Style"
          help="Side rail runs down the left of the screen; Top tabs sit along the top of each page."
          options={[
            { value: 'rail', label: 'Side rail' },
            { value: 'top', label: 'Top tabs' },
          ]}
          value={tvNavigation}
          onValueChange={(value) => setTvNavigation(value as TvNavigation)}
        />
      )}
      {!tv && touch && (
        <Select
          label="On wide screens"
          help="Where the navigation goes when the screen is wide enough for a sidebar, such as a tablet held sideways."
          options={[
            { value: 'rail', label: 'Side rail' },
            { value: 'bar', label: 'Bottom bar' },
          ]}
          value={touchNavigation}
          onValueChange={(value) =>
            setTouchNavigation(value as TouchNavigation)
          }
        />
      )}
      {rail && (
        <Select
          label="Rail"
          help="Docked keeps it in a column of its own. Floating hovers it over the page, a little in from the edge. Corner button shrinks it to the current page's button in the top corner, which opens into the whole menu."
          options={[
            { value: 'docked', label: 'Docked' },
            { value: 'floating', label: 'Floating' },
            { value: 'corner', label: 'Corner button' },
          ]}
          value={railShape}
          onValueChange={(value) => setRailShape(value as RailShape)}
        />
      )}
      {rail && railShape !== 'corner' && (
        <Select
          label="Page names"
          help={
            tv
              ? "Whether the rail names each page only while you're in it, or all the time."
              : 'Whether the rail names each page under its icon.'
          }
          options={
            tv
              ? [
                  { value: 'auto', label: "While you're in it" },
                  { value: 'always', label: 'Always' },
                ]
              : [
                  { value: 'auto', label: 'Shown' },
                  { value: 'never', label: 'Hidden' },
                ]
          }
          value={railNames}
          onValueChange={(value) => setRailNames(value as RailNames)}
        />
      )}
      {tv && tvNavigation === 'top' && (
        <Select
          label="Top bar"
          help="How the tabs sit over the page: as floating pills, on a bar across the top, or on nothing but a fade down from the top edge."
          options={[
            { value: 'pill', label: 'Floating pills' },
            { value: 'bar', label: 'Bar' },
            { value: 'fade', label: 'Fade' },
          ]}
          value={tvTopBar}
          onValueChange={(value) => setTvTopBar(value as TvTopBar)}
        />
      )}
      {onBar && (
        <Select
          label="Background"
          help="What the navigation sits on over the page: the app's own colour, or glass that shows the page through it. Liquid glass also bends what's behind its edges, which costs more on a slow device."
          options={[
            { value: 'solid', label: 'Solid' },
            { value: 'frosted', label: 'Frosted glass' },
            ...(canRefract ? [{ value: 'liquid', label: 'Liquid glass' }] : []),
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

  const featuredOptions = [
    {
      value: 'resume',
      label: 'Continue watching',
      textValue: 'Continue watching',
    },
    { value: 'next-up', label: 'Next up', textValue: 'Next up' },
    ...(views.data?.Items ?? []).map((v) => {
      const label = [v.Name, libraryLabel(v)].filter(Boolean).join(' · ');
      return { value: `view:${v.Id}`, label, textValue: label };
    }),
    { value: NOTHING, label: 'Nothing', textValue: 'Nothing' },
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
      <SettingsCard title="Home and grids" description={FOLLOWS_YOU}>
        <Combobox
          multiple
          label="Featured on home"
          help={`Up to ${MAX_FEATURED}, mixed together. Left empty, your first movie and series catalogs are featured.`}
          placeholder="Automatic"
          emptyMessage="Nothing matches."
          options={featuredOptions}
          maxItems={MAX_FEATURED}
          value={featuredValue}
          onValueChange={changeFeatured}
        />
        <Select
          label="Hero"
          help="Following pins it above the rows and shows the card the pointer, keyboard or remote is on, starting with a featured title, behind the whole page or in its top corner. Touch screens and narrow windows keep it rotating."
          options={[
            { value: 'rotate', label: 'Rotates through featured titles' },
            { value: 'follow', label: 'Follows the selected card' },
            {
              value: 'corner',
              label: 'Follows the selected card, in the corner',
            },
          ]}
          value={heroMode}
          onValueChange={(value) => setHeroMode(value as HeroMode)}
        />
        <Switch
          side="right"
          label="Merge continue watching and next up"
          help="Shows next episodes in the continue watching row, after what you are partway through."
          value={mergeNextUp}
          onValueChange={setMergeNextUp}
        />
        <Switch
          side="right"
          label="Combine movie and show results"
          help="Shows search results in one grid instead of a row each for movies and shows."
          value={combineSearch}
          onValueChange={setCombineSearch}
        />
        <Select
          label="Poster size"
          help="How large cards are in a grid."
          options={[
            { value: 'small', label: 'Small' },
            { value: 'medium', label: 'Medium' },
            { value: 'large', label: 'Large' },
          ]}
          value={posterSize}
          onValueChange={(value) => setPosterSize(value as PosterSize)}
        />
        <Combobox
          multiple
          label="Under posters"
          help="Left empty, posters stand alone. A poster without artwork still shows its title."
          placeholder="Nothing"
          emptyMessage="Nothing matches."
          options={[
            { value: 'title', label: 'Title', textValue: 'Title' },
            { value: 'year', label: 'Year', textValue: 'Year' },
          ]}
          value={posterLines}
          onValueChange={(value) => setPosterLines(value as PosterLine[])}
        />
      </SettingsCard>
      <SettingsCard title="Episodes" description={ON_DEVICE}>
        <Select
          label="Episode layout"
          help="Automatic lists episodes on narrow screens and puts them in a row on wide ones."
          options={[
            { value: 'auto', label: 'Automatic' },
            { value: 'row', label: 'Row' },
            { value: 'list', label: 'List' },
          ]}
          value={episodeLayout}
          onValueChange={(value) => setEpisodeLayout(value as EpisodeLayout)}
        />
      </SettingsCard>
      <NavigationCard />
    </>
  );
}
