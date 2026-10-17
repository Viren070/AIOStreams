import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
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
import {
  ConnectionError,
  JellyfinError,
  type JellyfinClient,
} from '../lib/client';
import { configureUrl } from '../lib/paths';
import { useServerInfo } from '../lib/server-info';
import type { PickableUser, QuickConnectResult, UserDto } from '../lib/types';

/** Must match the server's `PIN_REQUIRED`. */
// eslint-disable-next-line lingui/no-unlocalized-strings -- the server's word
const PIN_REQUIRED = 'PIN required';

/** Why signing in failed: the app's words where the status says, else the server's. */
function signInError(err: unknown): string {
  if (err instanceof JellyfinError && err.status === 401)
    return t`That did not match. Try again.`;
  if (err instanceof JellyfinError && err.status === 429)
    return t`Too many tries. Wait a moment, then try again.`;
  if (err instanceof ConnectionError) return t`Can't reach the server`;
  return (err as Error | undefined)?.message || t`Sign in failed`;
}

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

export const AUTH_CARD =
  'mx-auto w-full max-w-sm space-y-4 rounded-2xl border border-white/10 bg-gray-950/80 p-6 shadow-xl';

export function Screen({
  name,
  className,
  children,
}: {
  name: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-page="sign-in"
      data-name={name}
      className="relative flex min-h-screen items-center justify-center bg-[radial-gradient(ellipse_at_top,rgba(99,102,241,0.18),transparent_60%)] px-4 pb-[max(3rem,env(safe-area-inset-bottom))] pt-[max(3rem,env(safe-area-inset-top))]"
    >
      <div className={cn('w-full max-w-3xl space-y-8', className)}>
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

export type SignInLink = { label: string; onClick: () => void };

/** The ways off a sign-in screen. */
export function LinkRow({ links }: { links: (SignInLink | false | null)[] }) {
  const shown = links.filter((l): l is SignInLink => !!l);
  if (!shown.length) return null;
  return (
    <div
      data-ui="sign-in-links"
      className="flex flex-wrap justify-center gap-2"
    >
      {shown.map((link) => (
        <Button
          key={link.label}
          size="sm"
          intent="gray-subtle"
          className="rounded-full"
          onClick={link.onClick}
        >
          {link.label}
        </Button>
      ))}
    </div>
  );
}

/** What a sign-in form asks for, by what the server takes. */
function signInCopy(
  configSignIn: boolean,
  pinSignIn: boolean,
  user: boolean,
  personal: boolean
) {
  if (personal)
    return pinSignIn
      ? { help: t`Use your PIN.`, username: t`User name`, password: t`PIN` }
      : {
          help: t`Use Quick Connect, or the configuration’s password.`,
          username: t`User name`,
          password: t`Password`,
        };
  if (!configSignIn)
    return {
      help: user
        ? t`Enter your password.`
        : t`Use your user name and password.`,
      username: t`User name`,
      password: t`Password`,
    };
  const help = user
    ? pinSignIn
      ? t`Use your PIN, or the configuration’s password.`
      : t`Use the configuration’s password.`
    : pinSignIn
      ? t`Use your user name and PIN, or the configuration’s UUID and its password.`
      : t`Use your configuration’s UUID or alias and its password.`;
  return {
    help,
    username: pinSignIn ? t`User or UUID` : t`UUID or alias`,
    password: pinSignIn ? t`PIN or password` : t`Password`,
  };
}

export function SignInPage({
  onSignIn,
  defaultUsername = '',
  user,
  avatar = null,
  links = [],
  onChangeServer,
}: {
  onSignIn: (username: string, password: string) => Promise<void>;
  defaultUsername?: string;
  /** Picked from the server's list, so only their secret is asked for. */
  user?: UserDto;
  avatar?: string | null;
  links?: SignInLink[];
  onChangeServer?: () => void;
}) {
  const info = useServerInfo();
  const configSignIn = !!info.features.configSignIn;
  const copy = signInCopy(configSignIn, info.pinSignIn, !!user, info.personal);
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
      if ((err as Error).message === PIN_REQUIRED) {
        setError(pin ? t`That did not match. Try again.` : null);
        setPin('');
      } else {
        setError(signInError(err));
      }
      shake();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen name="sign-in">
      <motion.div {...RISE}>
        <form
          ref={scope}
          onSubmit={submit}
          data-ui="auth-card"
          className={AUTH_CARD}
        >
          <div className="flex flex-col items-center gap-1 text-center">
            {user && (
              <UserAvatar
                name={user.Name}
                src={avatar}
                className="mb-2 size-16 text-2xl"
              />
            )}
            <h1 data-ui="page-title" className="text-xl font-semibold">
              {user ? user.Name : t`Sign in`}
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
                  label={t`PIN`}
                  help={t`This user has a PIN.`}
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
            <Trans>Sign in</Trans>
          </Button>
          <LinkRow
            links={[
              ...links,
              !!onChangeServer && {
                label: t`Change server`,
                onClick: onChangeServer,
              },
            ]}
          />
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
    <Screen name="unreachable">
      <motion.div
        {...RISE}
        data-ui="auth-card"
        className={cn(AUTH_CARD, 'text-center')}
      >
        <h1 data-ui="page-title" className="text-xl font-semibold">
          <Trans>Can’t reach the server</Trans>
        </h1>
        <p className="text-sm text-[--muted] [overflow-wrap:anywhere]">
          <Trans>
            {address} did not answer. Check that it is running, then try again.
          </Trans>
        </p>
        <Button
          intent="white"
          className="w-full rounded-full"
          onClick={onRetry}
        >
          <Trans>Try again</Trans>
        </Button>
        <LinkRow
          links={[
            !!onChangeServer && {
              label: t`Change server`,
              onClick: onChangeServer,
            },
          ]}
        />
      </motion.div>
    </Screen>
  );
}

/** A user's picture, as a server that lists its users gives it. */
export function publicAvatar(
  client: JellyfinClient,
  user: UserDto
): string | null {
  return user.PrimaryImageTag
    ? client.url(`/Users/${user.Id}/Images/Primary`, {
        tag: user.PrimaryImageTag,
        maxWidth: 256,
      })
    : null;
}

const QUICK_CONNECT_POLL_MS = 3000;

function quickConnectError(error: Error): string {
  const { message } = error;
  return t`Quick Connect is unavailable: ${message}`;
}

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
    onApproved(secret).catch((e: unknown) => setError(signInError(e)));
  }, [approved, secret, onApproved]);

  return (
    <Screen name="quick-connect">
      <motion.div
        {...RISE}
        data-ui="auth-card"
        className={cn(AUTH_CARD, 'text-center')}
      >
        <h1 data-ui="page-title" className="text-xl font-semibold">
          <Trans>Quick Connect</Trans>
        </h1>
        <p className="text-sm text-[--muted]">
          {configureUrl(client.base, info)
            ? t`Enter this code under Quick Connect in an app already signed in, or approve it on the configuration page.`
            : t`Enter this code under Quick Connect in an app already signed in to this server.`}
        </p>
        <div className="flex h-14 items-center justify-center">
          {request.data ? (
            <span
              data-ui="quick-connect-code"
              className="select-all font-mono text-4xl font-semibold tracking-[0.3em]"
            >
              {request.data.Code}
            </span>
          ) : (
            !request.isError && <LoadingSpinner />
          )}
        </div>
        {request.data && !error && (
          <p className="text-sm text-[--muted]">
            {expired
              ? t`This code has expired.`
              : approved
                ? t`Approved. Signing in…`
                : t`Waiting for approval…`}
          </p>
        )}
        <ErrorLine
          error={
            error ?? (request.isError ? quickConnectError(request.error) : null)
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
            <Trans>New code</Trans>
          </Button>
        )}
        <LinkRow links={[{ label: t`Back`, onClick: onBack }]} />
      </motion.div>
    </Screen>
  );
}

