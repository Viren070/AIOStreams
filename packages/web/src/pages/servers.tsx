import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { BiDotsVerticalRounded, BiPlus } from 'react-icons/bi';
import { Button, IconButton } from '@aiostreams/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@aiostreams/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@aiostreams/ui/dropdown-menu';
import { TextInput } from '@aiostreams/ui/text-input';
import { cn } from '@aiostreams/ui/core/styling';
import {
  ConfirmationDialog,
  useConfirmationDialog,
} from '@aiostreams/ui/shared/confirmation-dialog';
import { UserAvatar } from '../components/user-avatar';
import { JellyfinClient } from '../lib/client';
import { currentHost } from '../lib/hosts';
import { readCredentials } from '../lib/credentials';
import { endSession } from '../lib/session';
import {
  checkServer,
  findServer,
  forgetServer,
  savedServers,
  serverAddress,
  type SavedServer,
  type ServerStatus,
} from '../lib/servers';
import {
  AUTH_CARD,
  ErrorLine,
  FADE,
  LinkRow,
  publicAvatar,
  RISE,
  Screen,
  SPRING,
  useShake,
} from './sign-in';

function AddServer({
  initial,
  onAdded,
  onBack,
}: {
  initial?: string | null;
  onAdded(server: SavedServer): void;
  onBack?: () => void;
}) {
  const [address, setAddress] = React.useState(initial ?? '');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [scope, shake] = useShake<HTMLFormElement>();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onAdded(await findServer(address));
    } catch (err) {
      setError((err as Error).message);
      shake();
      setBusy(false);
    }
  };

  return (
    <form
      ref={scope}
      onSubmit={submit}
      data-ui="auth-card"
      className={AUTH_CARD}
    >
      <div className="space-y-1 text-center">
        <h1 data-ui="page-title" className="text-xl font-semibold">
          Add a server
        </h1>
        <p className="text-sm text-[--muted]">
          The address of the AIOStreams instance where you set up your addon.
          Other Jellyfin servers work too.
        </p>
      </div>
      <TextInput
        label="Server address"
        placeholder="https://aiostreams.example.com"
        value={address}
        onValueChange={setAddress}
        autoComplete="url"
        spellCheck={false}
        autoFocus
        required
      />
      <ErrorLine error={error} />
      <Button
        type="submit"
        intent="white"
        className="w-full rounded-full"
        loading={busy}
      >
        Connect
      </Button>
      <LinkRow links={[!!onBack && { label: 'Back', onClick: onBack }]} />
    </form>
  );
}

const TILE = {
  hidden: { opacity: 0, y: 14, scale: 0.96 },
  shown: { opacity: 1, y: 0, scale: 1 },
};

/** Wraps, as configurations on one host differ only at the end. */
function Address({ base }: { base: string }) {
  const address = serverAddress(base);
  return (
    <span
      title={address}
      className="line-clamp-2 break-all text-xs text-[--muted]"
    >
      {address}
    </span>
  );
}

function StatusLine({
  base,
  status,
}: {
  base: string;
  status: ServerStatus | undefined;
}) {
  const avatar = React.useMemo(
    () =>
      status?.kind === 'signed-in'
        ? publicAvatar(new JellyfinClient(base), status.user)
        : null,
    [base, status]
  );
  switch (status?.kind) {
    case 'signed-in':
      return (
        <>
          <UserAvatar
            name={status.user.Name}
            src={avatar}
            className="size-6 text-[0.65rem]"
          />
          <span className="truncate">{status.user.Name}</span>
        </>
      );
    case 'signed-out':
      return <span className="text-[--muted]">Signed out</span>;
    case 'unreachable':
      return (
        <span className="flex items-center gap-2 text-red-300">
          <span className="size-1.5 rounded-full bg-red-400" />
          Can’t reach
        </span>
      );
    default:
      return null;
  }
}

/** The logo over a blurred copy of itself, or the name's initial without one. */
function Banner({ name, logo }: { name: string; logo: string | null }) {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [logo]);
  const shown = logo && !failed ? logo : null;
  const lift =
    'transition-transform group-hover/server:scale-105 group-focus-visible/server:scale-105';
  return (
    <span className="relative flex h-28 w-full flex-none items-center justify-center overflow-hidden bg-white/[0.03]">
      {shown ? (
        <>
          <img
            src={shown}
            alt=""
            className="absolute inset-0 size-full scale-150 object-cover opacity-50 blur-2xl"
          />
          <img
            src={shown}
            alt=""
            onError={() => setFailed(true)}
            className={cn(
              'relative size-16 object-contain drop-shadow-lg',
              lift
            )}
          />
        </>
      ) : (
        <UserAvatar
          name={name}
          className={cn('size-16 rounded-2xl text-2xl shadow-lg', lift)}
        />
      )}
    </span>
  );
}

