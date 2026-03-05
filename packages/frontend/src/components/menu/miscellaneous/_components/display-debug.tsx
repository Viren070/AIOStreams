'use client';
import { useUserData } from '@/context/userData';
import { SettingsCard } from '../../../shared/settings-card';
import { Switch } from '../../../ui/switch';
import { Select } from '../../../ui/select';
import { Combobox } from '../../../ui/combobox';
import { RESOURCES } from '../../../../../../core/src/utils/constants';

export function DisplayDebug() {
  const { userData, setUserData } = useUserData();

  return (
    <>
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
          defaultValue={['addon', 'filter']}
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
    </>
  );
}
