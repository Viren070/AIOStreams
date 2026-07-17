import { config as appConfig, settingsStore } from '../config/index.js';

const REDACT_CENSOR = '<redacted>';
/**
 * Query/fragment params whose key contains a credential word. Substring match
 * on the key so `apiKey`, `api_key`, `session_token`, `access_token` etc. are
 * all caught; anchored on `?`/`&`/`#` so plain prose like "token=..." in a
 * regex or filter description is left alone.
 */
const URL_PARAM_PATTERN =
  /([?&#][^&\s'"=#]*(?:apikey|api_key|token|secret|password|passwd|passkey)[^&\s'"=#]*=)([^&\s'"#]+)/gi;
/**
 * The password half of `scheme://user:password@host` userinfo. The username is
 * kept
 */
const URL_USERINFO_PATTERN = /(\/\/[^/@\s:]*:)([^/@\s]+)@/g;

export function redactUrlParams(s: string): string {
  return s
    .replace(URL_PARAM_PATTERN, `$1${REDACT_CENSOR}`)
    .replace(URL_USERINFO_PATTERN, `$1${REDACT_CENSOR}@`);
}

function sensitiveLoggingEnabled(): boolean {
  if (!settingsStore.initialised) {
    return false;
  }
  return appConfig.logging.logSensitiveInfo;
}

/**
 * Redaction applied by the logger to every record (message and serialized
 * errors) before any sink sees it. A no-op when `LOG_SENSITIVE_INFO` is on.
 */
export function redactForLog(s: string): string {
  if (sensitiveLoggingEnabled()) {
    return s;
  }
  return redactUrlParams(s);
}

/**
 * Log-record fields whose *name* marks the value as a credential. Unlike
 * {@link URL_PARAM_PATTERN} this catches bare values (`{ apikey: 'x' }`)
 * that carry no `apikey=` anchor to pattern-match on.
 */
const SECRET_FIELD_PATTERN =
  /(api[-_]?key|passkey|password|passwd|secret|token|credential|authorization)/i;

/**
 * Redact a top-level string field of a log record: fields with a
 * credential-like name are fully masked, everything else gets the URL-param
 * pass.
 */
export function redactLogField(key: string, value: string): string {
  if (appConfig.logging.logSensitiveInfo) {
    return value;
  }
  if (SECRET_FIELD_PATTERN.test(key)) {
    return REDACT_CENSOR;
  }
  return redactUrlParams(value);
}

/**
 * Mask a value to `<redacted>` unless `LOG_SENSITIVE_INFO` is set.
 */
export function maskSensitiveInfo(message: string): string {
  if (appConfig.logging.logSensitiveInfo) {
    return message;
  }
  return REDACT_CENSOR;
}
