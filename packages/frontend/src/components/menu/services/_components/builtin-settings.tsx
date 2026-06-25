import { useStatus } from '@/context/status';
import { useUserData } from '@/context/userData';
import { SettingsCard } from '../../../shared/settings-card';
import { Switch } from '../../../ui/switch';
import { Select } from '../../../ui/select';
import { Combobox } from '../../../ui/combobox';
import { NumberInput } from '../../../ui/number-input/number-input';
import { DurationInput } from '../../../ui/duration-input';
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
        title="Failover"
        id="failover"
        description="When a stream fails to play, AIOStreams automatically tries the next best result from your sorted list. Works with built-in Usenet and debrid results (those AIOStreams resolves itself)."
      >
        <Switch
          label="Enable"
          side="right"
          value={userData.failover?.enabled ?? false}
          onValueChange={(value) => {
            setUserData((prev) => ({
              ...prev,
              failover: { ...prev.failover, enabled: value },
            }));
          }}
        />
        <Combobox
          label="Failover Content Types"
          help="Which kinds of result may be used as failover targets."
          disabled={!userData.failover?.enabled}
          options={[
            { label: 'Usenet', value: 'usenet', textValue: 'Usenet' },
            { label: 'Debrid', value: 'debrid', textValue: 'Debrid' },
          ]}
          multiple
          emptyMessage="Select at least one content type"
          value={userData.failover?.contentTypes ?? ['usenet']}
          onValueChange={(value) => {
            setUserData((prev) => ({
              ...prev,
              failover: {
                ...prev.failover,
                contentTypes: value as ('usenet' | 'debrid')[],
              },
            }));
          }}
        />
        <Switch
          label="Allow Cross-Type Failover"
          side="right"
          disabled={!userData.failover?.enabled}
          help="Allow a click on one kind (e.g. Usenet) to fall through into a different kind (e.g. debrid) that is next in the ranked list. When off, failover stays within the clicked item's own kind."
          value={userData.failover?.allowCrossType ?? false}
          onValueChange={(value) => {
            setUserData((prev) => ({
              ...prev,
              failover: { ...prev.failover, allowCrossType: value },
            }));
          }}
        />
        <Switch
          label="During Pre-cache"
          side="right"
          disabled={!userData.failover?.enabled}
          help="Also apply failover when pre-caching the next episode's streams in the background. When off, pre-cache requests skip failover entirely."
          value={userData.failover?.precacheFailover ?? false}
          onValueChange={(value) => {
            setUserData((prev) => ({
              ...prev,
              failover: { ...prev.failover, precacheFailover: value },
            }));
          }}
        />
        <NumberInput
          label="Fallback Count"
          help={
            <>
              How many fallback results to try before giving up. Maximum is set
              by <code>MAX_NZB_FAILOVER_COUNT</code> (currently{' '}
              {status?.settings?.limits?.maxNzbFailoverCount ?? 5}).
            </>
          }
          min={1}
          max={status?.settings?.limits?.maxNzbFailoverCount ?? 5}
          defaultValue={3}
          disabled={!userData.failover?.enabled}
          value={userData.failover?.count ?? 3}
          onValueChange={(value) => {
            const maxCount = status?.settings?.limits?.maxNzbFailoverCount ?? 5;
            setUserData((prev) => ({
              ...prev,
              failover: {
                ...prev.failover,
                count: Math.min(maxCount, Math.max(1, Number(value || 3))),
              },
            }));
          }}
        />
        <NumberInput
          label="Parallel Attempts"
          help="How many attempts to run at once. 1 keeps the classic sequential behaviour (try one, then the next). Higher values race several attempts and take the first that proves healthy; the losing attempts are cancelled and cleaned up (usenet probes are aborted; debrid downloads added by a loser are removed, except private torrents)."
          min={1}
          max={Math.max(1, userData.failover?.count ?? 3)}
          defaultValue={1}
          disabled={!userData.failover?.enabled}
          value={userData.failover?.parallel ?? 1}
          onValueChange={(value) => {
            const maxParallel = Math.max(1, userData.failover?.count ?? 3);
            setUserData((prev) => ({
              ...prev,
              failover: {
                ...prev.failover,
                parallel: Math.min(
                  maxParallel,
                  Math.max(1, Number(value || 1))
                ),
              },
            }));
          }}
        />
        {(userData.failover?.parallel ?? 1) > 1 && (
          <>
            <DurationInput
              label="Backup delay"
              help="How long the clicked item runs alone before backups start in parallel. A head start that keeps provider load down. Accepts values like 1.5s or 500ms."
              disabled={!userData.failover?.enabled}
              value={userData.failover?.staggerMs ?? 1000}
              onValueChange={(ms) => {
                setUserData((prev) => ({
                  ...prev,
                  failover: { ...prev.failover, staggerMs: ms },
                }));
              }}
            />
            <DurationInput
              label="Preferred-item grace"
              help="Once a backup is healthy, how long to wait for the item you actually clicked (or a higher-ranked one still in flight) to catch up before settling for the backup. 0 = take the first healthy result."
              disabled={!userData.failover?.enabled}
              value={userData.failover?.preferredGraceMs ?? 2000}
              onValueChange={(ms) => {
                setUserData((prev) => ({
                  ...prev,
                  failover: { ...prev.failover, preferredGraceMs: ms },
                }));
              }}
            />
            <DurationInput
              label="Max wait"
              help="Overall deadline for the parallel chain before giving up and serving an error."
              min={1000}
              disabled={!userData.failover?.enabled}
              value={userData.failover?.maxWaitMs ?? 30000}
              onValueChange={(ms) => {
                setUserData((prev) => ({
                  ...prev,
                  failover: { ...prev.failover, maxWaitMs: ms },
                }));
              }}
            />
          </>
        )}
        <Select
          label="Failover Position"
          disabled={!userData.failover?.enabled}
          help="Where in the processing pipeline the fallback chain is built. All positions are after sorting. Earlier positions draw from a larger pool of streams but may include streams that would later be removed by SEL filters or limits."
          options={[
            { label: 'Before SEL', value: 'beforeSEL' },
            { label: 'Before Limiting', value: 'beforeLimiting' },
            { label: 'Last (default)', value: 'last' },
          ]}
          value={userData.failover?.position ?? 'last'}
          onValueChange={(value) => {
            setUserData((prev) => ({
              ...prev,
              failover: {
                ...prev.failover,
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
