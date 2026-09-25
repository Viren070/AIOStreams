import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { configSessionToken, hasConfigSessionCookie } from './config-session';
import { JellyfinClient, JellyfinError } from './client';
import {
  clearCredentials,
  readCredentials,
  saveCredentials,
  signedOut,
} from './credentials';
import { storage } from './storage';
import { syncPreferences } from './settings';
import type {
  AuthenticationResult,
  Branding,
  PickableUser,
  UserDto,
} from './types';

interface SessionValue {
  client: JellyfinClient;
  user: UserDto;
  /** A client acting as another user of the configuration. */
  clientFor(userId: string): Promise<JellyfinClient>;
  switchUser(): void;
  signOut(): void;
  /** Only in the standalone build. */
  changeServer?: () => void;
}

const SessionContext = React.createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const value = React.useContext(SessionContext);
  if (!value) throw new Error('useSession must be used within a session');
  return value;
}

export type SessionPhase =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  /** Signed in, but the server did not answer; nothing is forgotten. */
  | { kind: 'unreachable' }
  /** Each user says what picking it asks for. */
  | {
      kind: 'picking';
      /** Whatever can already speak for the configuration, for its branding. */
      client: JellyfinClient;
      branding?: Branding;
      users: PickableUser[];
      choose(userId: string, secret?: string): Promise<void>;
    }
  | { kind: 'ready'; client: JellyfinClient; user: UserDto };

const lastUserKey = (base: string) => `aiostreams-web-last-user:${base}`;

/** The configuration page's hand-off, which asks first when the account has a PIN. */
type WebTokenResult =
  | AuthenticationResult
  | {
      needsPin: true;
      User: UserDto;
      avatar: string | null;
      branding: Branding;
    };

/** The uuid a `/jellyfin/<uuid>/<encrypted password>` picker address names. */
export function pickerUuid(base: string): string {
  const parts = new URL(base).pathname.split('/').filter(Boolean);
  return parts.length >= 3 ? parts[1] : '';
}

/**
 * Signs in the way jellyfin-web does, then lets a configuration with several
 * users pick one.
 */
