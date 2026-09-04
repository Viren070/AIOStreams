import React from 'react';
import { toast } from 'sonner';
import { BiCopy } from 'react-icons/bi';
import { Card } from '@/components/ui/card';
import { IconButton } from '@/components/ui/button';
import { useConfigValue } from './use-config-value';

/**
 * Ready-to-run mount recipes for the share, filled in from the live config.
 *
 * Nothing here is a setting: it is the step that always goes wrong. The share
 * URL, the mount path the arrs expect and the flags that make symlinks work
 * have to agree across three containers, and a recipe the user can paste is
 * worth more than another page of documentation.
 */
function Snippet({
  title,
  note,
  command,
}: {
  title: string;
  note?: string;
  command: string;
}) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      toast.success('Copied');
    } catch {
      toast.error('Could not copy to the clipboard');
    }
  };
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{title}</p>
        <IconButton
          size="sm"
          intent="white-subtle"
          icon={<BiCopy />}
          onClick={copy}
        />
      </div>
      {note && <p className="text-xs text-[--muted]">{note}</p>}
      <pre className="text-xs bg-[--subtle] rounded-[--radius] p-3 overflow-x-auto whitespace-pre">
        {command}
      </pre>
    </div>
  );
}

function RcloneRecipes({
  mountDir,
  davUrl,
}: {
  mountDir: string;
  davUrl: string;
}) {
  const remote = [
    `rclone config create aiostreams webdav \\`,
    `  url=${davUrl} \\`,
    `  vendor=other \\`,
    `  user=YOUR_AIOSTREAMS_USER \\`,
    `  pass="$(rclone obscure YOUR_PASSWORD)"`,
  ].join('\n');

  const mount = [
    `rclone mount aiostreams: ${mountDir} \\`,
    `  --links \\`,
    `  --read-only \\`,
    `  --dir-cache-time 20s \\`,
    `  --vfs-cache-mode off \\`,
    `  --allow-other`,
  ].join('\n');

  const windows = [
    `rclone mount aiostreams: Z: ^`,
    `  --links ^`,
    `  --read-only ^`,
    `  --network-mode ^`,
    `  --dir-cache-time 20s`,
  ].join('\n');

  return (
    <>
      <Snippet
        title="1. Create the rclone remote"
        note="Use an AIOSTREAMS_AUTH user that holds the webdav permission."
        command={remote}
      />
      <Snippet
        title="2. Mount it (Linux / Docker)"
        note="--links is what turns the .rclonelink files into real symlinks; without it the arrs import a text file. Needs rclone 1.70.3 or newer, plus SYS_ADMIN, /dev/fuse and a shared /mnt bind in Docker."
        command={mount}
      />
      <Snippet
        title="Windows"
        note="Use rclone with WinFsp rather than mapping the WebDAV URL in Explorer: Explorer's WebDAV client cannot open files larger than 4 GB and drops paths over 260 characters."
        command={windows}
      />
    </>
  );
}

function NfsRecipe({
  host,
  port,
  mountDir,
}: {
  host: string;
  port: string;
  mountDir: string;
}) {
  const cmd = [
    `sudo mkdir -p ${mountDir}`,
    `sudo mount -t nfs4 -o ro,port=${port} ${host}:/ ${mountDir}`,
  ].join('\n');
  return (
    <Snippet
      title="Mount it from another Linux machine"
      note="Straight from the kernel, no rclone. That machine's IP has to fall inside Allowed clients, and the mount point must be the same absolute path the arrs use."
      command={cmd}
    />
  );
}

function FuseRecipes({ mountPath }: { mountPath: string }) {
  const parent = mountPath.replace(/\/[^/]*$/, '') || '/';
  const compose = [
    `services:`,
    `  aiostreams:`,
    `    image: ghcr.io/viren070/aiostreams:latest`,
    `    cap_add:`,
    `      - SYS_ADMIN`,
    `    devices:`,
    `      - /dev/fuse:/dev/fuse:rwm`,
    `    security_opt:`,
    `      - apparmor:unconfined`,
    `    volumes:`,
    `      # rshared is what makes the mount visible to the other containers`,
    `      - ${parent}:${parent}:rshared`,
    ``,
    `  sonarr:`,
    `    volumes:`,
    `      - ${parent}:${parent}:rslave`,
  ].join('\n');

  return (
    <>
      <Snippet
        title="Docker: give the container what a mount needs"
        note={`AIOStreams mounts the library at ${mountPath} inside its own container. Every container that reads it (Sonarr, Radarr, Plex, Jellyfin) binds the same parent directory with rslave so the mount shows up at the same path.`}
        command={compose}
      />
      <p className="text-xs text-[--muted]">
        FUSE is Linux only. On Windows or macOS turn the local mount off and
        mount the WebDAV share with rclone instead; on another Linux machine,
        the NFS server serves the same tree.
      </p>
    </>
  );
}

export function ConnectPanel() {
  const fuseOn = useConfigValue('shares.fuse.enabled') === 'true';
  const mountDir = useConfigValue('arr.mountDir') || '/mnt/aiostreams';
  const fuseMountPath =
    useConfigValue('shares.fuse.mountPath') || '/mnt/aiostreams';
  const webdavOn = useConfigValue('shares.webdav.enabled') !== 'false';
  const nfsOn = useConfigValue('shares.nfs.enabled') === 'true';
  const nfsPort = useConfigValue('shares.nfs.port') || '2049';
  const base = (
    useConfigValue('bootstrap.baseUrl') ||
    (typeof window !== 'undefined' ? window.location.origin : '')
  ).replace(/\/$/, '');
  const davUrl = `${base}/webdav`;
  let host = 'AIOSTREAMS_HOST';
  try {
    host = new URL(base).hostname || host;
  } catch {
    // A base URL that will not parse just leaves the placeholder in the recipe.
  }

  return (
    <Card className="p-4 space-y-5">
      <div>
        <p className="font-semibold">Connect</p>
        <p className="text-sm text-[--muted]">
          Mount the share so Sonarr, Radarr, Plex or Jellyfin can read files the
          engine streams on demand. The mount path must be the same absolute
          path in every container that reads it — that is what the Sonarr /
          Radarr mount directory setting records.
        </p>
      </div>
      {fuseOn ? (
        <FuseRecipes mountPath={fuseMountPath} />
      ) : (
        <>
          {webdavOn && <RcloneRecipes mountDir={mountDir} davUrl={davUrl} />}
          {nfsOn && (
            <NfsRecipe host={host} port={nfsPort} mountDir={mountDir} />
          )}
          {!webdavOn && !nfsOn && (
            <p className="text-xs text-[--muted]">
              Nothing is being served right now: turn the local mount on, or
              switch on the WebDAV or NFS server above.
            </p>
          )}
        </>
      )}
      {webdavOn && (
        <div className="space-y-1">
          <p className="text-sm font-medium">Without mounting anything</p>
          <p className="text-xs text-[--muted]">
            A player that speaks WebDAV (Infuse, VLC, a file manager) can open{' '}
            <code className="font-mono">{davUrl}</code> directly, signed in as
            an AIOSTREAMS_AUTH user with the webdav permission. Nothing needs
            mounting for that — but Sonarr and Radarr do need a real folder.
          </p>
        </div>
      )}
    </Card>
  );
}
