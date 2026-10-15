import React from 'react';
import { toast } from 'sonner';
import { Select } from '@aiostreams/ui/select';
import { Switch } from '@aiostreams/ui/switch';
import { Textarea } from '@aiostreams/ui/textarea';
import { Button } from '@aiostreams/ui/button';
import { copyToClipboard } from '@aiostreams/ui/utils/clipboard';
import { currentHost } from '../../lib/hosts';
import {
  openLogs,
  requestDiagnostics,
  applyLabel,
  applyUpdate,
  checkForUpdates,
  updateStatus,
  useUpdateState,
} from '../../lib/hosts/shell';
import {
  checkDiscord,
  openMpvConfig,
  useDiscordStatus,
  type DiscordStatus,
} from '../../lib/hosts/shell/desktop';
import { readMpvConfig, saveMpvConfig } from '../../lib/hosts/shell/android';
import { appBridge } from '../../lib/hosts/shell/bridge';
import {
  settings,
  useSetting,
  DISCORD_EVENTS,
  type DiscordEvent,
} from '../../lib/settings';
import { useServerInfo } from '../../lib/server-info';
import { SettingsCard, SettingsRow } from '../../components/settings-card';
import { ON_DEVICE } from './common';

function UpdatesCard() {
  const [setting, setSetting] = useSetting(settings.app.updateChannel);
  const update = useUpdateState();
  const channel =
    setting === 'installed' ? (update?.channel ?? 'stable') : setting;
  const busy = update?.state === 'checking' || update?.state === 'downloading';
  const button = 'w-full rounded-full sm:w-auto';
  return (
    <SettingsCard title="Updates" description={ON_DEVICE}>
      <Select
        label="Channel"
        help="Nightly builds come from every change, ahead of releases, and can break."
        options={[
          { value: 'stable', label: 'Stable' },
          { value: 'nightly', label: 'Nightly' },
        ]}
        value={channel}
        onValueChange={(v) => setSetting(v as 'stable' | 'nightly')}
      />
      <SettingsRow label="Status" help={updateStatus(update)}>
        {update?.state === 'ready' ? (
          <Button intent="white" className={button} onClick={applyUpdate}>
            {applyLabel()}
          </Button>
        ) : (
          <Button
            intent="gray-outline"
            className={button}
            loading={busy}
            disabled={update?.state === 'off'}
            onClick={() => checkForUpdates(setting)}
          >
            Check now
          </Button>
        )}
      </SettingsRow>
    </SettingsCard>
  );
}

const DISCORD_LABELS: Record<DiscordEvent, { label: string; help?: string }> = {
  playing: {
    label: "What's playing",
    help: 'The title, the episode and the time left.',
  },
  titles: {
    label: 'Title pages',
    help: 'The movie or show whose page is open.',
  },
  home: { label: 'Home' },
  discover: { label: 'Discover' },
  search: { label: 'Search', help: 'That you are searching, not what for.' },
  calendar: { label: 'Calendar' },
  favourites: { label: 'Favourites' },
  activity: { label: 'Activity' },
};

function discordStatus(status: DiscordStatus | null): string {
  switch (status?.state) {
    case undefined:
      return 'Checking…';
    case 'connected':
      return 'Connected to Discord.';
    case 'not-found':
      return 'Discord is not running on this computer.';
    case 'failed':
      return `Could not connect: ${status.message}`;
    case 'refused':
      return `Discord refused the status: ${status.message}`;
  }
}

function DiscordEventSwitch({ event }: { event: DiscordEvent }) {
  const [value, setValue] = useSetting(settings.app.discord[event]);
  const { label, help } = DISCORD_LABELS[event];
  return (
    <Switch
      side="right"
      label={label}
      help={help}
      value={value}
      onValueChange={setValue}
    />
  );
}

function DiscordCard() {
  const [events] = useSetting(settings.app.discordEvents);
  const any = Object.values(events).some(Boolean);
  const status = useDiscordStatus();
  React.useEffect(() => {
    if (any) checkDiscord();
  }, [any]);
  return (
    <SettingsCard
      title="Discord"
      description={`What your Discord profile shows. ${ON_DEVICE}`}
    >
      {DISCORD_EVENTS.map((event) => (
        <DiscordEventSwitch key={event} event={event} />
      ))}
      {any && (
        <SettingsRow label="Status" help={discordStatus(status)}>
          <Button
            intent="gray-outline"
            className="w-full rounded-full sm:w-auto"
            onClick={checkDiscord}
          >
            Check now
          </Button>
        </SettingsRow>
      )}
    </SettingsCard>
  );
}

