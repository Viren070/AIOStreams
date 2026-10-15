import { useQuery } from '@tanstack/react-query';
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

const LINKS = [
  {
    name: 'Source code',
    help: 'Where the app is made, and where to report a problem.',
    url: REPO_URL,
  },
  {
    name: 'Documentation',
    help: 'How to use the app and what each setting does.',
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
      'Server',
      info.data?.ServerName &&
        (version
          ? `${info.data.ServerName} (${version})`
          : info.data.ServerName),
    ],
    ['Address', serverAddress(client.base)],
    ['Jellyfin API', info.data?.Version],
    ['Web app', __APP_COMMIT__],
    ...(shell
      ? ([
          [
            shell.platform === 'android' ? 'Android app' : 'Desktop app',
            shell.app,
          ],
          ...(shell.player && !shell.mpv
            ? [['Player', shell.player]]
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
            label="Desktop app"
            help="This web app with a player of its own, which plays what a browser can't, on Windows, Mac and Linux."
          >
            <Button
              intent="gray-outline"
              className="w-full rounded-full sm:w-auto"
              onClick={() =>
                window.open(DESKTOP_DOWNLOAD_URL, '_blank', 'noopener')
              }
            >
              Download
            </Button>
          </SettingsRow>
        )}
        {LINKS.map((link) => (
          <SettingsRow key={link.name} label={link.name} help={link.help}>
            <Button
              intent="gray-outline"
              className="w-full rounded-full sm:w-auto"
              onClick={() => window.open(link.url, '_blank', 'noopener')}
            >
              Visit
            </Button>
          </SettingsRow>
        ))}
      </SettingsCard>
      <SettingsCard title="Credits">
        {credits(shell).map((credit) => (
          <SettingsRow key={credit.name} label={credit.name} help={credit.help}>
            <Button
              intent="gray-outline"
              className="w-full rounded-full sm:w-auto"
              onClick={() => window.open(credit.url, '_blank', 'noopener')}
            >
              Visit
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
      help: 'The interface is built on its components.',
      url: 'https://github.com/5rahim/seanime',
    },
    {
      name: 'Jellyfin',
      help: 'The API this app speaks.',
      url: 'https://jellyfin.org',
    },
    ...(shell
      ? [
          { name: 'mpv', help: 'Plays the video.', url: 'https://mpv.io' },
          {
            name: 'FFmpeg',
            help: 'Decodes what mpv plays.',
            url: 'https://ffmpeg.org',
          },
        ]
      : []),
    ...(build
      ? [{ ...build, help: 'Builds the mpv library this app ships with.' }]
      : []),
  ];
}
