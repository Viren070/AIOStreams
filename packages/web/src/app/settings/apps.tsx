import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { toast } from 'sonner';
import { Select } from '@aiostreams/ui/select';
import { Switch } from '@aiostreams/ui/switch';
import { Button } from '@aiostreams/ui/button';
import { copyToClipboard } from '@aiostreams/ui/utils/clipboard';
import {
  diagnosticsReport,
  SendReportDialog,
  withContext,
} from '@/components/send-report';
import { currentHost } from '@/lib/hosts';
import {
  openLogs,
  requestDiagnostics,
  applyLabel,
  applyUpdate,
  checkForUpdates,
  updateStatus,
  useUpdateState,
} from '@/lib/hosts/shell';
import {
  checkDiscord,
  useDiscordStatus,
  type DiscordStatus,
} from '@/lib/hosts/shell/desktop';
import { appBridge } from '@/lib/hosts/shell/bridge';
import {
  settings,
  useSetting,
  DISCORD_EVENTS,
  type DiscordEvent,
} from '@/lib/settings';
import { useServerInfo } from '@/lib/jellyfin/server-info';
import { SettingsCard, SettingsRow } from './_components/settings-card';

function UpdatesCard() {
  const [setting, setSetting] = useSetting(settings.app.updateChannel);
  const update = useUpdateState();
  const channel =
    setting === 'installed' ? (update?.channel ?? 'stable') : setting;
  const busy = update?.state === 'checking' || update?.state === 'downloading';
  const button = 'w-full rounded-full sm:w-auto';
  return (
    <SettingsCard name="updates" title={t`Updates`} holds="local">
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
      description={t`What your Discord profile shows.`}
      holds="device"
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
  return (
    <>
      <UpdatesCard />
      <SettingsCard name="troubleshooting" title={t`Troubleshooting`}>
        <DiagnosticsRow />
      </SettingsCard>
    </>
  );
}
