import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, LayoutGroup, motion, useAnimate } from 'motion/react';
import { BiLockAlt } from 'react-icons/bi';
import { Button } from '@aiostreams/ui/button';
import { TextInput } from '@aiostreams/ui/text-input';
import { PasswordInput } from '@aiostreams/ui/password-input';
import { cn } from '@aiostreams/ui/core/styling';
import { LoadingOverlay, LoadingSpinner } from '@aiostreams/ui/loading-spinner';
import { UserAvatar } from '../components/user-avatar';
import { BrandLogo } from '../components/brand-logo';
import type { JellyfinClient } from '../lib/client';
import { configureUrl } from '../lib/paths';
import { useServerInfo } from '../lib/server-info';
import type { PickableUser, QuickConnectResult, UserDto } from '../lib/types';

/** Must match the server's `PIN_REQUIRED`. */
const PIN_REQUIRED = 'PIN required';

export const SPRING = {
  type: 'spring',
  damping: 26,
  stiffness: 300,
  mass: 0.7,
} as const;
/* Each view fades both ways, so one brought back mid-exit returns to view. */
export const FADE = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.15 },
} as const;
export const RISE = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: SPRING,
} as const;

/** A short head shake, for a rejected password or PIN. */
export function useShake<T extends HTMLElement>() {
  const [scope, animate] = useAnimate<T>();
  const shake = React.useCallback(() => {
    if (scope.current)
      void animate(
        scope.current,
        { x: [0, -10, 10, -6, 6, -2, 0] },
        { duration: 0.42 }
      );
  }, [animate, scope]);
  return [scope, shake] as const;
}

export function ErrorLine({ error }: { error: string | null }) {
  return (
    <AnimatePresence initial={false}>
      {error && (
        <motion.p
          key={error}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={SPRING}
          className="text-center text-sm text-red-300"
        >
          {error}
        </motion.p>
      )}
    </AnimatePresence>
  );
}

export function Screen({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-[radial-gradient(ellipse_at_top,rgba(99,102,241,0.18),transparent_60%)] px-4 pb-[max(3rem,env(safe-area-inset-bottom))] pt-[max(3rem,env(safe-area-inset-top))]">
      <div className="w-full max-w-3xl space-y-8">
        <motion.div
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={SPRING}
        >
          <BrandLogo className="mx-auto max-h-16 max-w-[16rem] object-contain" />
        </motion.div>
        {children}
      </div>
    </div>
  );
}

export function FormLink(props: React.ComponentPropsWithoutRef<'button'>) {
  return (
    <button
      type="button"
      className="block w-full text-center text-sm text-[--muted] hover:text-white"
      {...props}
    />
  );
}

type SignInLink = { label: string; onClick: () => void };

/** What a sign-in form asks for, by what the server takes. */
function signInCopy(configSignIn: boolean, pinSignIn: boolean, user: boolean) {
  if (!configSignIn)
    return {
      help: user ? 'Enter your password.' : 'Use your user name and password.',
      username: 'User name',
      password: 'Password',
    };
  const help = user
    ? pinSignIn
      ? 'Use your PIN, or the configuration’s password.'
      : 'Use the configuration’s password.'
    : pinSignIn
      ? 'Use your user name and PIN, or the configuration’s UUID and its password.'
      : 'Use your configuration’s UUID or alias and its password.';
  return {
    help,
    username: pinSignIn ? 'User or UUID' : 'UUID or alias',
    password: pinSignIn ? 'PIN or password' : 'Password',
  };
}

