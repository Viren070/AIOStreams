import type { Request, Response } from 'express';
import {
  APIError,
  ConfigSessionRepository,
  constants,
  decryptString,
  isEncrypted,
} from '@aiostreams/core';
import {
  clearConfigSessionCookie,
  readConfigSessionToken,
  setConfigSessionCookie,
} from '../middlewares/auth.js';

export interface BasicAuthCredentials {
  uuid: string;
  password: string;
}

/**
 * Parse an `Authorization: Basic base64(uuid:password)` header.
 *
 * Returns `null` when the header is absent. Throws `APIError(BAD_REQUEST)` when
 * the header is present but malformed, and `APIError(ENCRYPTION_ERROR)` when
 * the password is an encrypted token that fails to decrypt.
 *
 * If `password` is an encrypted token (as produced by the server when issuing
 * user credentials), it is transparently decrypted so callers always receive
 * the plaintext password.
 */
export function parseBasicAuthHeader(
  req: Request,
  opts?: { allowEncrypted?: boolean }
): BasicAuthCredentials | null {
  const allowEncrypted = opts?.allowEncrypted ?? true;
  const header = req.headers['authorization'];
  if (typeof header !== 'string' || header.length === 0) {
    return null;
  }

  if (!header.startsWith('Basic ')) {
    throw new APIError(
      constants.ErrorCode.BAD_REQUEST,
      undefined,
      `Invalid Authorization header: expected 'Basic <base64>'`
    );
  }

  const base64 = header.slice('Basic '.length).trim();
  let credentials: string;
  try {
    credentials = Buffer.from(base64, 'base64').toString('utf-8');
  } catch (error: any) {
    throw new APIError(
      constants.ErrorCode.BAD_REQUEST,
      undefined,
      `Invalid Authorization header: ${error?.message ?? 'malformed base64'}`
    );
  }

  const sepIndex = credentials.indexOf(':');
  if (sepIndex === -1) {
    throw new APIError(
      constants.ErrorCode.BAD_REQUEST,
      undefined,
      `Invalid basic auth format: expected 'uuid:password'`
    );
  }

  const uuid = credentials.slice(0, sepIndex);
  let password = credentials.slice(sepIndex + 1);

  if (!uuid || !password) {
    throw new APIError(
      constants.ErrorCode.BAD_REQUEST,
      undefined,
      `Missing username or password in basic auth`
    );
  }

  if (isEncrypted(password)) {
    if (!allowEncrypted) {
      throw new APIError(
        constants.ErrorCode.UNAUTHORIZED,
        undefined,
        'Encrypted password is not accepted here; use your raw password'
      );
    }
    const { success, data, error } = decryptString(password);
    if (!success) {
      throw new APIError(
        constants.ErrorCode.ENCRYPTION_ERROR,
        undefined,
        error
      );
    }
    password = data;
  }

  return { uuid, password };
}

/**
 * The `Authorization` header if present, a remembered sign-in cookie otherwise.
 * Saving a configuration is what a session is for. Changing the password or
 * deleting the configuration must pass `allowSession: false` so a stolen cookie
 * cannot do either without the password itself.
 */
export async function resolveConfigCredentials(
  req: Request,
  res?: Response,
  opts?: { allowEncrypted?: boolean; allowSession?: boolean }
): Promise<BasicAuthCredentials | null> {
  const fromHeader = parseBasicAuthHeader(req, opts);
  if (fromHeader) return fromHeader;

  if (opts?.allowSession === false || !ConfigSessionRepository.enabled()) {
    return null;
  }

  const token = readConfigSessionToken(req);
  if (!token) return null;

  const resolved = await ConfigSessionRepository.resolve(token);
  if (!resolved) {
    if (res) clearConfigSessionCookie(res);
    return null;
  }
  const { uuid, password, renewedUntil } = resolved;
  if (res && renewedUntil !== undefined) {
    setConfigSessionCookie(req, res, token, true, renewedUntil);
  }
  return { uuid, password };
}
