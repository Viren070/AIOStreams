import { useQuery } from '@tanstack/react-query';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Button } from '@aiostreams/ui/button';
import { useSession } from '../../lib/session';
import { currentHost } from '../../lib/hosts';
import { useShellInfo, type ShellInfo } from '../../lib/hosts/shell';
import { serverAddress } from '../../lib/servers';
import { useServerInfo } from '../../lib/server-info';
import { SettingsCard, SettingsRow } from '../../components/settings-card';
import { DOCS_URL } from './common';

const REPO_URL = 'https://github.com/Viren070/AIOStreams';

/** The desktop app's stable release, whose notes link each download. */
const DESKTOP_DOWNLOAD_URL = `${REPO_URL}/releases/tag/desktop`;

const links = () => [
  {
    name: t`Source code`,
    help: t`Where the app is made, and where to report a problem.`,
    url: REPO_URL,
  },
  {
    name: t`Documentation`,
    help: t`How to use the app and what each setting does.`,
    url: `${DOCS_URL}/apps`,
  },
];

export function AboutSection() {
  const { client } = useSession();
  const shell = useShellInfo();
  const { version } = useServerInfo();
  const info = useQuery({
    queryKey: ['jf-system-info', client.base],
    queryFn: () =>
      client.get<{ ServerName?: string; Version?: string }>(
        '/System/Info/Public'
      ),
    staleTime: 5 * 60_000,
  });
  const rows: [string, string | null | undefined][] = [
    [
      t`Server`,
      info.data?.ServerName &&
        (version
          ? `${info.data.ServerName} (${version})`
          : info.data.ServerName),
    ],
    [t`Address`, serverAddress(client.base)],
    [t`Jellyfin API`, info.data?.Version],
    [t`Web app`, __APP_COMMIT__],
    ...(shell
      ? ([
          [
            shell.platform === 'android' ? t`Android app` : t`Desktop app`,
            shell.app,
          ],
          ...(shell.player && !shell.mpv
            ? [[t`Player`, shell.player]]
            : [
                ['mpv', shell.mpv],
                ['FFmpeg', shell.ffmpeg],
              ]),
        ] as [string, string | null][])
      : []),
  ];
  return (
    <>
      <SettingsCard>
        {rows.map(([label, value]) => (
          <SettingsRow key={label} label={label}>
            <span className="break-all text-sm text-[--muted]">
              {value || '…'}
            </span>
          </SettingsRow>
        ))}
        {currentHost().name === 'browser' && (
          <SettingsRow
            label={t`Desktop app`}
            help={t`This web app with a player of its own, which plays what a browser can't, on Windows, Mac and Linux.`}
          >
            <Button
              intent="gray-outline"
              className="w-full rounded-full sm:w-auto"
              onClick={() =>
                window.open(DESKTOP_DOWNLOAD_URL, '_blank', 'noopener')
              }
            >
              <Trans>Download</Trans>
            </Button>
          </SettingsRow>
        )}
        {links().map((link) => (
          <SettingsRow key={link.name} label={link.name} help={link.help}>
            <Button
              intent="gray-outline"
              className="w-full rounded-full sm:w-auto"
              onClick={() => window.open(link.url, '_blank', 'noopener')}
            >
              <Trans>Visit</Trans>
            </Button>
          </SettingsRow>
        ))}
      </SettingsCard>
      <SettingsCard
        name="credits"
        title={t({
          context: 'Projects the app is built on',
          message: 'Credits',
        })}
      >
        {credits(shell).map((credit) => (
          <SettingsRow key={credit.name} label={credit.name} help={credit.help}>
            <Button
              intent="gray-outline"
              className="w-full rounded-full sm:w-auto"
              onClick={() => window.open(credit.url, '_blank', 'noopener')}
            >
              <Trans>Visit</Trans>
            </Button>
          </SettingsRow>
        ))}
      </SettingsCard>
    </>
  );
}

/** The Linux app builds its own libmpv, so only these ship someone else's. */
const LIBMPV_BUILDS: Record<string, { name: string; url: string }> = {
  windows: {
    name: 'shinchiro',
    url: 'https://github.com/shinchiro/mpv-winbuild-cmake',
  },
  macos: { name: 'IINA', url: 'https://iina.io' },
};

function credits(
  shell: ShellInfo | null
): { name: string; help: string; url: string }[] {
  const build = shell ? LIBMPV_BUILDS[shell.platform] : undefined;
  return [
    {
      name: 'Seanime',
      help: t`The interface is built on its components.`,
      url: 'https://github.com/5rahim/seanime',
    },
    {
      name: 'Jellyfin',
      help: t`The API this app speaks.`,
      url: 'https://jellyfin.org',
    },
    ...(shell
      ? [
          { name: 'mpv', help: t`Plays the video.`, url: 'https://mpv.io' },
          {
            name: 'FFmpeg',
            help: t`Decodes what mpv plays.`,
            url: 'https://ffmpeg.org',
          },
        ]
      : []),
    ...(build
      ? [{ ...build, help: t`Builds the mpv library this app ships with.` }]
      : []),
  ];
}
