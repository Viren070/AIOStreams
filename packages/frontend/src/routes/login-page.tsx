import React from 'react';
import { TextInput } from '@/components/ui/text-input';
import { PasswordInput } from '@/components/ui/password-input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { login, APIError } from '@/lib/api';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { sessionQuery } from '@/lib/queries';
import { useStatus } from '@/context/status';

/**
 * Sanitises a `?next=` redirect target. Only same-origin absolute paths are
 * accepted (must start with a single `/`); everything else falls back to
 * `/dashboard/`. Exported so the router's login `beforeLoad` can honour the
 * same value when a session already exists (otherwise a Stremio-style deeplink
 * → /login → already-logged-in flow loses `next` and lands on /dashboard).
 */
export function safeNext(raw: string | null | undefined): string {
  if (!raw) return '/dashboard/';
  try {
    const decoded = decodeURIComponent(raw);
    // Browsers normalise `\` to `/`, so `/\host` is protocol-relative too.
    if (
      decoded.startsWith('/') &&
      !decoded.startsWith('//') &&
      !decoded.startsWith('/\\')
    ) {
      return decoded;
    }
  } catch {
    // ignore
  }
  return '/dashboard/';
}

/** Login failures arriving as `?error=`, including every OIDC refusal reason. */
const LOGIN_ERRORS: Record<string, { title: string; description?: string }> = {
  forbidden: {
    title: 'Your account does not have admin access.',
    description: 'Sign in with an admin account to continue.',
  },
  oidc_disabled: { title: 'SSO login is not enabled on this instance.' },
  oidc_not_configured: {
    title: 'SSO is not fully configured.',
    description: 'The instance owner needs to set the issuer and client ID.',
  },
  oidc_discovery_failed: {
    title: 'Could not reach the SSO provider.',
    description: 'It may be down or the issuer URL may be wrong.',
  },
  oidc_state_invalid: {
    title: 'That login attempt expired.',
    description: 'Please try signing in again.',
  },
  oidc_denied: {
    title: 'The SSO provider denied the login request.',
  },
  oidc_exchange_failed: {
    title: 'The SSO provider rejected the login.',
    description: 'Check the client ID, secret, and redirect URI.',
  },
  oidc_claims_invalid: {
    title: 'The SSO provider did not return the expected user details.',
    description: 'Check the configured username claim.',
  },
  oidc_username_conflict: {
    title: 'That SSO username collides with a local account.',
    description: 'The instance owner needs to set an SSO username prefix.',
  },
  oidc_no_permissions: {
    title: 'Your account is not mapped to any permissions.',
    description: 'Ask the instance owner to map one of your groups.',
  },
};

export function LoginPage() {
  const qc = useQueryClient();
  const { status } = useStatus();
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');

  const params = new URLSearchParams(window.location.search);

  const initialError = React.useRef(params.get('error')).current;

  const oidc = status?.settings.oidc;
  const localLoginEnabled = oidc?.localLoginEnabled !== false;
  const ssoStartUrl = `/api/v1/auth/oidc/start?next=${encodeURIComponent(
    safeNext(params.get('next'))
  )}`;

  React.useEffect(() => {
    const entry = initialError ? LOGIN_ERRORS[initialError] : undefined;
    if (entry) {
      toast.error(entry.title, { description: entry.description });
      params.delete('error');
      const search = params.toString();
      window.history.replaceState(
        null,
        '',
        search ? `?${search}` : window.location.pathname
      );
    }
  }, []);

  // `?local=1` is the documented recovery path. Skipping when the navigation
  // carried an error stops a refused user bouncing back to the provider forever.
  React.useEffect(() => {
    if (!oidc?.enabled || !oidc.autoRedirect) return;
    if (params.has('local') || initialError) return;
    window.location.assign(ssoStartUrl);
  }, [oidc?.enabled, oidc?.autoRedirect]);

  const { mutate, isPending } = useMutation({
    mutationFn: ({
      username,
      password,
    }: {
      username: string;
      password: string;
    }) => login(username, password),
    onSuccess: (user) => {
      qc.setQueryData(sessionQuery.queryKey, user);
      const params = new URLSearchParams(window.location.search);
      window.location.href = safeNext(params.get('next'));
    },
    onError: (err) => {
      if (err instanceof APIError && err.is('UNAUTHORIZED')) {
        toast.error('Invalid username or password');
      } else if (err instanceof APIError && err.is('RATE_LIMIT_EXCEEDED')) {
        toast.error('Too many attempts. Please try again later.');
      } else {
        toast.error(err instanceof Error ? err.message : 'Failed to log in');
      }
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;
    mutate({ username, password });
  };

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <Card className="w-full max-w-sm p-6">
        <div className="flex flex-col items-center gap-2 mb-6">
          <img
            src="/logo.png"
            alt="AIOStreams"
            className="max-h-[60px] object-contain"
          />
          <h1 className="text-xl font-semibold">Sign in</h1>
          <p className="text-sm text-[--muted] text-center">
            Log in to access this AIOStreams instance.
          </p>
        </div>
        {oidc?.enabled && (
          <div className="flex flex-col gap-4 mb-4">
            {/* Navigation rather than fetch: this 302s cross-origin, and the
                state cookie has to be set by a document request. */}
            <Button
              intent="primary-outline"
              className="w-full"
              onClick={() => window.location.assign(ssoStartUrl)}
            >
              {oidc.buttonLabel}
            </Button>
            {localLoginEnabled && (
              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-[--border]" />
                <span className="text-xs text-[--muted]">or</span>
                <span className="h-px flex-1 bg-[--border]" />
              </div>
            )}
          </div>
        )}
        {localLoginEnabled && (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <p className="text-xs text-[--muted] text-center">
              Use the login details provided by the instance administrator.
            </p>
            <TextInput
              label="Username"
              id="username"
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              required
              autoFocus
              placeholder="Enter your username"
              onValueChange={setUsername}
            />
            <PasswordInput
              label="Password"
              id="password"
              name="password"
              value={password}
              required
              placeholder="Enter your password"
              onValueChange={setPassword}
            />
            <Button
              type="submit"
              intent="primary"
              loading={isPending}
              disabled={isPending}
              className="w-full"
            >
              Sign in
            </Button>
          </form>
        )}
      </Card>
    </main>
  );
}
