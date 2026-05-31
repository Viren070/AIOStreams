import { useUserData } from '@/context/userData';
import { SettingsCard } from '../../../shared/settings-card';
import { Switch } from '../../../ui/switch';
import { Select } from '../../../ui/select';
import { Combobox } from '../../../ui/combobox';
import { NumberInput } from '../../../ui/number-input/number-input';
import { Alert } from '../../../ui/alert';
import {
  AUTO_PLAY_ATTRIBUTES,
  DEFAULT_AUTO_PLAY_ATTRIBUTES,
  AutoPlayMethod,
  AUTO_PLAY_METHODS,
  AUTO_PLAY_METHOD_DETAILS,
} from '../../../../../../core/src/utils/constants';

// Note: NZB Failover and Auto Remove Downloads have been moved to the Services menu (Built-in tab).

export function PlaybackBehavior() {
  const { userData, setUserData } = useUserData();

  return (
    <>
      <SettingsCard
        title="Auto Play"
        id="autoPlay"
        description={
          <div className="space-y-2">
            <p>
              Configure how AIOStreams suggests the next stream for Stremio's
              auto-play feature.
            </p>
            <Alert intent="info-basic">
              <p className="text-sm">
                AIOStreams does not (and cannot) directly control auto-play. It
                uses the{' '}
                <code>
                  <a
                    rel="noopener noreferrer"
                    href="https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/stream.md#additional-properties-to-provide-information--behaviour-flags"
                    target="_blank"
                    className="text-[--brand] hover:text-[--brand]/80 hover:underline"
                  >
                    bingeGroup
                  </a>
                </code>{' '}
                attribute to suggest the next stream to Stremio. For this to
                work, you must have auto-play enabled in your Stremio settings.
              </p>
            </Alert>
          </div>
        }
      >
        <Switch
          label="Enable"
          side="right"
          value={userData.autoPlay?.enabled ?? true}
          onValueChange={(value) => {
            setUserData((prev) => ({
              ...prev,
              autoPlay: {
                ...prev.autoPlay,
                enabled: value,
              },
            }));
          }}
        />
        <Select
          label="Auto Play Method"
          disabled={userData.autoPlay?.enabled === false}
          options={AUTO_PLAY_METHODS.map((method) => ({
            label: AUTO_PLAY_METHOD_DETAILS[method].name,
            value: method,
          }))}
          value={userData.autoPlay?.method || 'matchingFile'}
          onValueChange={(value) => {
            setUserData((prev) => ({
              ...prev,
              autoPlay: {
                ...prev.autoPlay,
                method: value as AutoPlayMethod,
              },
            }));
          }}
          help={
            AUTO_PLAY_METHOD_DETAILS[
              userData.autoPlay?.method || 'matchingFile'
            ].description
          }
        />
        {(userData.autoPlay?.method ?? 'matchingFile') === 'matchingFile' && (
          <Combobox
            label="Auto Play Attributes"
            help="The attributes that will be used to match the stream for auto-play. The first stream for the next episode that has the same set of attributes selected above will be auto-played. Less attributes means more likely to auto-play but less accurate in terms of playing a similar type of stream."
            options={AUTO_PLAY_ATTRIBUTES.map((attribute) => ({
              label: attribute,
              value: attribute,
            }))}
            multiple
            disabled={userData.autoPlay?.enabled === false}
            emptyMessage="No attributes found"
            value={userData.autoPlay?.attributes}
            defaultValue={DEFAULT_AUTO_PLAY_ATTRIBUTES as unknown as string[]}
            onValueChange={(value) => {
              setUserData((prev) => ({
                ...prev,
                autoPlay: {
                  ...prev.autoPlay,
                  attributes: value as (typeof AUTO_PLAY_ATTRIBUTES)[number][],
                },
              }));
            }}
          />
        )}
      </SettingsCard>

      <SettingsCard
        title="Are you still there?"
        id="areYouStillThere"
        description="Stop autoplay after a number of consecutive episodes so the player returns to stream selection."
      >
        <Switch
          label="Enable"
          side="right"
          value={userData.areYouStillThere?.enabled}
          onValueChange={(value) => {
            setUserData((prev) => ({
              ...prev,
              areYouStillThere: {
                ...prev.areYouStillThere,
                enabled: value,
              },
            }));
          }}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <NumberInput
            label="Episodes before check"
            min={1}
            defaultValue={3}
            disabled={!userData.areYouStillThere?.enabled}
            value={userData.areYouStillThere?.episodesBeforeCheck ?? 3}
            onValueChange={(value) => {
              setUserData((prev) => ({
                ...prev,
                areYouStillThere: {
                  ...prev.areYouStillThere,
                  episodesBeforeCheck: Math.max(1, Number(value || 3)),
                },
              }));
            }}
          />
          <NumberInput
            label="Cooldown (minutes)"
            min={1}
            defaultValue={60}
            disabled={!userData.areYouStillThere?.enabled}
            value={userData.areYouStillThere?.cooldownMinutes ?? 60}
            onValueChange={(value) => {
              setUserData((prev) => ({
                ...prev,
                areYouStillThere: {
                  ...prev.areYouStillThere,
                  cooldownMinutes: Math.max(1, Number(value || 60)),
                },
              }));
            }}
          />
        </div>
      </SettingsCard>

      <SettingsCard
        title="Infuse (External Player)"
        id="infuse"
        description={
          <div className="space-y-2">
            <p>
              Rewrites playable streams into <code>infuse://</code> launch links
              with a subtitle baked in, so playback opens in Infuse with subs
              already loaded (Infuse never requests subtitles itself).
            </p>
            <Alert intent="info-basic">
              <p className="text-sm">
                <strong>Subtitle language</strong> comes from{' '}
                <strong>Filters › Subtitles › Preferred Subtitles</strong>{' '}
                (defaults to English if none set). If you list several, they are
                tried in priority order. The highest-priority language that has
                an available subtitle is used. Infuse plays{' '}
                <strong>one subtitle per video</strong>, so additional languages
                act as fallbacks, not separate selectable tracks.{' '}
                <strong>Provider priority</strong> follows your subtitle addon
                order (put your preferred provider first).
              </p>
            </Alert>
            <Alert intent="warning-basic">
              <p className="text-sm">
                <strong>Stremio app only.</strong> Other Apple TV clients (Fusion,
                Omni, …) build the Infuse launch themselves and ignore the baked
                subtitle, so it won&apos;t work there.
              </p>
            </Alert>
          </div>
        }
      >
        <Switch
          label="Enable"
          side="right"
          value={userData.infuse?.enabled ?? false}
          onValueChange={(value) => {
            setUserData((prev) => ({
              ...prev,
              infuse: {
                ...prev.infuse,
                enabled: value,
              },
            }));
          }}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <NumberInput
            label="Filename-matched streams (top N)"
            help="The top N streams get a filename-matched (in-sync) subtitle lookup. The rest reuse a faster id-based lookup. Set 0 to use id-based only."
            min={0}
            max={50}
            defaultValue={5}
            disabled={!userData.infuse?.enabled}
            value={userData.infuse?.topN ?? 5}
            onValueChange={(value) => {
              setUserData((prev) => ({
                ...prev,
                infuse: {
                  ...prev.infuse,
                  topN: Math.min(50, Math.max(0, Number(value ?? 5))),
                },
              }));
            }}
          />
          <NumberInput
            label="Subtitle candidates"
            help="How many subtitles to bake in per stream. The first that loads is used; the rest are silent fallbacks if it's dead."
            min={1}
            max={5}
            defaultValue={3}
            disabled={!userData.infuse?.enabled}
            value={userData.infuse?.candidates ?? 3}
            onValueChange={(value) => {
              setUserData((prev) => ({
                ...prev,
                infuse: {
                  ...prev.infuse,
                  candidates: Math.min(5, Math.max(1, Number(value ?? 3))),
                },
              }));
            }}
          />
        </div>
      </SettingsCard>
    </>
  );
}
