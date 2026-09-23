import React from 'react';
import { AnimatePresence, LayoutGroup, motion, useAnimate } from 'motion/react';
import { BiLockAlt } from 'react-icons/bi';
import { Button } from '@/components/ui/button';
import { TextInput } from '@/components/ui/text-input';
import { PasswordInput } from '@/components/ui/password-input';
import { cn } from '@/components/ui/core/styling';
import { UserAvatar } from '../components/user-avatar';
import { BrandLogo } from '../components/brand-logo';
import type { PickableUser } from '../lib/types';

/** Must match the server's `PIN_REQUIRED`. */
const PIN_REQUIRED = 'PIN required';

const SPRING = {
  type: 'spring',
  damping: 26,
  stiffness: 300,
  mass: 0.7,
} as const;
/* Each view fades both ways, so one brought back mid-exit returns to view. */
const FADE = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.15 },
} as const;
const RISE = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: SPRING,
} as const;

/** A short head shake, for a rejected password or PIN. */
function useShake<T extends HTMLElement>() {
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

function ErrorLine({ error }: { error: string | null }) {
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

function Screen({ children }: { children: React.ReactNode }) {
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

export function SignInPage({
  onSignIn,
  defaultUsername = '',
}: {
  onSignIn: (username: string, password: string) => Promise<void>;
  defaultUsername?: string;
}) {
  const [username, setUsername] = React.useState(defaultUsername);
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
          <div className="space-y-1 text-center">
            <h1 className="text-xl font-semibold">Sign in</h1>
            <p className="text-sm text-[--muted]">
              Use your configuration&apos;s UUID or alias and its password.
            </p>
          </div>
          <TextInput
            label="UUID or alias"
            value={username}
            onValueChange={setUsername}
            autoComplete="username"
            autoFocus={!defaultUsername}
            required
          />
          <PasswordInput
            label="Password"
            autoFocus={!!defaultUsername}
            value={password}
            onValueChange={(value) => {
              setPassword(value);
              setPin(null);
            }}
            required
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
          <a
            href="/stremio/configure"
            className="block text-center text-sm text-[--muted] hover:text-white"
          >
            Open the configuration page
          </a>
        </form>
      </motion.div>
    </Screen>
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
  const pin = user.needs === 'pin';
  const [secret, setSecret] = React.useState('');
  const [scope, shake] = useShake<HTMLDivElement>();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await onSubmit(secret)) return;
    setSecret('');
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
        <div ref={scope} className="w-full">
          {pin ? (
            <TextInput
              label="PIN"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              autoFocus
              value={secret}
              onValueChange={(v) =>
                setSecret(v.replace(/\D/g, '').slice(0, 12))
              }
            />
          ) : (
            <PasswordInput
              label="Configuration password"
              help="Needed to switch to the primary user."
              autoFocus
              value={secret}
              onValueChange={setSecret}
            />
          )}
        </div>
        <ErrorLine error={error} />
        <Button
          type="submit"
          intent="white"
          className="w-full rounded-full"
          loading={busy}
          disabled={pin ? secret.length < 4 : !secret}
        >
          Continue
        </Button>
        <button
          type="button"
          className="text-sm text-[--muted] hover:text-white"
          onClick={onBack}
        >
          Back
        </button>
      </motion.div>
    </form>
  );
}

/** One card per user, the way a Jellyfin sign-in page lists them. */
export function UserPicker({
  users,
  onPick,
}: {
  users: PickableUser[];
  onPick: (userId: string, secret?: string) => Promise<void>;
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
                          {u.needs === 'pin' && (
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
              </motion.div>
            )}
          </AnimatePresence>
        </LayoutGroup>
      </div>
    </Screen>
  );
}
