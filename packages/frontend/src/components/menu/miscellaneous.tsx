'use client';
import { PageWrapper } from '../shared/page-wrapper';
import { PageControls } from '../shared/page-controls';
import { Switch } from '../ui/switch';
import { useUserData } from '@/context/userData';
import { SettingsCard } from '../shared/settings-card';
import { Combobox } from '../ui/combobox';
import {
  RESOURCES,
  AUTO_PLAY_ATTRIBUTES,
  DEFAULT_AUTO_PLAY_ATTRIBUTES,
  AutoPlayMethod,
  AUTO_PLAY_METHODS,
  AUTO_PLAY_METHOD_DETAILS,
} from '../../../../core/src/utils/constants';
import { Select } from '../ui/select';
import { Alert } from '../ui/alert';
import { useMode } from '@/context/mode';

export function MiscellaneousMenu() {
  return (
    <>
      <PageWrapper className="space-y-4 p-4 sm:p-8">
        <Content />
      </PageWrapper>
    </>
  );
}

function Content() {
  const { userData, setUserData } = useUserData();
  const { mode } = useMode();
  return (
    <>
      <div className="flex items-center w-full">
        <div>
          <h2>Miscellaneous</h2>
          <p className="text-[--muted]">
            Additional settings and configurations.
          </p>
        </div>
        <div className="hidden lg:block lg:ml-auto">
          <PageControls />
        </div>
      </div>
      <div className="space-y-4">
        <SettingsCard
          title="Pre-cache Next Episode"
          description="When requesting streams for series, AIOStreams will automatically request the next episode and if all streams are uncached, it will ping the URL of the first uncached stream according to your sort settings."
        >
          <Switch
            label="Enable"
            side="right"
            value={userData.precacheNextEpisode}
            onValueChange={(value) => {
              setUserData((prev) => ({
                ...prev,
                precacheNextEpisode: value,
              }));
            }}
          />
          <Switch
            label="Always Pre-cache"
            help="If enabled, AIOStreams will always attempt to precache the next episode of a series, even if there is already a cached stream available."
            side="right"
            disabled={!userData.precacheNextEpisode}
            value={userData.alwaysPrecache}
            onValueChange={(value) => {
              setUserData((prev) => ({
                ...prev,
                alwaysPrecache: value,
              }));
            }}
          />
        </SettingsCard>
        {mode === 'pro' && (
          <SettingsCard
            title="Auto Play"
            description={
              <div className="space-y-2">
                <p>
                  Configure how AIOStreams suggests the next stream for
                  Stremio's auto-play feature.
                </p>
                <Alert intent="info-basic">
                  <p className="text-sm">
                    AIOStreams does not (and cannot) directly control auto-play.
                    It uses the{' '}
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
                    work, you must have auto-play enabled in your Stremio
                    settings.
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
            {(userData.autoPlay?.method ?? 'matchingFile') ===
              'matchingFile' && (
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
                defaultValue={
                  DEFAULT_AUTO_PLAY_ATTRIBUTES as unknown as string[]
                }
                onValueChange={(value) => {
                  setUserData((prev) => ({
                    ...prev,
                    autoPlay: {
                      ...prev.autoPlay,
                      attributes:
                        value as (typeof AUTO_PLAY_ATTRIBUTES)[number][],
                    },
                  }));
                }}
              />
            )}
          </SettingsCard>
        )}
        {mode === 'pro' && (
          <SettingsCard
            title="External Downloads"
            description="Adds a stream that automatically opens the stream in your browser below every stream for easier downloading"
          >
            <Switch
              label="Enable"
              side="right"
              value={userData.externalDownloads}
              onValueChange={(value) => {
                setUserData((prev) => ({
                  ...prev,
                  externalDownloads: value,
                }));
              }}
            />
          </SettingsCard>
        )}
        {mode === 'pro' && (
          <SettingsCard
            title="Statistic Streams"
            description="AIOStreams will return the statistics of stream fetches and response times for each addon if enabled."
          >
            <Switch
              label="Enable"
              side="right"
              value={userData.statistics?.enabled}
              onValueChange={(value) => {
                setUserData((prev) => ({
                  ...prev,
                  statistics: {
                    ...prev.statistics,
                    enabled: value,
                  },
                }));
              }}
            />
            <Select
              label="Statistics Position"
              help="Whether to show the statistic streams at the top or bottom of the stream list."
              disabled={!userData.statistics?.enabled}
              options={[
                { label: 'Top', value: 'top' },
                { label: 'Bottom', value: 'bottom' },
              ]}
              value={userData.statistics?.position || 'bottom'}
              onValueChange={(value) => {
                setUserData((prev) => ({
                  ...prev,
                  statistics: {
                    ...prev.statistics,
                    position: value as 'top' | 'bottom',
                  },
                }));
              }}
            />
            <Combobox
              label="Statistics to Show"
              options={['addon', 'filter'].map((statistic) => ({
                label: statistic,
                value: statistic,
              }))}
              emptyMessage="No statistics to show"
              multiple
              value={userData.statistics?.statsToShow}
              onValueChange={(value) => {
                setUserData((prev) => ({
                  ...prev,
                  statistics: {
                    ...prev.statistics,
                    statsToShow: value as ('addon' | 'filter')[],
                  },
                }));
              }}
            />
          </SettingsCard>
        )}
        {mode === 'pro' && (
          <SettingsCard title="Hide Errors">
            <Switch
              label="Hide Errors"
              help="AIOStreams will attempt to return the errors in responses to streams, catalogs etc. Turning this on will hide the errors."
              side="right"
              value={userData.hideErrors}
              onValueChange={(value) => {
                setUserData((prev) => ({
                  ...prev,
                  hideErrors: value,
                }));
              }}
            />
            <Combobox
              disabled={userData.hideErrors}
              label="Hide Errors for specific resources"
              options={RESOURCES.map((resource) => ({
                label: resource,
                value: resource,
              }))}
              multiple
              help="This lets you hide errors for specific resources. For example, you may want to hide errors for the catalog resource, but not for the stream resource."
              emptyMessage="No resources found"
              value={userData.hideErrorsForResources}
              onValueChange={(value) => {
                setUserData((prev) => ({
                  ...prev,
                  hideErrorsForResources: value as (typeof RESOURCES)[number][],
                }));
              }}
            />
          </SettingsCard>
        )}
      </div>
    </>
  );
}
