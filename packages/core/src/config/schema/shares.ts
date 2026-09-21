import { z } from 'zod';
import type { RuntimeConfigSection } from '../types.js';

/**
 * Network shares over the library tree. The tree itself is protocol-neutral;
 * WebDAV, NFS and the in-process FUSE mount are three adapters over the same
 * nodes, so nothing here layers one protocol on another. Each is an
 * independent `enabled` toggle. Mounting with rclone is not one of them: it
 * happens entirely outside AIOStreams, against the WebDAV share, and `rclone`
 * here only holds the optional hook for keeping such a mount fresh.
 */
export const sharesSchema = {
  fuse: {
    enabled: {
      schema: z.boolean(),
      default: false,
      label: 'Mount the library here',
      description:
        'Mount the library as an ordinary folder on this machine, in-process, ' +
        'with real symlinks and changes that show up immediately — the ' +
        'simplest setup when Sonarr, Radarr and your media server run on the ' +
        'same host. Linux only: it needs `/dev/fuse`, plus `SYS_ADMIN` and a ' +
        'shared bind in Docker, and the mount status panel says whether it is ' +
        'working. Leave it off to mount the library some other way — rclone ' +
        'against the WebDAV share, or a Linux client against the NFS share — ' +
        'or not at all, since a player like Infuse can read the WebDAV share ' +
        'directly.',
      env: 'SHARES_FUSE_ENABLED',
      requiresRestart: false,
      secret: false,
    },
    mountPath: {
      schema: z
        .string()
        .refine((v) => v.startsWith('/'), 'must be an absolute path'),
      default: '/mnt/aiostreams',
      label: 'Mount path',
      description:
        'Absolute path inside the AIOStreams container (or on the host when ' +
        'not using Docker) where the library is mounted. In Docker, bind the ' +
        'parent from the host with `rshared` (`/mnt:/mnt:rshared`) and give ' +
        'the arr and media server containers the same bind with `rslave`, so ' +
        'they see the mount at the same path. Applied on save: the mount is ' +
        'moved when the path changes.',
      env: 'SHARES_FUSE_MOUNT_PATH',
      requiresRestart: false,
      secret: false,
    },
    allowOther: {
      schema: z.boolean(),
      default: true,
      label: 'Allow other users',
      description:
        'Let processes running as a different user than AIOStreams read the ' +
        'mount (the `allow_other` mount option). Needed whenever the arr or ' +
        'media server runs as another uid, which is the normal Docker setup. ' +
        'Outside Docker, a non-root AIOStreams needs `user_allow_other` in ' +
        '`/etc/fuse.conf` for this.',
      env: 'SHARES_FUSE_ALLOW_OTHER',
      requiresRestart: false,
      secret: false,
    },
    owner: {
      schema: z.string().min(1),
      default: 'fuse',
      label: 'Stream owner',
      description:
        'Name streams started through the mount are attributed to in the ' +
        'dashboard and stream limits, since a local mount carries no login.',
      env: 'SHARES_FUSE_OWNER',
      requiresRestart: false,
      secret: false,
    },
  },
  webdav: {
    enabled: {
      schema: z.boolean(),
      default: true,
      label: 'WebDAV server',
      description:
        'Serves the library as a read-only WebDAV share at `/webdav`. This ' +
        'is the share to point rclone at when the mount runs somewhere ' +
        'AIOStreams cannot reach — another host, or Windows and macOS — and ' +
        'players that speak WebDAV themselves (Infuse, VLC) can browse it ' +
        'with nothing mounted. Sign in with an `AIOSTREAMS_AUTH` user that ' +
        'holds the `webdav` permission.',
      env: 'SHARES_WEBDAV_ENABLED',
      requiresRestart: false,
      secret: false,
    },
  },
  nfs: {
    enabled: {
      schema: z.boolean(),
      default: false,
      label: 'NFS server',
      description:
        'Exports the library over NFSv4 so Linux hosts and containers can ' +
        'mount it natively (`mount -t nfs4 <host>:/ /mnt/aiostreams`) with ' +
        'nothing in between. Use this instead of the local mount when the ' +
        'arr runs on a different Linux machine. NFSv4 carries no login, so ' +
        'access is controlled entirely by **Allowed clients**.',
      env: 'SHARES_NFS_ENABLED',
      requiresRestart: true,
      secret: false,
    },
    port: {
      schema: z.number().int().min(1).max(65535),
      default: 2049,
      label: 'NFS port',
      description:
        'TCP port the NFS server listens on. 2049 is what clients assume when ' +
        'no `port=` mount option is given.',
      env: 'SHARES_NFS_PORT',
      requiresRestart: true,
      secret: false,
    },
    bindAddress: {
      schema: z.string(),
      default: '0.0.0.0',
      label: 'NFS bind address',
      description:
        'Interface the NFS server listens on. `0.0.0.0` listens everywhere, ' +
        'which is what a Docker port mapping needs; `127.0.0.1` keeps it to ' +
        'this host.',
      env: 'SHARES_NFS_BIND_ADDRESS',
      requiresRestart: true,
      secret: false,
    },
    allowedClients: {
      schema: z.string(),
      default:
        '127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, ::1/128, fc00::/7',
      label: 'Allowed clients',
      description:
        'Comma-separated addresses or CIDR blocks that may connect. The default ' +
        'covers private networks, which includes Docker networks and a LAN; ' +
        'anything else is refused at connection time. Leave empty to allow ' +
        'everyone.',
      env: 'SHARES_NFS_ALLOWED_CLIENTS',
      requiresRestart: true,
      secret: false,
    },
    owner: {
      schema: z.string().min(1),
      default: 'nfs',
      label: 'Stream owner',
      description:
        'Name streams started over NFS are attributed to in the dashboard and ' +
        'stream limits, since the protocol carries no login.',
      env: 'SHARES_NFS_OWNER',
      requiresRestart: true,
      secret: false,
    },
  },
  rclone: {
    rcUrl: {
      schema: z.string(),
      default: '',
      label: 'Remote control URL',
      description:
        'Only for a mount you run yourself with `rclone mount --rc`. Put its ' +
        'remote control address here (e.g. `http://rclone:5572`) and ' +
        'AIOStreams will tell rclone to forget its cached directory listing ' +
        'whenever the library changes. Without it a finished download stays ' +
        'invisible to the mount until `--dir-cache-time` expires. Leave ' +
        'empty to disable.',
      env: 'SHARES_RCLONE_RC_URL',
      requiresRestart: false,
      secret: false,
    },
    rcUser: {
      schema: z.string(),
      default: '',
      label: 'Remote control username',
      description:
        'Username for the rclone remote control, if you started it with ' +
        '`--rc-user`. Leave empty when it needs no authentication.',
      env: 'SHARES_RCLONE_RC_USER',
      requiresRestart: false,
      secret: false,
    },
    rcPass: {
      schema: z.string(),
      default: '',
      label: 'Remote control password',
      description: 'Password for the rclone remote control (`--rc-pass`).',
      env: 'SHARES_RCLONE_RC_PASS',
      requiresRestart: false,
      secret: true,
    },
  },
} as const satisfies RuntimeConfigSection;
