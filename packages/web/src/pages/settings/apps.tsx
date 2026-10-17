import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { toast } from 'sonner';
import { Select } from '@aiostreams/ui/select';
import { Switch } from '@aiostreams/ui/switch';
import { Textarea } from '@aiostreams/ui/textarea';
import { Button } from '@aiostreams/ui/button';
import { copyToClipboard } from '@aiostreams/ui/utils/clipboard';
import {
  diagnosticsReport,
  SendReportDialog,
  withContext,
} from '../../components/send-report';
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
import { onDevice } from './common';

function UpdatesCard() {
  const [setting, setSetting] = useSetting(settings.app.updateChannel);
  const update = useUpdateState();
  const channel =
    setting === 'installed' ? (update?.channel ?? 'stable') : setting;
  const busy = update?.state === 'checking' || update?.state === 'downloading';
  const button = 'w-full rounded-full sm:w-auto';
  return (
    <SettingsCard name="updates" title={t`Updates`} description={onDevice()}>
      <Select
        label={t`Channel`}
        help={t`Nightly builds come from every change, ahead of releases, and can break.`}
        options={[
          { value: 'stable', label: t`Stable` },
          { value: 'nightly', label: t`Nightly` },
        ]}
        value={channel}
        onValueChange={(v) => setSetting(v as 'stable' | 'nightly')}
      />
      <SettingsRow label={t`Status`} help={updateStatus(update)}>
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
            <Trans>Check now</Trans>
          </Button>
        )}
      </SettingsRow>
    </SettingsCard>
  );
}

const discordLabels = (event: DiscordEvent): { label: string; help?: string } =>
  ({
    playing: {
      label: t`What's playing`,
      help: t`The title, the episode and the time left.`,
    },
    titles: {
      label: t`Title pages`,
      help: t`The movie or show whose page is open.`,
    },
    home: { label: t`Home` },
    discover: { label: t`Discover` },
    search: {
      label: t`Search`,
      help: t`That you are searching, not what for.`,
    },
    calendar: { label: t`Calendar` },
    favourites: { label: t`Favourites` },
    activity: { label: t`Activity` },
  })[event];

function discordStatus(status: DiscordStatus | null): string {
  switch (status?.state) {
    case undefined:
      return t`Checking…`;
    case 'connected':
      return t`Connected to Discord.`;
    case 'not-found':
      return t`Discord is not running on this computer.`;
    case 'failed': {
      const message = status.message ?? '';
      return t`Could not connect: ${message}`;
    }
    case 'refused': {
      const message = status.message ?? '';
      return t`Discord refused the status: ${message}`;
    }
  }
}

function DiscordEventSwitch({ event }: { event: DiscordEvent }) {
  const [value, setValue] = useSetting(settings.app.discord[event]);
  const { label, help } = discordLabels(event);
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
      name="discord"
      title={t`Discord`}
      description={t`What your Discord profile shows. Kept on this device.`}
    >
      {DISCORD_EVENTS.map((event) => (
        <DiscordEventSwitch key={event} event={event} />
      ))}
      {any && (
        <SettingsRow label={t`Status`} help={discordStatus(status)}>
          <Button
            intent="gray-outline"
            className="w-full rounded-full sm:w-auto"
            onClick={checkDiscord}
          >
            <Trans>Check now</Trans>
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
      <SettingsRow label={t`App settings`} help={app?.help}>
        <Button
          intent="gray-outline"
          className="w-full rounded-full sm:w-auto"
          onClick={app?.open}
        >
          <Trans>Open</Trans>
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
      <SettingsCard name="mpv" title="mpv">
        <SettingsRow
          label={t`mpv configuration`}
          help={t`mpv.conf, input.conf, scripts and shaders in this folder apply to the built-in mpv.`}
        >
          <Button
            intent="gray-outline"
            className="w-full rounded-full sm:w-auto"
            onClick={openMpvConfig}
          >
            <Trans>Open folder</Trans>
          </Button>
        </SettingsRow>
      </SettingsCard>
      <SettingsCard name="troubleshooting" title={t`Troubleshooting`}>
        <SettingsRow
          label={t`Logs`}
          help={t`What the app did each day, kept for a week.`}
        >
          <Button
            intent="gray-outline"
            className="w-full rounded-full sm:w-auto"
            onClick={openLogs}
          >
            <Trans>Open folder</Trans>
          </Button>
        </SettingsRow>
        <DiagnosticsRow />
      </SettingsCard>
    </>
  );
}

function DiagnosticsRow() {
  const server = useServerInfo();
  const [sending, setSending] = React.useState(false);
  // eslint-disable-next-line lingui/no-unlocalized-strings -- the report's own header
  const header = server.version && `AIOStreams ${server.version}`;
  const button = 'w-full rounded-full sm:w-auto';
  if (!server.reports && appBridge()?.tv) return null;
  return (
    <SettingsRow
      label={t`Report a problem`}
      help={
        server.reports
          ? t`Sends this device's details and the app's recent log to the server, with a code to give whoever looks into it.`
          : t`Versions and the recent log, to paste into a bug report.`
      }
    >
      <div className="flex w-full flex-wrap gap-2 sm:w-auto">
        {server.reports && (
          <Button
            intent="gray-outline"
            className={button}
            onClick={() => setSending(true)}
          >
            <Trans>Send report</Trans>
          </Button>
        )}
        {/* Nothing to paste into on a TV. */}
        {!appBridge()?.tv && (
          <Button
            intent="gray-outline"
            className={button}
            onClick={() =>
              requestDiagnostics(header)
                .then((text) =>
                  copyToClipboard(withContext(text), {
                    onSuccess: () => toast.success(t`Diagnostics copied`),
                    onError: () => toast.error(t`Could not copy them`),
                  })
                )
                .catch((e: Error) => toast.error(e.message))
            }
          >
            <Trans>Copy</Trans>
          </Button>
        )}
      </div>
      <SendReportDialog
        open={sending}
        content={() => diagnosticsReport(header)}
        onClose={() => setSending(false)}
      />
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
      <SettingsCard
        name="leaving-the-app"
        title={t`Leaving the app`}
        description={onDevice()}
      >
        {canPip && (
          <Switch
            side="right"
            label={t`Picture-in-picture`}
            help={t`Keeps the video playing in a small window when you leave the app.`}
            value={pip}
            onValueChange={setPip}
          />
        )}
        <Switch
          side="right"
          label={t`Play in the background`}
          help={
            canPip
              ? t`Keeps the sound going with the screen off, or when you leave without picture-in-picture.`
              : t`Keeps the sound going with the screen off, or when you leave the app.`
          }
          value={background}
          onValueChange={setBackground}
        />
      </SettingsCard>
      {engine !== 'exoplayer' && <MpvConfigCard />}
      <SettingsCard name="troubleshooting" title={t`Troubleshooting`}>
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
    <SettingsCard name="mpv" title="mpv">
      <Textarea
        label="mpv.conf"
        help={t`Options for the built-in mpv, one per line, as mpv's manual lists them.`}
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
              () => toast.success(t`Saved`),
              (e: Error) => toast.error(e.message)
            )
            .finally(() => setSaving(false));
        }}
      >
        <Trans>Save</Trans>
      </Button>
    </SettingsCard>
  );
}
