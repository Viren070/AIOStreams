import { config as appConfig } from '../../config/index.js';
import { isUnsafeRemoteUrl } from '../url-safety.js';
import type { UrlAllowlist } from './allowlist.js';
import { isHttpUrl, type SyncKind, type UrlPartition } from './types.js';

/** Whether the caller may fetch URLs the instance has not vouched for. */
export function isUnrestricted(
  kind: SyncKind,
  userData?: { trusted?: boolean }
): boolean {
  const access =
    kind === 'regex'
      ? appConfig.userLimits.regex.access
      : appConfig.userLimits.sel.access;
  return access === 'all' || (access === 'trusted' && !!userData?.trusted);
}

/** Checks the literal address only; the connection guard checks resolved names. */
export function partitionUrls(
  kind: SyncKind,
  urls: string[],
  allowlist: UrlAllowlist,
  userData?: { trusted?: boolean }
): UrlPartition {
  const partition: UrlPartition = {
    allowed: [],
    vouched: [],
    userScoped: [],
    denied: [],
  };
  if (urls.length === 0) return partition;

  const unrestricted = isUnrestricted(kind, userData);
  const disabled =
    kind === 'regex' && appConfig.userLimits.regex.access === 'none';

  for (const url of urls) {
    if (allowlist.has(url)) {
      partition.vouched.push(url);
      partition.allowed.push(url);
      continue;
    }
    if (!unrestricted) {
      partition.denied.push({
        url,
        reason: disabled ? 'disabled' : 'not-vouched',
      });
      continue;
    }
    if (
      appConfig.http.allowPrivateUrls ? !isHttpUrl(url) : isUnsafeRemoteUrl(url)
    ) {
      partition.denied.push({ url, reason: 'unsafe-address' });
      continue;
    }
    partition.userScoped.push(url);
    partition.allowed.push(url);
  }

  return partition;
}