export function SignInPage({
  onSignIn,
  defaultUsername = '',
  user,
  avatar = null,
  links = [],
  configure,
  onChangeServer,
}: {
  onSignIn: (username: string, password: string) => Promise<void>;
  defaultUsername?: string;
  /** Picked from the server's list, so only their secret is asked for. */
  user?: UserDto;
  avatar?: string | null;
  links?: SignInLink[];
  configure: string | null;
  onChangeServer?: () => void;
}) {
  const info = useServerInfo();
  const configSignIn = !!info.features.configSignIn;
  const copy = signInCopy(configSignIn, info.pinSignIn, !!user);
  const [username, setUsername] = React.useState(user?.Name ?? defaultUsername);
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  // Set once the server has taken the password and wants a PIN as well.
  const [pin, setPin] = React.useState<string | null>(null);
  const [scope, shake] = useShake<HTMLFormElement>();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSignIn(
        username.trim(),
        pin === null ? password : `${password}/${pin}`
      );
    } catch (err) {
      const message = (err as Error).message;
      if (message === PIN_REQUIRED) {
        setError(pin ? 'That did not match. Try again.' : null);
        setPin('');
      } else {
        setError(message || 'Sign in failed');
      }
      shake();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <motion.div {...RISE}>
        <form
          ref={scope}
          onSubmit={submit}
          className="mx-auto w-full max-w-sm space-y-4 rounded-2xl border border-white/10 bg-gray-950/80 p-6 shadow-xl"
        >
          <div className="flex flex-col items-center gap-1 text-center">
            {user && (
              <UserAvatar
                name={user.Name}
                src={avatar}
                className="mb-2 size-16 text-2xl"
              />
            )}
            <h1 className="text-xl font-semibold">
              {user ? user.Name : 'Sign in'}
            </h1>
            <p className="text-sm text-[--muted]">{copy.help}</p>
          </div>
          {!user && (
            <TextInput
              label={copy.username}
              value={username}
              onValueChange={setUsername}
              autoComplete="username"
              autoFocus={!defaultUsername}
              required
            />
          )}
          {/* A Jellyfin account can have no password; a configuration always has one. */}
          <PasswordInput
            label={copy.password}
            autoFocus={!!user || !!defaultUsername}
            value={password}
            onValueChange={(value) => {
              setPassword(value);
              setPin(null);
            }}
            required={configSignIn}
          />
          <AnimatePresence initial={false}>
            {pin !== null && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={SPRING}
                className="overflow-hidden"
              >
                <TextInput
                  label="PIN"
                  help="This user has a PIN."
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  autoFocus
                  value={pin}
                  onValueChange={(v) =>
                    setPin(v.replace(/\D/g, '').slice(0, 12))
                  }
                />
              </motion.div>
            )}
          </AnimatePresence>
          <ErrorLine error={error} />
          <Button
            type="submit"
            intent="white"
            className="w-full rounded-full"
            loading={busy}
          >
            Sign in
          </Button>
          {links.map((link) => (
            <FormLink key={link.label} onClick={link.onClick}>
              {link.label}
            </FormLink>
          ))}
          {configure && (
            <a
              href={configure}
              target={__STANDALONE__ ? '_blank' : undefined}
              rel="noreferrer"
              className="block text-center text-sm text-[--muted] hover:text-white"
            >
              Open the configuration page
            </a>
          )}
          {onChangeServer && (
            <FormLink onClick={onChangeServer}>Change server</FormLink>
          )}
        </form>
      </motion.div>
    </Screen>
  );
}

/** A server that did not answer; trying again keeps any sign-in. */
export function Unreachable({
  address,
  onRetry,
  onChangeServer,
}: {
  address: string;
  onRetry: () => void;
  onChangeServer?: () => void;
}) {
  return (
    <Screen>
      <motion.div
        {...RISE}
        className="mx-auto w-full max-w-sm space-y-4 rounded-2xl border border-white/10 bg-gray-950/80 p-6 text-center shadow-xl"
      >
        <h1 className="text-xl font-semibold">Can’t reach the server</h1>
        <p className="text-sm text-[--muted] [overflow-wrap:anywhere]">
          {address} did not answer. Check that it is running, then try again.
        </p>
        <Button
          intent="white"
          className="w-full rounded-full"
          onClick={onRetry}
        >
          Try again
        </Button>
        {onChangeServer && (
          <FormLink onClick={onChangeServer}>Change server</FormLink>
        )}
      </motion.div>
    </Screen>
  );
}

/** A user's picture, as a server that lists its users gives it. */
function publicAvatar(client: JellyfinClient, user: UserDto): string | null {
  return user.PrimaryImageTag
    ? client.url(`/Users/${user.Id}/Images/Primary`, {
        tag: user.PrimaryImageTag,
        maxWidth: 256,
      })
    : null;
}

const QUICK_CONNECT_POLL_MS = 3000;

