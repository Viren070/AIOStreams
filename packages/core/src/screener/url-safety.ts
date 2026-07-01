import net from 'node:net';

/**
 * True if a remote list URL points at a loopback/private/link-local target, so a
 * subscription (or a redirect it follows) can't make the server fetch internal
 * resources. Covers literal IPs and localhost; hostnames that resolve to private
 * space are out of scope (operator-configured, admin-gated route).
 */
export function isUnsafeRemoteUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return true;
  }
  // Fail closed on anything that isn't plain http(s): file:, data:, gopher:, etc.
  // carry no host to range-check and must never be fetched server-side (a redirect
  // could otherwise bounce a fetch onto one).
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true;
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  const kind = net.isIP(host);
  if (kind === 4) {
    const [a, b] = host.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (kind === 6) {
    return (
      host === '::1' ||
      host === '::' ||
      /^fe[89ab]/i.test(host) || // fe80::/10 link-local
      host.startsWith('fc') ||
      host.startsWith('fd') ||
      host.startsWith('::ffff:')
    );
  }
  return false;
}