export function useSessionPhase(base: string) {
  const queryClient = useQueryClient();
  const [phase, setPhase] = React.useState<SessionPhase>({ kind: 'loading' });

  const adopt = React.useCallback(
    (proof: JellyfinClient, auth: AuthenticationResult) => {
      const user = auth.User!;
      saveCredentials(base, {
        serverId: auth.ServerId ?? '',
        token: auth.AccessToken!,
        userId: user.Id!,
      });
      storage.set(lastUserKey(base), user.Id);
      setPhase({
        kind: 'ready',
        client: proof.withToken(auth.AccessToken!),
        user,
      });
    },
    [base]
  );

  const switchTo = React.useCallback(
    async (proof: JellyfinClient, userId: string, secret?: string) => {
      const auth = await proof.post<AuthenticationResult>('/AIOStreams/Token', {
        UserId: userId,
        ...(secret ? { Pw: secret } : {}),
      });
      queryClient.removeQueries({ queryKey: ['jf'] });
      adopt(proof, auth);
    },
    [adopt, queryClient]
  );

  /** Takes the only user or the last one used, and asks otherwise. */
  const enter = React.useCallback(
    async (proof: JellyfinClient, signedIn?: AuthenticationResult) => {
      const users = await proof
        .get<PickableUser[]>('/AIOStreams/Users')
        .catch((error: unknown) => {
          // A server without the user picker has signed in the only user.
          if (signedIn && error instanceof JellyfinError) return null;
          throw error;
        });
      if (!users) return adopt(proof, signedIn!);
      const last = storage.get<string>(lastUserKey(base));
      const target =
        users.length === 1 ? users[0] : users.find((u) => u.user.Id === last);
      if (!target || target.needs) {
        setPhase({
          kind: 'picking',
          client: proof,
          users,
          choose: (id, secret) => switchTo(proof, id, secret),
        });
      } else if (signedIn && signedIn.User?.Id === target.user.Id) {
        adopt(proof, signedIn);
      } else {
        await switchTo(proof, target.user.Id!);
      }
    },
    [adopt, base, switchTo]
  );

  const [attempt, setAttempt] = React.useState(0);
  const retry = React.useCallback(() => {
    setPhase({ kind: 'loading' });
    setAttempt((n) => n + 1);
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    const anonymous = new JellyfinClient(base);
    const run = async () => {
      const stored = readCredentials(base);
      if (stored) {
        const client = anonymous.withToken(stored.token);
        const me = await client.get<UserDto>('/Users/Me').then(
          (user) => ({ user }),
          (error: unknown) => ({ error })
        );
        if ('user' in me) {
          if (!cancelled) setPhase({ kind: 'ready', client, user: me.user });
          return;
        }
        if (!isUnauthorized(me.error)) {
          if (!cancelled) setPhase({ kind: 'unreachable' });
          return;
        }
      }
      if (!__STANDALONE__ && hasConfigSessionCookie() && !signedOut(base)) {
        const auth = await configSessionToken<WebTokenResult>().catch(
          () => null
        );
        if (auth && 'needsPin' in auth) {
          if (!cancelled)
            setPhase({
              kind: 'picking',
              client: anonymous,
              branding: auth.branding,
              users: [
                {
                  user: auth.User,
                  avatar: auth.avatar,
                  hidden: false,
                  needs: 'pin',
                },
              ],
              choose: async (_id, pin) => {
                const signedIn = await configSessionToken<AuthenticationResult>(
                  { pin: pin ?? '' }
                );
                await enter(
                  anonymous.withToken(signedIn.AccessToken!),
                  signedIn
                );
              },
            });
          return;
        }
        if (auth?.AccessToken) {
          if (!cancelled)
            await enter(anonymous.withToken(auth.AccessToken), auth);
          return;
        }
      }
      if (!cancelled) setPhase({ kind: 'signed-out' });
    };
    run().catch(() => {
      if (!cancelled) setPhase({ kind: 'signed-out' });
    });
    return () => {
      cancelled = true;
    };
  }, [base, enter, attempt]);

  const signIn = React.useCallback(
    async (username: string, password: string) => {
      const auth = await new JellyfinClient(base).post<AuthenticationResult>(
        '/Users/AuthenticateByName',
        { Username: username, Pw: password }
      );
      const proof = new JellyfinClient(base, auth.AccessToken ?? null);
      // A name that carries or is a user signs in as that user.
      const named =
        username.toLowerCase() === (auth.User?.Name ?? '').toLowerCase();
      if (username.includes('/') || named) adopt(proof, auth);
      else await enter(proof, auth);
    },
    [adopt, base, enter]
  );

  /** Signs in as the user the approving app chose. */
  const signInWithQuickConnect = React.useCallback(
    async (secret: string) => {
      const auth = await new JellyfinClient(base).post<AuthenticationResult>(
        '/Users/AuthenticateWithQuickConnect',
        { Secret: secret }
      );
      adopt(new JellyfinClient(base, auth.AccessToken ?? null), auth);
    },
    [adopt, base]
  );

  const switchUser = React.useCallback(async () => {
    if (phase.kind !== 'ready') return;
    const proof = phase.client;
    const users = await proof.get<PickableUser[]>('/AIOStreams/Users');
    setPhase({
      kind: 'picking',
      client: proof,
      users,
      choose: (id, secret) => switchTo(proof, id, secret),
    });
  }, [phase, switchTo]);

  const signOut = React.useCallback(() => {
    if (phase.kind === 'ready') {
      void phase.client.post('/Sessions/Logout').catch(() => undefined);
    }
    clearCredentials(base);
    storage.remove(lastUserKey(base));
    queryClient.removeQueries({ queryKey: ['jf'] });
    setPhase({ kind: 'signed-out' });
  }, [base, phase, queryClient]);

  // A token the server stops taking ends the session, rather than failing every page.
  React.useEffect(() => {
    if (phase.kind !== 'ready') return;
    return queryClient.getQueryCache().subscribe((event) => {
      if (
        event.type === 'updated' &&
        event.action.type === 'error' &&
        isUnauthorized(event.action.error)
      )
        signOut();
    });
  }, [phase.kind, queryClient, signOut]);

  return {
    base,
    phase,
    signIn,
    signInWithQuickConnect,
    switchUser,
    signOut,
    retry,
  };
}

export function SessionProvider({
  client,
  user,
  switchUser,
  signOut,
  changeServer,
  children,
}: {
  client: JellyfinClient;
  user: UserDto;
  switchUser: () => void;
  signOut: () => void;
  changeServer?: () => void;
  children: React.ReactNode;
}) {
  const others = React.useRef(new Map<string, Promise<JellyfinClient>>());
  React.useEffect(() => others.current.clear(), [client]);
  React.useEffect(() => syncPreferences(client, user.Id!), [client, user.Id]);

  const clientFor = React.useCallback(
    (userId: string) => {
      if (userId === user.Id) return Promise.resolve(client);
      let pending = others.current.get(userId);
      if (!pending) {
        pending = client
          .post<AuthenticationResult>('/AIOStreams/Token', { UserId: userId })
          .then((auth) => client.withToken(auth.AccessToken!));
        pending.catch(() => others.current.delete(userId));
        others.current.set(userId, pending);
      }
      return pending;
    },
    [client, user.Id]
  );

  const value = React.useMemo(
    () => ({ client, user, clientFor, switchUser, signOut, changeServer }),
    [client, user, clientFor, switchUser, signOut, changeServer]
  );
  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof JellyfinError && error.status === 401;
}