export function AppSection() {
  const app = currentHost().settings;
  return (
    <SettingsCard>
      <SettingsRow label="App settings" help={app?.help}>
        <Button
          intent="gray-outline"
          className="w-full rounded-full sm:w-auto"
          onClick={app?.open}
        >
          Open
        </Button>
      </SettingsRow>
    </SettingsCard>
  );
}

export function DesktopSection() {
  return (
    <>
      <UpdatesCard />
      <DiscordCard />
      <SettingsCard title="mpv">
        <SettingsRow
          label="mpv configuration"
          help="mpv.conf, input.conf, scripts and shaders in this folder apply to the built-in mpv."
        >
          <Button
            intent="gray-outline"
            className="w-full rounded-full sm:w-auto"
            onClick={openMpvConfig}
          >
            Open folder
          </Button>
        </SettingsRow>
      </SettingsCard>
      <SettingsCard title="Troubleshooting">
        <SettingsRow
          label="Logs"
          help="What the app did each day, kept for a week."
        >
          <Button
            intent="gray-outline"
            className="w-full rounded-full sm:w-auto"
            onClick={openLogs}
          >
            Open folder
          </Button>
        </SettingsRow>
        <DiagnosticsRow />
      </SettingsCard>
    </>
  );
}

function DiagnosticsRow() {
  const server = useServerInfo();
  return (
    <SettingsRow
      label="Diagnostics"
      help="Versions and the recent log, to paste into a bug report."
    >
      <Button
        intent="gray-outline"
        className="w-full rounded-full sm:w-auto"
        onClick={() =>
          requestDiagnostics(server.version && `AIOStreams ${server.version}`)
            .then((text) =>
              copyToClipboard(text, {
                onSuccess: () => toast.success('Diagnostics copied'),
                onError: () => toast.error('Could not copy them'),
              })
            )
            .catch((e: Error) => toast.error(e.message))
        }
      >
        Copy
      </Button>
    </SettingsRow>
  );
}

export function AndroidSection() {
  const [engine] = useSetting(settings.player.engine);
  const [pip, setPip] = useSetting(settings.app.pip);
  const [background, setBackground] = useSetting(settings.app.background);
  const canPip = appBridge()?.pip !== false;
  return (
    <>
      <UpdatesCard />
      <SettingsCard title="Leaving the app" description={ON_DEVICE}>
        {canPip && (
          <Switch
            side="right"
            label="Picture-in-picture"
            help="Keeps the video playing in a small window when you leave the app."
            value={pip}
            onValueChange={setPip}
          />
        )}
        <Switch
          side="right"
          label="Play in the background"
          help={
            canPip
              ? 'Keeps the sound going with the screen off, or when you leave without picture-in-picture.'
              : 'Keeps the sound going with the screen off, or when you leave the app.'
          }
          value={background}
          onValueChange={setBackground}
        />
      </SettingsCard>
      {engine !== 'exoplayer' && <MpvConfigCard />}
      <SettingsCard title="Troubleshooting">
        <DiagnosticsRow />
      </SettingsCard>
    </>
  );
}

/** mpv.conf, written by the app and applied to what plays next. */
function MpvConfigCard() {
  const [text, setText] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => {
    readMpvConfig().then(setText, () => setText(''));
  }, []);
  return (
    <SettingsCard title="mpv">
      <Textarea
        label="mpv.conf"
        help="Options for the built-in mpv, one per line, as mpv's manual lists them."
        value={text ?? ''}
        disabled={text === null}
        onValueChange={setText}
        rows={8}
        spellCheck={false}
        className="font-mono text-sm"
      />
      <Button
        intent="gray-outline"
        className="w-full rounded-full sm:w-auto"
        loading={saving}
        disabled={text === null}
        onClick={() => {
          setSaving(true);
          saveMpvConfig(text ?? '')
            .then(
              () => toast.success('Saved'),
              (e: Error) => toast.error(e.message)
            )
            .finally(() => setSaving(false));
        }}
      >
        Save
      </Button>
    </SettingsCard>
  );
}