function ServerCard({
  server,
  onChoose,
  onSignOut,
  onForget,
}: {
  server: SavedServer;
  onChoose(): void;
  onSignOut(): void;
  onForget(): void;
}) {
  const check = useQuery({
    queryKey: ['server-check', server.base],
    queryFn: () => checkServer(server.base),
    staleTime: 0,
  });
  const { name, logo } = check.data?.label ?? server;
  const status = check.data?.status;
  const actions = [
    ...(status?.kind === 'signed-in'
      ? [{ label: 'Sign out', run: onSignOut, className: undefined }]
      : []),
    { label: 'Remove', run: onForget, className: 'text-red-300' },
  ];
  // The whole address, which the card cuts short when it is long.
  const address = serverAddress(server.base);
  const card = (
    <button
      type="button"
      onClick={onChoose}
      className="group/server flex h-full w-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-gray-950/80 text-left shadow-xl transition-colors hover:border-white/25 focus-visible:border-white/25"
    >
      <Banner name={name} logo={logo} />
      <span className="flex w-full flex-1 flex-col gap-3 p-4">
        <span className="block min-w-0 space-y-0.5">
          <span className="block truncate font-semibold">{name}</span>
          <Address base={server.base} />
        </span>
        <span
          data-ui="server-status"
          className="mt-auto flex h-6 items-center gap-2 text-sm"
        >
          <StatusLine base={server.base} status={status} />
        </span>
      </span>
    </button>
  );
  return (
    <motion.li
      variants={TILE}
      transition={SPRING}
      data-ui="server"
      className="relative w-full sm:w-72"
    >
      {currentHost().tv ? (
        // A remote can't reach a button inside the card; a held Select opens this.
        <ContextMenu modal={false}>
          <ContextMenuTrigger asChild>{card}</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuLabel className="max-w-72 break-all text-xs font-normal">
              {address}
            </ContextMenuLabel>
            <ContextMenuSeparator />
            {actions.map((a) => (
              <ContextMenuItem
                key={a.label}
                onClick={a.run}
                className={a.className}
              >
                {a.label}
              </ContextMenuItem>
            ))}
          </ContextMenuContent>
        </ContextMenu>
      ) : (
        <>
          {card}
          <DropdownMenu
            align="end"
            trigger={
              <IconButton
                size="sm"
                intent="gray-subtle"
                className="absolute right-2 top-2 rounded-full"
                icon={<BiDotsVerticalRounded />}
                aria-label={`Options for ${name}`}
              />
            }
          >
            <DropdownMenuLabel className="max-w-72 select-text break-all text-xs font-normal">
              {address}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {actions.map((a) => (
              <DropdownMenuItem
                key={a.label}
                onClick={a.run}
                className={a.className}
              >
                {a.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenu>
        </>
      )}
    </motion.li>
  );
}

function ServerList({
  servers,
  onChoose,
  onSignOut,
  onForget,
  onAdd,
}: {
  servers: SavedServer[];
  onChoose(server: SavedServer): void;
  onSignOut(server: SavedServer): void;
  onForget(server: SavedServer): void;
  onAdd(): void;
}) {
  return (
    <div className="space-y-8">
      <h1 data-ui="page-title" className="text-center text-2xl font-semibold">
        Choose a server
      </h1>
      <motion.ul
        data-ui="servers"
        className="flex flex-wrap justify-center gap-4"
        initial="hidden"
        animate="shown"
        variants={{ shown: { transition: { staggerChildren: 0.05 } } }}
      >
        {servers.map((server) => (
          <ServerCard
            key={server.base}
            server={server}
            onChoose={() => onChoose(server)}
            onSignOut={() => onSignOut(server)}
            onForget={() => onForget(server)}
          />
        ))}
        <motion.li
          variants={TILE}
          transition={SPRING}
          className="w-full sm:w-72"
        >
          <button
            type="button"
            onClick={onAdd}
            className="flex h-full min-h-28 w-full flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/15 p-4 text-sm text-[--muted] transition-colors hover:border-white/30 hover:text-white focus-visible:border-white/30 focus-visible:text-white"
          >
            <span className="flex size-12 items-center justify-center rounded-full bg-white/5 text-2xl">
              <BiPlus />
            </span>
            Add a server
          </button>
        </motion.li>
      </motion.ul>
    </div>
  );
}

export function ServersPage({
  onChoose,
  address,
}: {
  onChoose(server: SavedServer): void;
  /** Filled into the add form, as from a link. */
  address?: string | null;
}) {
  const queryClient = useQueryClient();
  const [servers, setServers] = React.useState(savedServers);
  const [adding, setAdding] = React.useState(servers.length === 0 || !!address);
  React.useEffect(() => {
    document.title = 'AIOStreams';
  }, []);

  const [target, setTarget] = React.useState<SavedServer | null>(null);
  const confirmSignOut = useConfirmationDialog({
    title: 'Sign out',
    description: target ? `Sign out of ${target.name}?` : undefined,
    actionText: 'Sign out',
    onConfirm: () => {
      if (!target) return;
      endSession(target.base, readCredentials(target.base)?.token ?? null);
      void queryClient.invalidateQueries({
        queryKey: ['server-check', target.base],
      });
    },
  });
  const confirmForget = useConfirmationDialog({
    title: 'Remove server',
    description: target
      ? `Remove ${target.name} from this device? You will need to add it and sign in again.`
      : undefined,
    actionText: 'Remove',
    actionIntent: 'alert-subtle',
    onConfirm: () => {
      if (!target) return;
      forgetServer(target.base);
      const rest = savedServers();
      setServers(rest);
      if (!rest.length) setAdding(true);
    },
  });

  return (
    <Screen name="servers" className={adding ? undefined : 'max-w-5xl'}>
      <motion.div {...RISE}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={adding ? 'add' : 'list'} {...FADE}>
            {adding ? (
              <AddServer
                initial={address}
                onAdded={onChoose}
                onBack={servers.length ? () => setAdding(false) : undefined}
              />
            ) : (
              <ServerList
                servers={servers}
                onChoose={onChoose}
                onSignOut={(server) => {
                  setTarget(server);
                  confirmSignOut.open();
                }}
                onForget={(server) => {
                  setTarget(server);
                  confirmForget.open();
                }}
                onAdd={() => setAdding(true)}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </motion.div>
      <ConfirmationDialog {...confirmSignOut} />
      <ConfirmationDialog {...confirmForget} />
    </Screen>
  );
}
