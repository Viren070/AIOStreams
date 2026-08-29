import { APIError, ErrorCode } from '../../utils/constants.js';
import { createLogger } from '../../logging/logger.js';
import { requestJson, unexpectedResponse } from '../http.js';
import { addonUrlKey, addonUrlOf, matchInstalled } from '../matching.js';
import type {
  ConnectResult,
  LinkedAccountPlatform,
  ProbeResult,
  PushOutcome,
  PushResult,
} from '../types.js';

const logger = createLogger('linked-accounts');

const API = 'https://api.strem.io/api';

interface StremioAddon {
  transportUrl?: string;
  transportName?: string;
  manifest?: { id?: string; [k: string]: unknown };
  flags?: { official?: boolean; protected?: boolean; [k: string]: unknown };
  [k: string]: unknown;
}

interface StremioError {
  message?: string;
  code?: number;
  /** Login: no account for that email. */
  wrongEmail?: boolean;
  wrongPass?: boolean;
  /** Register: the email is already taken. */
  existingUser?: boolean;
}

interface StremioEnvelope<T> {
  result?: T | null;
  error?: StremioError | string | null;
}

async function call<T>(
  type: string,
  payload: Record<string, unknown>
): Promise<{ result?: T | null; error: StremioError | null }> {
  const path = type.charAt(0).toLowerCase() + type.slice(1);
  const response = await requestJson<StremioEnvelope<T>>(`${API}/${path}`, {
    method: 'POST',
    body: { type, ...payload },
  });
  const { status, json } = response;

  if (response.redirected || json === null) {
    throw new APIError(
      ErrorCode.BAD_REQUEST,
      502,
      unexpectedResponse(`the Stremio API (${path})`, response)
    );
  }
  if (json.error) {
    return {
      error:
        typeof json.error === 'string' ? { message: json.error } : json.error,
    };
  }
  if (status === 401 || status === 403) {
    throw new APIError(
      ErrorCode.UNAUTHORIZED,
      401,
      'Your Stremio session has expired. Link the account again.'
    );
  }
  return { result: json.result, error: null };
}

function rejected(error: StremioError): APIError {
  return new APIError(
    ErrorCode.BAD_REQUEST,
    400,
    error.message ?? 'Stremio rejected the request.'
  );
}

async function readCollection(authKey: string): Promise<StremioAddon[]> {
  const get = async () => {
    const { result, error } = await call<{ addons: StremioAddon[] | null }>(
      'AddonCollectionGet',
      { authKey }
    );
    if (error) throw rejected(error);
    return result;
  };

  const first = await get();
  if (first?.addons != null) return first.addons;

  // A null collection stays null until a Set re-initialises it, so repair it
  // once and re-read rather than treating null as "no addons".
  logger.warn('stremio returned a null addon collection, re-initialising');
  const repair = await call('AddonCollectionSet', { authKey, addons: [] });
  if (repair.error) throw rejected(repair.error);
  const second = await get();
  if (second?.addons == null) {
    throw new APIError(
      ErrorCode.BAD_REQUEST,
      502,
      'Stremio would not return your addon collection. Try again shortly.'
    );
  }
  return second.addons;
}

/**
 * Signs in, creating the account when there is none for that email. Only a
 * `wrongEmail` error means the account is missing; a wrong password must
 * surface as itself rather than turning into a doomed sign-up.
 */
async function signIn(email: string, password: string): Promise<string> {
  const login = await call<{ authKey?: string }>('Login', {
    type: 'Auth',
    email,
    password,
  });

  if (!login.error) {
    if (!login.result?.authKey) {
      throw new APIError(
        ErrorCode.BAD_REQUEST,
        400,
        'Stremio did not return a session for those details.'
      );
    }
    return login.result.authKey;
  }

  if (!login.error.wrongEmail) throw rejected(login.error);

  const registered = await call<{ authKey?: string }>('Register', {
    type: 'Auth',
    email,
    password,
  });
  // Stremio can answer "no such user" for a few seconds after a sign-up, so a
  // wrong password on a brand new account can reach here. Saying the email is
  // taken would be useless advice; the password is what was wrong.
  if (registered.error?.existingUser) {
    throw new APIError(
      ErrorCode.BAD_REQUEST,
      400,
      'That account already exists and the password was not accepted. Check the password and try again.'
    );
  }
  if (registered.error) throw rejected(registered.error);
  if (!registered.result?.authKey) {
    throw new APIError(
      ErrorCode.BAD_REQUEST,
      400,
      'Stremio did not return a session for the new account.'
    );
  }
  logger.info('created a new stremio account while linking');
  return registered.result.authKey;
}

