/*
 * An invite is a relay and a code. The code is the party's secret: its id on
 * the relay and the key to what members say are both derived from it, so the
 * relay holds neither the code nor what it opens.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CODE_LENGTH = 10;

export interface Invite {
  relay: string;
  code: string;
}

export function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes, (b) => ALPHABET[b & 31]).join('');
}

/** Reads a code as typed: any case, with dashes or spaces, and O, I and L as the digits they look like. */
export function normaliseCode(input: string): string | null {
  const code = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (code.length !== CODE_LENGTH) return null;
  return [...code].every((c) => ALPHABET.includes(c)) ? code : null;
}

export const formatCode = (code: string) =>
  `${code.slice(0, 5)}-${code.slice(5)}`;

/**
 * A relay's address as typed or linked: its server, which may sit under a
 * path, without anything after it (the relay's own path or a media server's).
 */
export function relayBase(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const path = url.pathname.replace(/\/(party|jellyfin)(\/.*)?$/i, '');
    return `${url.origin}${path.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

export const inviteLink = ({ relay, code }: Invite) =>
  `${relay}/party/join#${code}`;

export const appInviteLink = ({ relay, code }: Invite) =>
  `aiostreams://party?relay=${encodeURIComponent(relay)}&code=${code}`;

/** An invite link, the app's own link, or a bare code for the relay given. */
export function parseInvite(
  text: string,
  relay?: string | null
): Invite | null {
  const trimmed = text.trim();
  // Windows opens the app with `party/?`.
  const app = /^aiostreams:\/\/party\/?\?(.*)$/i.exec(trimmed);
  if (app) {
    const params = new URLSearchParams(app[1]);
    const from = relayBase(params.get('relay') ?? '');
    const code = normaliseCode(params.get('code') ?? '');
    return from && code ? { relay: from, code } : null;
  }
  const link = /^(https?:\/\/[^#]+?)\/party\/join\/?#(.+)$/i.exec(trimmed);
  if (link) {
    const from = relayBase(link[1]);
    const code = normaliseCode(link[2]);
    return from && code ? { relay: from, code } : null;
  }
  const code = normaliseCode(trimmed);
  return code && relay ? { relay, code } : null;
}
