import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { BiPlus, BiX } from 'react-icons/bi';
import { Button, IconButton } from '@aiostreams/ui/button';
import { TextInput } from '@aiostreams/ui/text-input';
import {
  ConfirmationDialog,
  useConfirmationDialog,
} from '@aiostreams/ui/shared/confirmation-dialog';
import { UserAvatar } from '../components/user-avatar';
import {
  findServer,
  forgetServer,
  savedServers,
  serverAddress,
  type SavedServer,
} from '../lib/servers';
import {
  AUTH_CARD,
  ErrorLine,
  FADE,
  FormLink,
  RISE,
  Screen,
  useShake,
} from './sign-in';

function AddServer({
  onAdded,
  onBack,
}: {
  onAdded(server: SavedServer): void;
  onBack?: () => void;
}) {
  const [address, setAddress] = React.useState('');
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
          The address you open the web app at, or the server&apos;s own address.
        </p>
      </div>
      <TextInput
        label="Server address"
        placeholder="https://example.com"
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
      {onBack && <FormLink onClick={onBack}>Back</FormLink>}
    </form>
  );
}

function ServerList({
  servers,
  onChoose,
  onForget,
  onAdd,
}: {
  servers: SavedServer[];
  onChoose(server: SavedServer): void;
  onForget(server: SavedServer): void;
  onAdd(): void;
}) {
  return (
    <div data-ui="auth-card" className={AUTH_CARD}>
      <h1 data-ui="page-title" className="text-center text-xl font-semibold">
        Choose a server
      </h1>
      <ul className="space-y-2">
        {servers.map((server) => (
          <li
            key={server.base}
            data-ui="server"
            className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 pr-2 transition-colors hover:bg-white/10"
          >
            <button
              type="button"
              onClick={() => onChoose(server)}
              className="flex min-w-0 flex-1 items-center gap-3 p-3 text-left"
            >
              <UserAvatar
                name={server.name}
                src={server.logo}
                className="size-10 flex-none"
              />
              <span className="min-w-0">
                <span className="block truncate font-medium">
                  {server.name}
                </span>
                <span className="block truncate text-xs text-[--muted]">
                  {serverAddress(server.base)}
                </span>
              </span>
            </button>
            <IconButton
              size="sm"
              intent="gray-subtle"
              className="size-8 flex-none rounded-full"
              icon={<BiX />}
              aria-label={`Remove ${server.name}`}
              onClick={() => onForget(server)}
            />
          </li>
        ))}
      </ul>
      <Button
        intent="gray-outline"
        className="w-full rounded-full"
        leftIcon={<BiPlus />}
        onClick={onAdd}
      >
        Add a server
      </Button>
    </div>
  );
}

export function ServersPage({
  onChoose,
}: {
  onChoose(server: SavedServer): void;
}) {
  const [servers, setServers] = React.useState(savedServers);
  const [adding, setAdding] = React.useState(servers.length === 0);
  React.useEffect(() => {
    document.title = 'AIOStreams';
  }, []);

  const [forgetting, setForgetting] = React.useState<SavedServer | null>(null);
  const confirmForget = useConfirmationDialog({
    title: 'Remove server',
    description: forgetting
      ? `Remove ${forgetting.name} from this device? You will need to add it and sign in again.`
      : undefined,
    actionText: 'Remove',
    actionIntent: 'alert-subtle',
    onConfirm: () => {
      if (!forgetting) return;
      forgetServer(forgetting.base);
      const rest = savedServers();
      setServers(rest);
      if (!rest.length) setAdding(true);
    },
  });

  return (
    <Screen>
      <motion.div {...RISE}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={adding ? 'add' : 'list'} {...FADE}>
            {adding ? (
              <AddServer
                onAdded={onChoose}
                onBack={servers.length ? () => setAdding(false) : undefined}
              />
            ) : (
              <ServerList
                servers={servers}
                onChoose={onChoose}
                onForget={(server) => {
                  setForgetting(server);
                  confirmForget.open();
                }}
                onAdd={() => setAdding(true)}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </motion.div>
      <ConfirmationDialog {...confirmForget} />
    </Screen>
  );
}
