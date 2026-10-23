import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Select } from '@aiostreams/ui/select';
import { Switch } from '@aiostreams/ui/switch';
import { Button } from '@aiostreams/ui/button';
import { currentHost } from '../../lib/hosts';
import {
  settings,
  useSetting,
  DOWNLOAD_SEARCHES,
  DOWNLOADS_AT_ONCE,
} from '../../lib/settings';
import { downloadsHost, useDownloadFolder } from '../../lib/downloads';
import { SettingsCard, SettingsRow } from '../../components/settings-card';
import { onDevice } from './common';

export function DownloadsSection() {
  const host = downloadsHost();
  const folder = useDownloadFolder() ?? '…';
  const [concurrent, setConcurrent] = useSetting(settings.downloads.concurrent);
  const [searches, setSearches] = useSetting(settings.downloads.searches);
  const [subtitles, setSubtitles] = useSetting(settings.downloads.subtitles);
  const [wifiOnly, setWifiOnly] = useSetting(settings.downloads.wifiOnly);
  const button = 'w-full rounded-full sm:w-auto';
  return (
    <SettingsCard description={onDevice()}>
      {host?.folder && (
        <SettingsRow
          label={t`Folder`}
          help={
            <span className="break-all">
              <Trans>
                {folder}. New downloads go here; ones already saved stay where
                they are.
              </Trans>
            </span>
          }
        >
          <div className="flex gap-2">
            {host.folder.open && (
              <Button
                intent="gray-outline"
                className={button}
                onClick={() => host.folder?.open?.()}
              >
                <Trans>Open</Trans>
              </Button>
            )}
            <Button
              intent="gray-outline"
              className={button}
              onClick={() => host.folder?.choose()}
            >
              <Trans>Change</Trans>
            </Button>
          </div>
        </SettingsRow>
      )}
      {host?.handsOff && (
        <SettingsRow
          label={t`The app's downloads`}
          help={t`The app saves what you download and plays it without a connection.`}
        >
          <Button
            intent="gray-outline"
            className={button}
            onClick={() => host.handsOff?.open()}
          >
            <Trans>Open</Trans>
          </Button>
        </SettingsRow>
      )}
      {!host?.handsOff && (
        <Select
          label={t`Downloads at once`}
          help={t`The rest wait their turn.`}
          options={DOWNLOADS_AT_ONCE.map((n) => ({
            value: String(n),
            label: String(n),
          }))}
          value={String(concurrent)}
          onValueChange={(value) => setConcurrent(Number(value))}
        />
      )}
      <Select
        label={t`Version searches at once`}
        help={t`Versions are found for this many episodes at a time when a season or show is added.`}
        options={DOWNLOAD_SEARCHES.map((n) => ({
          value: String(n),
          label: String(n),
        }))}
        value={String(searches)}
        onValueChange={(value) => setSearches(Number(value))}
      />
      {!host?.handsOff && (
        <Switch
          side="right"
          label={t`Save subtitles`}
          help={t`Subtitle files go next to the video, named so players find them.`}
          value={subtitles}
          onValueChange={setSubtitles}
        />
      )}
      {currentHost().name === 'android-app' && (
        <Switch
          side="right"
          label={t`Only on Wi-Fi`}
          help={t`Downloads wait for Wi-Fi or another unmetered network rather than use mobile data.`}
          value={wifiOnly}
          onValueChange={setWifiOnly}
        />
      )}
    </SettingsCard>
  );
}