/**
 * Signing in: the users a server lists, then a form for the one picked; typing
 * a name or Quick Connect stay a click away. A user's own address opens on them.
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
  const personal = info.personal;
  const user = typing
    ? null
    : (chosen ?? (personal && users.length === 1 ? users[0] : null));
  const quickConnectLinks: SignInLink[] = quickConnectEnabled.data
    ? [{ label: t`Quick Connect`, onClick: () => setQuickConnect(true) }]
    : [];

  if (users.length && !user && !typing) {
    return (
      <UserPicker
        users={users.map((u) => ({
          user: u,
          avatar: publicAvatar(client, u),
          needs: null,
        }))}
        onPick={async (id) => {
          const picked = users.find((u) => u.Id === id)!;
          if (picked.HasPassword) setChosen(picked);
          else await onSignIn(picked.Name ?? '', '');
        }}
        links={[
          ...(personal
            ? []
            : [{ label: t`Other user`, onClick: () => setTyping(true) }]),
          ...quickConnectLinks,
        ]}
        onChangeServer={onChangeServer}
      />
    );
  }
  const back: SignInLink[] =
    users.length && !personal
      ? [
          {
            label: t`Back`,
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
        <h1 data-ui="page-title" className="text-xl font-semibold">
          {user.user.Name}
        </h1>
        <div ref={scope} className="w-full space-y-3">
          {askPassword && (
            <PasswordInput
              label={t`Configuration password`}
              help={t`Needed to switch to this user.`}
              autoFocus
              value={password}
              onValueChange={setPassword}
            />
          )}
          {askPin && (
            <TextInput
              label={t`PIN`}
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
          <Trans>Continue</Trans>
        </Button>
        <LinkRow links={[{ label: t`Back`, onClick: onBack }]} />
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
      setError(secret ? t`That did not match. Try again.` : signInError(err));
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
    <Screen name="user-picker">
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
                  <Trans>Who&apos;s watching?</Trans>
                </motion.h1>
                <motion.div
                  data-ui="user-picker"
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
                      data-ui="user-picker-user"
                      data-focus="own"
                      className="group/user flex w-28 flex-col items-center sm:w-32"
                    >
                      <span
                        className={cn(
                          'flex w-full flex-col items-center gap-3 transition-opacity',
                          busy && busy !== u.user.Id && 'opacity-40'
                        )}
                      >
                        <span
                          data-focus-frame
                          className="relative rounded-full transition-transform group-focus-visible/user:scale-110"
                        >
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
                            <span className="absolute bottom-0 end-0 flex size-7 items-center justify-center rounded-full bg-gray-900 text-sm ring-2 ring-[--background]">
                              <BiLockAlt aria-label={t`Has a PIN`} />
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
                <LinkRow
                  links={[
                    ...links,
                    !!onChangeServer && {
                      label: t`Change server`,
                      onClick: onChangeServer,
                    },
                  ]}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </LayoutGroup>
      </div>
    </Screen>
  );
}
