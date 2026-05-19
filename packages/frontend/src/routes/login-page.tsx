import React from 'react';
import { TextInput } from '@/components/ui/text-input';
import { PasswordInput } from '@/components/ui/password-input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { login, APIError } from '@/lib/api';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { sessionQuery } from '@/lib/queries';

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
    if (decoded.startsWith('/') && !decoded.startsWith('//')) {
      return decoded;
    }
  } catch {
    // ignore
  }
  return '/dashboard/';
}

export function LoginPage() {
  const qc = useQueryClient();
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');

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
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <TextInput
            label="Username"
            value={username}
            required
            autoFocus
            placeholder="Enter your username"
            onValueChange={setUsername}
          />
          <PasswordInput
            label="Password"
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
      </Card>
    </main>
  );
}
