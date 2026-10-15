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
import { ON_DEVICE } from './common';

export function DownloadsSection() {
  const host = downloadsHost();
  const folder = useDownloadFolder();
  const [concurrent, setConcurrent] = useSetting(settings.downloads.concurrent);
  const [searches, setSearches] = useSetting(settings.downloads.searches);
  const [subtitles, setSubtitles] = useSetting(settings.downloads.subtitles);
  const [wifiOnly, setWifiOnly] = useSetting(settings.downloads.wifiOnly);
  const button = 'w-full rounded-full sm:w-auto';
  return (
    <SettingsCard description={ON_DEVICE}>
      {host?.folder && (
        <SettingsRow
          label="Folder"
          help={
            <span className="break-all">
              {folder ?? '…'}. New downloads go here; ones already saved stay
              where they are.
            </span>
          }
        >
          <div className="flex gap-2">
            <Button
              intent="gray-outline"
              className={button}
              onClick={() => host.folder?.open()}
            >
              Open
            </Button>
            <Button
              intent="gray-outline"
              className={button}
              onClick={() => host.folder?.choose()}
            >
              Change
            </Button>
          </div>
        </SettingsRow>
      )}
      {host?.handsOff && (
        <SettingsRow
          label="The app's downloads"
          help="The app saves what you download and plays it without a connection."
        >
          <Button
            intent="gray-outline"
            className={button}
            onClick={() => host.handsOff?.open()}
          >
            Open
          </Button>
        </SettingsRow>
      )}
      {!host?.handsOff && (
        <Select
          label="Downloads at once"
          help="The rest wait their turn."
          options={DOWNLOADS_AT_ONCE.map((n) => ({
            value: String(n),
            label: String(n),
          }))}
          value={String(concurrent)}
          onValueChange={(value) => setConcurrent(Number(value))}
        />
      )}
      <Select
        label="Version searches at once"
        help="Versions are found for this many episodes at a time when a season or show is added."
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
          label="Save subtitles"
          help="Subtitle files go next to the video, named so players find them."
          value={subtitles}
          onValueChange={setSubtitles}
        />
      )}
      {currentHost().name === 'android-app' && (
        <Switch
          side="right"
          label="Only on Wi-Fi"
          help="Downloads wait for Wi-Fi or another unmetered network rather than use mobile data."
          value={wifiOnly}
          onValueChange={setWifiOnly}
        />
      )}
    </SettingsCard>
  );
}
