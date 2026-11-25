import { plural, t } from '@lingui/core/macro';
import { Select } from '@aiostreams/ui/select';
import { Switch } from '@aiostreams/ui/switch';
import { shellHost } from '@/lib/hosts/shell';
import { usePlaybackPrefs } from '@/lib/jellyfin/user-config';
import {
  settings,
  useSetting,
  NEXT_COUNTDOWNS,
  NEXT_LEADS,
  STILL_WATCHING_AFTER,
  SEGMENT_ACTIONS,
  SEGMENT_TYPES,
  type NextPrompt,
  type SegmentAction,
  type SegmentType,
} from '@/lib/settings';
import { useFeature } from '@/lib/jellyfin/server-info';
import { SettingsCard } from './_components/settings-card';
import { BadgesRow, QuickFiltersRow } from './_components/version-settings';
import { seconds } from './_components/common';
import { ReactionSetting } from './_components/reaction-setting';

const nextPromptHelp = (prompt: NextPrompt) =>
  ({
    credits: t`When the credits start, if they run to the end; otherwise a set time before the end.`,
    end: t`A set time before the end.`,
    off: t`Episodes end without offering the next one.`,
  })[prompt];

const segmentLabel = (type: SegmentType) =>
  ({
    Intro: t`Intros`,
    Recap: t`Recaps`,
    Outro: t`Credits`,
    Preview: t({
      context: 'Episode segments showing the next episode',
      message: 'Previews',
    }),
    Commercial: t`Ads`,
  })[type];

const segmentActionLabel = (action: SegmentAction) =>
  ({
    ask: t`Show a skip button`,
    skip: t`Skip automatically`,
    none: t`Do nothing`,
  })[action];

const minutes = (count: number) =>
  plural(count, { one: '# minute', other: '# minutes' });

function SegmentActionSelect({ type }: { type: SegmentType }) {
  const [action, setAction] = useSetting(settings.playback.segment[type]);
  return (
    <Select
      label={segmentLabel(type)}
      help={
        type === 'Outro' && action === 'skip'
          ? t`Credits that end an episode are left to the next episode prompt when it shows.`
          : undefined
      }
      options={SEGMENT_ACTIONS.map((a) => ({
        value: a,
        label: segmentActionLabel(a),
      }))}
      value={action}
      onValueChange={(v) => setAction(v as SegmentAction)}
    />
  );
}

