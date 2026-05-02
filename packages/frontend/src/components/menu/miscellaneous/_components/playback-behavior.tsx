'use client';
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
    </>
  );
}