/** Signing in with a code that an app already signed in to the server approves. */
function QuickConnectPage({
  client,
  onApproved,
  onBack,
}: {
  client: JellyfinClient;
  onApproved: (secret: string) => Promise<void>;
  onBack: () => void;
}) {
  const info = useServerInfo();
  const [attempt, setAttempt] = React.useState(0);
  const request = useQuery({
    queryKey: ['jf-quick-connect', client.base, attempt],
    queryFn: () => client.post<QuickConnectResult>('/QuickConnect/Initiate'),
    staleTime: Infinity,
    gcTime: 0,
  });
  const secret = request.data?.Secret ?? null;
  const status = useQuery({
    queryKey: ['jf-quick-connect-status', client.base, secret],
    queryFn: () =>
      client.get<QuickConnectResult>('/QuickConnect/Connect', { secret }),
    enabled: !!secret,
    refetchInterval: (query) =>
      query.state.data?.Authenticated ? false : QUICK_CONNECT_POLL_MS,
    gcTime: 0,
  });
  const approved = !!status.data?.Authenticated;
  // The server forgets a code after a while, so asking about it fails.
  const expired = status.isError;
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!approved || !secret) return;
    onApproved(secret).catch((e: Error) =>
      setError(e.message || 'Sign in failed')
    );
  }, [approved, secret, onApproved]);

  return (
    <Screen>
      <motion.div
        {...RISE}
        className="mx-auto w-full max-w-sm space-y-4 rounded-2xl border border-white/10 bg-gray-950/80 p-6 text-center shadow-xl"
      >
        <h1 className="text-xl font-semibold">Quick Connect</h1>
        <p className="text-sm text-[--muted]">
          {configureUrl(client.base, info)
            ? 'Enter this code under Quick Connect in an app already signed in, or approve it on the configuration page.'
            : 'Enter this code under Quick Connect in an app already signed in to this server.'}
        </p>
        <div className="flex h-14 items-center justify-center">
          {request.data ? (
            <span className="select-all font-mono text-4xl font-semibold tracking-[0.3em]">
              {request.data.Code}
            </span>
          ) : (
            !request.isError && <LoadingSpinner />
          )}
        </div>
        {request.data && !error && (
          <p className="text-sm text-[--muted]">
            {expired
              ? 'This code has expired.'
              : approved
                ? 'Approved. Signing in\u2026'
                : 'Waiting for approval\u2026'}
          </p>
        )}
        <ErrorLine
          error={
            error ??
            (request.isError
              ? `Quick Connect is unavailable: ${request.error.message}`
              : null)
          }
        />
        {(expired || request.isError || error) && (
          <Button
            intent="white"
            className="w-full rounded-full"
            onClick={() => {
              setError(null);
              setAttempt((n) => n + 1);
            }}
          >
            New code
          </Button>
        )}
        <FormLink onClick={onBack}>Back</FormLink>
      </motion.div>
    </Screen>
  );
}

/**
 * Signing in: the users a server lists, when it lists more than one, then a
 * form for the one picked; typing a name or Quick Connect stay a click away.
 */