export function PlaybackSection() {
  const { prefs, update, locked } = usePlaybackPrefs();
  const [autoPlay, setAutoPlay] = useSetting(settings.playback.autoPlayFirst);
  const [preload, setPreload] = useSetting(settings.playback.preloadVersions);
  const [nextPrompt, setNextPrompt] = useSetting(settings.next.prompt);
  const [nextLead, setNextLead] = useSetting(settings.next.lead);
  const [nextCountdown, setNextCountdown] = useSetting(settings.next.countdown);
  const [nextFallbackFirst, setNextFallbackFirst] = useSetting(
    settings.next.fallbackFirst
  );
  const [stillWatching, setStillWatching] = useSetting(
    settings.next.stillWatching
  );
  const [skipFillers, setSkipFillers] = useSetting(settings.next.skipFillers);
  const [skipRecaps, setSkipRecaps] = useSetting(settings.next.skipRecaps);
  const marked = useFeature('fillers');
  const [partyMessages, setPartyMessages] = useSetting(settings.party.messages);
  const [partyReactions, setPartyReactions] = useSetting(
    settings.party.reactions
  );
  const [partySpeedSync, setPartySpeedSync] = useSetting(
    settings.party.speedSync
  );
  const autoplay = prefs.EnableNextEpisodeAutoPlay !== false;
  const [chapterSkips, setChapterSkips] = useSetting(
    settings.playback.chapterSkips
  );
  const bingeGroups = useFeature('versions');
  const shell = !!shellHost();

  return (
    <>
      <SettingsCard name="versions" title={t`Versions`} holds="profile">
        <Switch
          side="right"
          label={t`Auto-play the first version`}
          help={
            autoPlay
              ? t`Play starts the first version, and resuming goes back to the version you were watching. Hold Play to choose instead.`
              : t`Play lists the versions to choose from, but resuming goes back to the version you were watching. Hold Play to do the other: start the first version, or list them when resuming.`
          }
          value={autoPlay}
          onValueChange={setAutoPlay}
        />
        <Switch
          side="right"
          label={t`Find versions when a title opens`}
          help={t`Looks for versions as soon as a title's page opens, so Play and the version list don't wait. Each title you open is looked up, even if you don't play it.`}
          value={preload}
          onValueChange={setPreload}
        />
        <QuickFiltersRow />
        <BadgesRow />
      </SettingsCard>
      <SettingsCard name="next-episode" title={t`Next episode`} holds="profile">
        <Switch
          side="right"
          label={t`Play it automatically`}
          help={
            bingeGroups
              ? t`Counts down, then plays the next episode in the same kind of version. Off, the prompt waits for you.`
              : t`Counts down, then plays the next episode. Off, the prompt waits for you.`
          }
          value={autoplay}
          disabled={locked}
          onValueChange={(v) => update({ EnableNextEpisodeAutoPlay: v })}
        />
        {autoplay && (
          <Select
            label={t`Ask if you are still watching`}
            help={t`Pauses and asks before the next episode once this many have played in a row without a key, click or button press.`}
            options={STILL_WATCHING_AFTER.map((n) => ({
              value: String(n),
              label: n
                ? plural(n, {
                    one: 'After # episode',
                    other: 'After # episodes',
                  })
                : t`Never`,
            }))}
            value={String(stillWatching)}
            onValueChange={(v) => setStillWatching(Number(v))}
          />
        )}
        <Switch
          side="right"
          label={
            bingeGroups
              ? t`Play the first version when none matches`
              : t`Play the first version`
          }
          help={
            bingeGroups
              ? t`Otherwise the next episode's version list opens when none is like the one you watched.`
              : t`Otherwise the next episode's version list opens when it has more than one.`
          }
          value={nextFallbackFirst}
          onValueChange={setNextFallbackFirst}
        />
        <Select
          label={t`Show the prompt`}
          help={nextPromptHelp(nextPrompt)}
          options={[
            { value: 'credits', label: t`When the credits start` },
            { value: 'end', label: t`Before the end` },
            { value: 'off', label: t`Never` },
          ]}
          value={nextPrompt}
          onValueChange={(v) => setNextPrompt(v as NextPrompt)}
        />
        {nextPrompt !== 'off' && (
          <Select
            label={t`Before the end`}
            help={
              nextPrompt === 'credits'
                ? t`Used when an episode has no credits marked.`
                : undefined
            }
            options={NEXT_LEADS.map((s) => ({
              value: String(s),
              label: s < 60 ? seconds(s) : minutes(s / 60),
            }))}
            value={String(nextLead)}
            onValueChange={(v) => setNextLead(Number(v))}
          />
        )}
        {nextPrompt !== 'off' && (
          <Select
            label={t`Countdown`}
            options={NEXT_COUNTDOWNS.map((s) => ({
              value: String(s),
              label: seconds(s),
            }))}
            value={String(nextCountdown)}
            onValueChange={(v) => setNextCountdown(Number(v))}
          />
        )}
        {marked && (
          <Switch
            side="right"
            label={t`Skip filler episodes`}
            help={t`Playing on and the next and previous buttons pass over episodes marked as filler. You can still play one yourself.`}
            value={skipFillers}
            onValueChange={setSkipFillers}
          />
        )}
        {marked && (
          <Switch
            side="right"
            label={t`Skip recap episodes`}
            help={t`The same for episodes marked as a recap.`}
            value={skipRecaps}
            onValueChange={setSkipRecaps}
          />
        )}
      </SettingsCard>
      <SettingsCard name="skipping" title={t`Skipping`} holds="profile">
        {SEGMENT_TYPES.map((type) => (
          <SegmentActionSelect key={type} type={type} />
        ))}
        {shell && (
          <Switch
            side="right"
            label={t`Skip by the file's chapters`}
            help={t`Where a file names its intro, credits, recap or preview chapters, skipping uses them instead of the server's times, since they fit that exact file. The rest still come from the server.`}
            value={chapterSkips}
            onValueChange={setChapterSkips}
          />
        )}
      </SettingsCard>
      <SettingsCard
        name="watch-parties"
        title={t`Watch parties`}
        holds="profile"
      >
        <Switch
          side="right"
          label={t`Show messages over the video`}
          help={t`What the people you watch with say shows for a few seconds. It always stays in the party's chat.`}
          value={partyMessages}
          onValueChange={setPartyMessages}
        />
        <Switch
          side="right"
          label={t`Show reactions over the video`}
          value={partyReactions}
          onValueChange={setPartyReactions}
        />
        <ReactionSetting />
        <Switch
          side="right"
          label={t`Keep in step by changing speed`}
          help={t`Plays a little faster or slower to catch up with the party. Off, the video jumps instead.`}
          value={partySpeedSync}
          onValueChange={setPartySpeedSync}
        />
      </SettingsCard>
    </>
  );
}
