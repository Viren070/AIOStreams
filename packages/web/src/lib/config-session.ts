/** Set by AIOStreams' configure page while a configuration is signed in there. */
export function hasConfigSessionCookie(): boolean {
  return document.cookie
    .split(';')
    .some((part) => part.trim().startsWith('aiostreams.has-config-session='));
}

/** Trades the configure page's sign-in for a token. */
export async function configSessionToken<T>(body?: {
  pin: string;
}): Promise<T> {
  const response = await fetch('/api/v1/jellyfin/web/token', {
    method: 'POST',
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await response.json()) as {
    success: boolean;
    data?: T;
    error?: { message?: string };
  };
  if (!json.success) throw new Error(json.error?.message ?? 'Sign in failed');
  return json.data as T;
}
