import type { Request } from 'express';
import {
  APIError,
  constants,
  decryptString,
  isEncrypted,
} from '@aiostreams/core';

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
export function parseBasicAuthHeader(req: Request): BasicAuthCredentials | null {
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
