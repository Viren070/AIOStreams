import { config as appConfig } from '../config/index.js';

const REDACT_CENSOR = '<redacted>';
/**
 * Strip `apikey`/`token`/`api_key` query parameters from any URL-like
 * substring in a string. Used by the URL serializer for log fields that
 * contain freeform text (typically `msg`).
 */
const URL_PARAM_PATTERN = /([?&](?:apikey|api_key|token|secret)=)([^&\s'"]+)/gi;

export function redactUrlParams(s: string): string {
  return s.replace(URL_PARAM_PATTERN, `$1${REDACT_CENSOR}`);
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
