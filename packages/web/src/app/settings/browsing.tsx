import { t } from '@lingui/core/macro';
import { Select } from '@aiostreams/ui/select';
import { Combobox } from '@aiostreams/ui/combobox';
import { Switch } from '@aiostreams/ui/switch';
import { useLiveTvView, useViews } from '@/lib/jellyfin/queries';
import { libraryLabel } from '@/lib/format';
import { currentHost } from '@/lib/hosts';
import {
  settings,
  useSetting,
  MAX_FEATURED,
  HERO_SECONDS,
  TRAILER_SPOTS,
  type EpisodeLayout,
  type HeroMode,
  type LiveTvPlace,
  type PosterLine,
  type PosterSize,
} from '@/lib/settings';
import { SettingsCard } from './_components/settings-card';
import {
  onDevice,
  followsYou,
  seconds,
  deviceOnly,
} from './_components/common';

const NOTHING = 'none';

const option = (value: string, label: string) => ({
  value,
  label,
  textValue: label,
});

function HomeCard() {
  const views = useViews();
  const [featured, setFeatured] = useSetting(settings.interface.featured);
  const [heroMode, setHeroMode] = useSetting(settings.interface.heroMode);
  const [heroSeconds, setHeroSeconds] = useSetting(
    settings.interface.heroSeconds
  );
  const [mergeNextUp, setMergeNextUp] = useSetting(
    settings.interface.mergeNextUp
  );
  const [liveTv, setLiveTv] = useSetting(settings.interface.liveTv);
  const hasLiveTv = !!useLiveTvView().data;

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
    <SettingsCard name="home" title={t`Home`} description={followsYou()}>
      <Combobox
        multiple
        label={t`Featured on home`}
        help={t`Up to ${MAX_FEATURED}, mixed together. Left empty, your first movie and show libraries are featured.`}
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
        ]}
        value={heroMode}
        onValueChange={(value) => setHeroMode(value as HeroMode)}
      />
      <Select
        label={t`Time on each title`}
        help={t`How long the hero stays on a featured title while it rotates.`}
        options={HERO_SECONDS.map((s) => ({
          value: String(s),
          label: seconds(s),
        }))}
        value={String(heroSeconds)}
        onValueChange={(v) => setHeroSeconds(Number(v))}
      />
      <Switch
        side="right"
        label={t`Merge continue watching and next up`}
        help={t`Shows next episodes in the continue watching row, after what you are partway through.`}
        value={mergeNextUp}
        onValueChange={setMergeNextUp}
      />
      {hasLiveTv && (
        <Select
          label={t`Live TV`}
          help={t`Hidden, channels also leave search and favourites.`}
          options={[
            { value: 'home', label: t`On home and in the navigation` },
            { value: 'nav', label: t`In the navigation only` },
            { value: 'off', label: t`Hidden` },
          ]}
          value={liveTv}
          onValueChange={(value) => setLiveTv(value as LiveTvPlace)}
        />
      )}
    </SettingsCard>
  );
}

export function BrowsingSection() {
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
  const [cardPreview, setCardPreview] = useSetting(
    settings.interface.cardPreview
  );
  const [trailers, setTrailers] = useSetting(settings.interface.trailers);
  const [trailerSound, setTrailerSound] = useSetting(
    settings.interface.trailerSound
  );
  const [blurSpoilers, setBlurSpoilers] = useSetting(
    settings.interface.blurSpoilers
  );
  const [markUnaired, setMarkUnaired] = useSetting(settings.next.markUnaired);
  const touch = !currentHost().tv && matchMedia('(pointer: coarse)').matches;

  return (
    <>
      <HomeCard />
      <SettingsCard
        name="posters-and-grids"
        title={t`Posters and grids`}
        description={followsYou()}
      >
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
        <Switch
          side="right"
          label={t`Combine movie and show results`}
          help={t`Shows search results in one grid instead of a row each for movies and shows.`}
          value={combineSearch}
          onValueChange={setCombineSearch}
        />
        {!touch && (
          <Switch
            side="right"
            label={t`Preview the card you rest on`}
            help={deviceOnly(
              t`On home while the hero rotates, in search and in grids. Under a mouse a card pops out; with a keyboard or remote it opens out to its details.`
            )}
            value={cardPreview}
            onValueChange={setCardPreview}
          />
        )}
      </SettingsCard>
      <SettingsCard
        name="trailers"
        title={t`Trailers`}
        description={onDevice()}
      >
        <Combobox
          multiple
          label={t`Play by themselves`}
          help={t`Once you rest on a title for a moment. In the hero, only one you went to.`}
          placeholder={t`Nowhere`}
          emptyMessage={t`Nothing matches.`}
          options={[
            ...(touch ? [] : [option('cards', t`Cards`)]),
            option('hero', t`Hero`),
            option('item', t`Title pages`),
          ]}
          value={TRAILER_SPOTS.filter((spot) => trailers[spot])}
          onValueChange={(value) =>
            setTrailers(
              Object.fromEntries(
                TRAILER_SPOTS.map((spot) => [spot, value.includes(spot)])
              ) as typeof trailers
            )
          }
        />
        <Switch
          side="right"
          label={t`Sound`}
          help={t`Off, a trailer still plays with sound once you open it whole.`}
          value={trailerSound}
          onValueChange={setTrailerSound}
        />
      </SettingsCard>
      <SettingsCard
        name="episodes"
        title={t`Episodes`}
        description={followsYou()}
      >
        <Select
          label={t`Episode layout`}
          help={deviceOnly(
            t`Automatic lists episodes on narrow screens and puts them in a row on wide ones.`
          )}
          options={[
            { value: 'auto', label: t`Automatic` },
            { value: 'row', label: t`Row` },
            { value: 'list', label: t`List` },
          ]}
          value={episodeLayout}
          onValueChange={(value) => setEpisodeLayout(value as EpisodeLayout)}
        />
        <Switch
          side="right"
          label={t`Blur episodes you haven't started`}
          help={t`Blurs their pictures, titles and descriptions until the pointer, keyboard or remote is on one.`}
          value={blurSpoilers}
          onValueChange={setBlurSpoilers}
        />
        <Switch
          side="right"
          label={t`Mark unaired episodes`}
          help={t`Episodes that haven't aired yet show as unaired, ask before playing, and are passed over when playing on or downloading a season. Turn off if their air dates are often wrong.`}
          value={markUnaired}
          onValueChange={setMarkUnaired}
        />
      </SettingsCard>
    </>
  );
}