export function SignInScreen({
  client,
  defaultUsername,
  onSignIn,
  onQuickConnect,
  onChangeServer,
}: {
  /** Signed out, on the server being signed in to. */
  client: JellyfinClient;
  defaultUsername: string;
  onSignIn: (username: string, password: string) => Promise<void>;
  onQuickConnect: (secret: string) => Promise<void>;
  onChangeServer?: () => void;
}) {
  const info = useServerInfo();
  const listed = useQuery({
    queryKey: ['jf-public-users', client.base],
    queryFn: () => client.get<UserDto[]>('/Users/Public').catch(() => []),
    staleTime: 5 * 60_000,
  });
  const quickConnectEnabled = useQuery({
    queryKey: ['jf-quick-connect-enabled', client.base],
    queryFn: () =>
      client.get<boolean>('/QuickConnect/Enabled').catch(() => false),
    staleTime: 5 * 60_000,
  });
  const [chosen, setChosen] = React.useState<UserDto | null>(null);
  const [typing, setTyping] = React.useState(false);
  const [quickConnect, setQuickConnect] = React.useState(false);
  if (listed.isLoading) return <LoadingOverlay />;
  if (quickConnect)
    return (
      <QuickConnectPage
        client={client}
        onApproved={onQuickConnect}
        onBack={() => setQuickConnect(false)}
      />
    );

  const users = listed.data ?? [];
  const user = typing
    ? null
    : (chosen ?? (users.length === 1 ? users[0] : null));
  const typeInstead: SignInLink = {
    label: info.features.configSignIn
      ? 'Use a UUID instead'
      : 'Type a user name',
    onClick: () => setTyping(true),
  };
  const quickConnectLinks: SignInLink[] = quickConnectEnabled.data
    ? [{ label: 'Use Quick Connect', onClick: () => setQuickConnect(true) }]
    : [];

  if (users.length > 1 && !user && !typing) {
    return (
      <UserPicker
        users={users.map((u) => ({
          user: u,
          avatar: publicAvatar(client, u),
          hidden: false,
          needs: null,
        }))}
        onPick={async (id) => {
          const picked = users.find((u) => u.Id === id)!;
          if (picked.HasPassword) setChosen(picked);
          else await onSignIn(picked.Name ?? '', '');
        }}
        links={[typeInstead, ...quickConnectLinks]}
        onChangeServer={onChangeServer}
      />
    );
  }
  const back: SignInLink[] = user
    ? [
        users.length > 1
          ? { label: 'Choose another user', onClick: () => setChosen(null) }
          : typeInstead,
      ]
    : users.length
      ? [
          {
            label: 'Choose a user',
            onClick: () => {
              setChosen(null);
              setTyping(false);
            },
          },
        ]
      : [];
  return (
    <SignInPage
      key={user?.Id ?? 'typed'}
      onSignIn={onSignIn}
      defaultUsername={defaultUsername}
      user={user ?? undefined}
      avatar={user && publicAvatar(client, user)}
      links={[...back, ...quickConnectLinks]}
      configure={configureUrl(client.base, info)}
      onChangeServer={onChangeServer}
    />
  );
}

/** Shared between the picker and the prompt, so one grows into the other. */
function SharedAvatar({
  user,
  className,
}: {
  user: PickableUser;
  className?: string;
}) {
  return (
    <motion.span
      layoutId={`avatar-${user.user.Id}`}
      transition={SPRING}
      className="block rounded-full"
    >
      <UserAvatar
        name={user.user.Name}
        src={user.avatar}
        className={className}
      />
    </motion.span>
  );
}

function SecretPrompt({
  user,
  busy,
  error,
  onSubmit,
  onBack,
}: {
  user: PickableUser;
  busy: boolean;
  error: string | null;
  onSubmit(secret: string): Promise<boolean>;
  onBack(): void;
}) {
  const askPassword = user.needs !== 'pin';
  const askPin = user.needs === 'pin' || user.needs === 'password-pin';
  const [password, setPassword] = React.useState('');
  const [pin, setPin] = React.useState('');
  const [scope, shake] = useShake<HTMLDivElement>();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const secret =
      askPassword && askPin ? `${password}/${pin}` : askPin ? pin : password;
    if (await onSubmit(secret)) return;
    setPassword('');
    setPin('');
    shake();
  };

  return (
    <form
      onSubmit={submit}
      className="mx-auto flex w-full max-w-xs flex-col items-center gap-4"
    >
      <SharedAvatar user={user} className="size-28 text-4xl sm:size-32" />
      <motion.div
        className="flex w-full flex-col items-center gap-4"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={{ ...SPRING, delay: 0.05 }}
      >
        <h1 className="text-xl font-semibold">{user.user.Name}</h1>
        <div ref={scope} className="w-full space-y-3">
          {askPassword && (
            <PasswordInput
              label="Configuration password"
              help="Needed to switch to this user."
              autoFocus
              value={password}
              onValueChange={setPassword}
            />
          )}
          {askPin && (
            <TextInput
              label="PIN"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              autoFocus={!askPassword}
              value={pin}
              onValueChange={(v) => setPin(v.replace(/\D/g, '').slice(0, 12))}
            />
          )}
        </div>
        <ErrorLine error={error} />
        <Button
          type="submit"
          intent="white"
          className="w-full rounded-full"
          loading={busy}
          disabled={(askPassword && !password) || (askPin && pin.length < 4)}
        >
          Continue
        </Button>
        <FormLink onClick={onBack}>Back</FormLink>
      </motion.div>
    </form>
  );
}

