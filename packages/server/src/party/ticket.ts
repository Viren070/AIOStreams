import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { config as appConfig } from '@aiostreams/core';

/*
 * A party's ticket lets its members bring it back after the relay restarts,
 * which keeps nothing. Only a ticket this relay signed passes, so nobody starts
 * a party by claiming to resume one. The host's ticket makes it host again.
 */

type Role = 'party' | 'host';

let key: Buffer | undefined;
const keyOf = () =>
  (key ??= createHash('sha256')
    .update(`party-ticket:${appConfig.bootstrap.secretKey}`)
    .digest());

const mac = (role: Role, party: string, expires: string) =>
  createHmac('sha256', keyOf())
    .update(`${role}.${party}.${expires}`)
    .digest()
    .subarray(0, 16);

export function ticketFor(
  party: string,
  expiresAt: number,
  role: Role = 'party'
): string {
  const expires = expiresAt.toString(36);
  return `${expires}.${mac(role, party, expires).toString('base64url')}`;
}

/** When the ticket's party expires, or null when it isn't this relay's. */
export function ticketExpiry(
  party: string,
  ticket: string,
  role: Role = 'party'
): number | null {
  const [expires, signature] = ticket.split('.');
  if (!expires || !signature) return null;
  const given = Buffer.from(signature, 'base64url');
  const wanted = mac(role, party, expires);
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted))
    return null;
  const at = parseInt(expires, 36);
  return Number.isFinite(at) && at > Date.now() ? at : null;
}
