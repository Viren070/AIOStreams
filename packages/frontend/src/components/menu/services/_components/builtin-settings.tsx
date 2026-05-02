'use client';
import { useStatus } from '@/context/status';
import { useUserData } from '@/context/userData';
import { SettingsCard } from '../../../shared/settings-card';
import { Switch } from '../../../ui/switch';
import { Select } from '../../../ui/select';
import { Combobox } from '../../../ui/combobox';
import { NumberInput } from '../../../ui/number-input/number-input';
import {
  ServiceId,
  BUILTIN_SUPPORTED_SERVICES,
  NZBDAV_SERVICE,
  ALTMOUNT_SERVICE,
  STREMIO_NNTP_SERVICE,
  EASYNEWS_SERVICE,
} from '../../../../../../core/src/utils/constants';

export function BuiltinSettings() {
  const { status } = useStatus();
  const { userData, setUserData } = useUserData();

  return (
    <>
      <SettingsCard
        title="Service Wrap"
        id="serviceWrap"
        description="Wrap P2P results from external addons through your own debrid services, without sharing your credentials with those addons. Works with P2P-capable marketplace addons and custom addons added via a custom manifest URL."
      >
        <Switch
          label="Enable Service Wrap"
          side="right"
          value={userData.serviceWrap?.enabled ?? false}
          onValueChange={(v) => {
            setUserData((prev) => ({
              ...prev,
              serviceWrap: { ...prev.serviceWrap, enabled: v },
            }));
          }}
          help="When enabled, AIOStreams configures supported addons to return raw torrents, then resolves them through your debrid services."
        />

        {userData.serviceWrap?.enabled && (
          <>
            <Switch
              label="Reconfigure Service"
              side="right"
              value={userData.serviceWrap?.reconfigureService ?? false}
              onValueChange={(v) => {
                setUserData((prev) => ({
                  ...prev,
                  serviceWrap: { ...prev.serviceWrap, reconfigureService: v },
                }));
              }}
              help="Re-processes debrid results from selected addons through your configured services. Useful if the addon doesn't support returning P2P results."
              moreHelp="Only works when the torrent hash can be extracted from the stream - not all debrid results will be eligible."
            />
            <Combobox
              label="Wrap Addons"
              help="Select which addons to wrap. Leave empty to wrap all applicable addons."
              options={(userData.presets ?? [])
                .filter((p) => {
                  const presetMeta = status?.settings.presets.find(
                    (meta) => meta.ID === p.type
                  );
                  if (presetMeta?.BUILTIN) return false;
                  if (presetMeta?.ID === 'custom') return true;
                  if (presetMeta?.SUPPORTED_STREAM_TYPES.includes('p2p'))
                    return true;
                  if (
                    userData.serviceWrap?.reconfigureService &&
                    presetMeta?.SUPPORTED_STREAM_TYPES.includes('debrid')
                  )
                    return true;
                  return false;
                })
                .map((preset) => ({
                  label: preset.options.name || preset.type,
                  value: preset.instanceId,
                  textValue: preset.options.name,
                }))}
              multiple
              emptyMessage="No supported addons found"
              value={userData.serviceWrap?.presets ?? []}
              onValueChange={(value) => {
                setUserData((prev) => ({
                  ...prev,
                  serviceWrap: {
                    ...prev.serviceWrap,
                    presets: value.length > 0 ? value : undefined,
                  },
                }));
              }}
            />
            <Combobox
              label="Processing Services"
              help="Select which debrid services to use for processing wrapped torrents. Leave empty to use all enabled services."
              options={(userData.services ?? [])
                .filter(
                  (s) =>
                    s.enabled &&
                    (BUILTIN_SUPPORTED_SERVICES as readonly string[]).includes(
                      s.id
                    ) &&
                    ![
                      NZBDAV_SERVICE,
                      ALTMOUNT_SERVICE,
                      STREMIO_NNTP_SERVICE,
                      EASYNEWS_SERVICE,
                    ].includes(s.id)
                )
                .map((service) => ({
                  label:
                    status?.settings.services[service.id]?.name ?? service.id,
                  value: service.id,
                  textValue:
                    status?.settings.services[service.id]?.name ?? service.id,
                }))}
              multiple
              emptyMessage="No supported services found"
              value={userData.serviceWrap?.services ?? []}
              onValueChange={(value) => {
                setUserData((prev) => ({
                  ...prev,
                  serviceWrap: {
                    ...prev.serviceWrap,
                    services:
                      value.length > 0 ? (value as ServiceId[]) : undefined,
                  },
                }));
              }}
            />
          </>
        )}
      </SettingsCard>

      <SettingsCard
        title="NZB Failover"
        id="nzbFailover"
        description="When a Usenet stream fails to play, AIOStreams will automatically try the next best NZB URLs from your sorted results. Only applies to built-in Usenet addons."
      >
        <Switch
          label="Enable"
          side="right"
          value={userData.nzbFailover?.enabled ?? false}
          onValueChange={(value) => {
            setUserData((prev) => ({
              ...prev,
              nzbFailover: { ...prev.nzbFailover, enabled: value },
            }));
          }}
        />
        <NumberInput
          label="Fallback Count"
          help={
            <>
              How many fallback NZB URLs to try before giving up. Maximum is set
              by <code>MAX_NZB_FAILOVER_COUNT</code> (currently{' '}
              {status?.settings?.limits?.maxNzbFailoverCount ?? 5}).
            </>
          }
          min={1}
          max={status?.settings?.limits?.maxNzbFailoverCount ?? 5}
          defaultValue={3}
          disabled={!userData.nzbFailover?.enabled}
          value={userData.nzbFailover?.count ?? 3}
          onValueChange={(value) => {
            const maxCount = status?.settings?.limits?.maxNzbFailoverCount ?? 5;
            setUserData((prev) => ({
              ...prev,
              nzbFailover: {
                ...prev.nzbFailover,
                count: Math.min(maxCount, Math.max(1, Number(value || 3))),
              },
            }));
          }}
        />
        <Select
          label="Failover Position"
          disabled={!userData.nzbFailover?.enabled}
          help="Where in the processing pipeline the fallback list is built. All positions are after sorting. Earlier positions draw from a larger pool of streams but may include streams that would later be removed by limits or SEL filters."
          options={[
            { label: 'Before Limiting', value: 'beforeLimiting' },
            { label: 'Before SEL', value: 'beforeSEL' },
            { label: 'Last (default)', value: 'last' },
          ]}
          value={userData.nzbFailover?.position ?? 'last'}
          onValueChange={(value) => {
            setUserData((prev) => ({
              ...prev,
              nzbFailover: {
                ...prev.nzbFailover,
                position: value as 'beforeLimiting' | 'beforeSEL' | 'last',
              },
            }));
          }}
        />
      </SettingsCard>

      <SettingsCard
        title="Auto Remove Downloads"
        id="autoRemoveDownloads"
        description="Automatically removes the torrent/NZB from your debrid dashboard after generating a playback link. Only works for built-in addons and supported services — private torrents are not removed."
      >
        <Switch
          label="Enable"
          side="right"
          value={userData.autoRemoveDownloads ?? false}
          onValueChange={(value) => {
            setUserData((prev) => ({ ...prev, autoRemoveDownloads: value }));
          }}
        />
      </SettingsCard>

      <SettingsCard
        title="Check Library"
        id="checkOwned"
        description="When enabled, built-in addons and service wrapped addons will check if search results already exist in your debrid library and mark them accordingly. This applies to both torrent and usenet results."
      >
        <Switch
          label="Enable"
          side="right"
          value={userData.checkOwned ?? true}
          onValueChange={(value) => {
            setUserData((prev) => ({ ...prev, checkOwned: value }));
          }}
        />
      </SettingsCard>

      <SettingsCard
        title="Cache and Play"
        id="cacheAndPlay"
        description="Allows uncached streams to wait for the download to finish before playing, instead of showing a 'try again' message. Only works for built-in addons — recommended for Usenet since downloads typically finish quickly."
      >
        <Switch
          label="Enable"
          side="right"
          value={userData.cacheAndPlay?.enabled}
          onValueChange={(value) => {
            setUserData((prev) => ({
              ...prev,
              cacheAndPlay: { ...prev.cacheAndPlay, enabled: value },
            }));
          }}
        />
        <Combobox
          label="Stream Types"
          options={['usenet', 'torrent'].map((streamType) => ({
            label: streamType,
            value: streamType,
            textValue: streamType,
          }))}
          multiple
          emptyMessage="No stream types found"
          defaultValue={['usenet']}
          value={userData.cacheAndPlay?.streamTypes ?? ['usenet']}
          onValueChange={(value) => {
            setUserData((prev) => ({
              ...prev,
              cacheAndPlay: {
                ...prev.cacheAndPlay,
                streamTypes: value as ('usenet' | 'torrent')[],
              },
            }));
          }}
        />
      </SettingsCard>
    </>
  );
}