/** One card per user, the way a Jellyfin sign-in page lists them. */
export function UserPicker({
  users,
  onPick,
  links = [],
  onChangeServer,
}: {
  users: PickableUser[];
  onPick: (userId: string, secret?: string) => Promise<void>;
  links?: SignInLink[];
  onChangeServer?: () => void;
}) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  // A lone user that needs a secret opens straight on its prompt.
  const [asking, setAsking] = React.useState<PickableUser | null>(
    users.length === 1 && users[0].needs ? users[0] : null
  );

  const pick = async (userId: string, secret?: string) => {
    setBusy(userId);
    setError(null);
    try {
      await onPick(userId, secret);
      return true;
    } catch (err) {
      setError(
        secret ? 'That did not match. Try again.' : (err as Error).message
      );
      setBusy(null);
      return false;
    }
  };

  const choose = (u: PickableUser) => {
    setError(null);
    if (u.needs) setAsking(u);
    else void pick(u.user.Id!);
  };

  return (
    <Screen>
      {/* Takes the column's spacing, which a popped-out view would carry along. */}
      <div>
        <LayoutGroup>
          <AnimatePresence mode="popLayout" initial={false}>
            {asking ? (
              <motion.div key={`prompt-${asking.user.Id}`} {...FADE}>
                <SecretPrompt
                  user={asking}
                  busy={!!busy}
                  error={error}
                  onSubmit={(secret) => pick(asking.user.Id!, secret)}
                  onBack={() => {
                    setAsking(null);
                    setError(null);
                  }}
                />
              </motion.div>
            ) : (
              <motion.div key="grid" className="space-y-8" {...FADE}>
                <motion.h1
                  className="text-center text-2xl font-semibold"
                  {...RISE}
                >
                  Who&apos;s watching?
                </motion.h1>
                <motion.div
                  className="flex flex-wrap justify-center gap-6"
                  initial="hidden"
                  animate="shown"
                  variants={{
                    shown: { transition: { staggerChildren: 0.05 } },
                  }}
                >
                  {users.map((u) => (
                    <motion.button
                      key={u.user.Id}
                      type="button"
                      disabled={!!busy}
                      onClick={() => choose(u)}
                      variants={{
                        hidden: { opacity: 0, y: 14, scale: 0.96 },
                        shown: { opacity: 1, y: 0, scale: 1 },
                      }}
                      transition={SPRING}
                      whileTap={busy ? undefined : { scale: 0.96 }}
                      className="group/user flex w-28 flex-col items-center sm:w-32"
                    >
                      <span
                        className={cn(
                          'flex w-full flex-col items-center gap-3 transition-opacity',
                          u.hidden && 'opacity-60',
                          busy && busy !== u.user.Id && 'opacity-40'
                        )}
                      >
                        <span className="relative">
                          <SharedAvatar
                            user={u}
                            className={cn(
                              'size-24 text-3xl ring-2 ring-transparent transition group-hover/user:ring-white sm:size-28',
                              busy === u.user.Id &&
                                'animate-pulse ring-brand-400'
                            )}
                          />
                          {(u.needs === 'pin' ||
                            u.needs === 'password-pin') && (
                            <span className="absolute bottom-0 right-0 flex size-7 items-center justify-center rounded-full bg-gray-900 text-sm ring-2 ring-[--background]">
                              <BiLockAlt aria-label="Has a PIN" />
                            </span>
                          )}
                        </span>
                        <span className="w-full truncate text-center text-sm font-medium">
                          {u.user.Name}
                        </span>
                      </span>
                    </motion.button>
                  ))}
                </motion.div>
                <ErrorLine error={error} />
                {links.map((link) => (
                  <FormLink key={link.label} onClick={link.onClick}>
                    {link.label}
                  </FormLink>
                ))}
                {onChangeServer && (
                  <FormLink onClick={onChangeServer}>Change server</FormLink>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </LayoutGroup>
      </div>
    </Screen>
  );
}