export const stremioPlatform: LinkedAccountPlatform = {
  id: 'stremio',
  name: 'Stremio',
  kind: 'client',
  logo: 'https://raw.githubusercontent.com/Stremio/stremio-brand/refs/heads/master/logos/PNG/stremio-logo-800px.png',
  description:
    'Installs AIOStreams into your Stremio account and keeps it up to date on every device signed in to it.',
  authMethods: [
    {
      id: 'login',
      label: 'Email and password',
      note: 'If you do not have a Stremio account yet, one is created with these details.',
      fields: [
        { key: 'email', label: 'Email', type: 'email' },
        {
          key: 'password',
          label: 'Password',
          type: 'password',
          help: 'Used once to sign in. AIOStreams stores the auth key Stremio returns, which grants the same access to your account and does not expire.',
        },
      ],
    },
    {
      id: 'authKey',
      label: 'Auth key',
      fields: [
        {
          key: 'authKey',
          label: 'Auth key',
          type: 'password',
          help: 'Grants full access to your Stremio account and does not expire.',
        },
      ],
    },
  ],

  async probe(): Promise<ProbeResult> {
    return { ok: true };
  },

  async connect(input): Promise<ConnectResult> {
    const mode = String(input.mode ?? 'login');
    let authKey: string;

    if (mode === 'authKey') {
      authKey = String(input.authKey ?? '').trim();
      if (!authKey) {
        throw new APIError(
          ErrorCode.MISSING_REQUIRED_FIELDS,
          400,
          'An auth key is required.'
        );
      }
    } else {
      const email = String(input.email ?? '').trim();
      const password = String(input.password ?? '');
      if (!email || !password) {
        throw new APIError(
          ErrorCode.MISSING_REQUIRED_FIELDS,
          400,
          'An email and password are both required.'
        );
      }
      authKey = await signIn(email, password);
    }

    const { result: user, error } = await call<{ email?: string }>('GetUser', {
      authKey,
    });
    if (error) throw rejected(error);
    const identity = user?.email ?? 'Stremio account';

    return {
      credentials: { authKey },
      config: { mintedSession: mode !== 'authKey' },
      identity,
      label: `Stremio (${identity})`,
    };
  },

  async revoke(account): Promise<void> {
    if (!account.config.mintedSession) return;
    const { error } = await call('Logout', {
      authKey: account.credentials.authKey,
    });
    if (error) {
      logger.warn(
        { error: error.message },
        'could not sign out stremio session'
      );
      return;
    }
    logger.info('signed out the stremio session on unlink');
  },

  async push(account, manifests): Promise<PushResult> {
    const { authKey } = account.credentials;
    const current = await readCollection(authKey);

    const merged = current.slice();
    const outcomes: PushOutcome[] = [];
    // URL keys we rewrote or dropped on purpose, and the entries to drop.
    const claimed = new Set<string>();
    const dropped = new Set<number>();

    for (const { url, manifest } of manifests) {
      const { index, staleIndices } = matchInstalled(
        merged,
        {
          url,
          manifestId: typeof manifest.id === 'string' ? manifest.id : undefined,
        },
        (_entry, at) => !dropped.has(at)
      );

      if (index < 0) {
        merged.push({ transportUrl: url, manifest });
        outcomes.push({ url, status: 'installed' });
        continue;
      }

      const existing = merged[index];
      if (existing.flags?.protected) {
        outcomes.push({ url, status: 'unchanged' });
        continue;
      }

      // Stremio caches the manifest it was given, so the entry has to be
      // rewritten with the current one.
      claimed.add(addonUrlKey(addonUrlOf(existing)));
      merged[index] = { ...existing, transportUrl: url, manifest };
      outcomes.push({ url, status: 'refreshed' });

      // Earlier pushes of this same addon, left behind under a URL it has
      // since rotated away from. Keeping them shows the user two of it.
      for (const stale of staleIndices) {
        if (merged[stale].flags?.protected) continue;
        claimed.add(addonUrlKey(addonUrlOf(merged[stale])));
        dropped.add(stale);
      }
    }

    const next = merged.filter((_, index) => !dropped.has(index));
    assertSafeReplacement(current, next, claimed, dropped.size);

    if (outcomes.every((outcome) => outcome.status === 'unchanged')) {
      return { outcomes };
    }

    const written = await call('AddonCollectionSet', {
      authKey,
      addons: next,
    });
    if (written.error) throw rejected(written.error);
    logger.info(
      { count: next.length, pushed: manifests.length, removed: dropped.size },
      'pushed manifest to stremio'
    );
    return { outcomes };
  },
};

/**
 * `AddonCollectionSet` replaces the whole collection, so a bad read would
 * silently wipe every addon the user has. Everything that was there has to
 * still be there, bar the entries we claimed as our own.
 */
function assertSafeReplacement(
  current: StremioAddon[],
  next: StremioAddon[],
  claimed: ReadonlySet<string>,
  removed: number
): void {
  if (next.length < current.length - removed) {
    throw new APIError(
      ErrorCode.INTERNAL_SERVER_ERROR,
      500,
      'Refusing to push: the update would have removed addons from your Stremio account.'
    );
  }
  const surviving = new Set(
    next.map((addon) => addonUrlKey(addonUrlOf(addon)))
  );
  for (const addon of current) {
    const key = addonUrlKey(addonUrlOf(addon));
    if (!surviving.has(key) && !claimed.has(key)) {
      throw new APIError(
        ErrorCode.INTERNAL_SERVER_ERROR,
        500,
        'Refusing to push: the update would have dropped an addon from your Stremio account.'
      );
    }
  }
}
