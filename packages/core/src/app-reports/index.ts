import { createHash } from 'node:crypto';
import { z } from 'zod';
import { config as appConfig } from '../config/index.js';
import {
  AppReportRepository,
  formatReportCode,
  type AppReportInput,
} from '../db/index.js';
import { createLogger } from '../logging/logger.js';
import { redactUrlParams } from '../logging/redact.js';
import { makeRequest } from '../utils/http.js';

const logger = createLogger('app-reports');

/** Under the API's default body limit, with the summary beside it. */
const MAX_DETAILS = 192 * 1024;

/** The start, which says what happened, and the end, the last lines before it. */
function cutDetails(s: string): string {
  if (s.length <= MAX_DETAILS) return s;
  const head = MAX_DETAILS / 4;
  return `${s.slice(0, head)}\n[…]\n${s.slice(s.length - (MAX_DETAILS - head))}`;
}

/** A report as an app sends it, cut down to size rather than refused. */
export const appReportBodySchema = z.object({
  kind: z.enum(['crash', 'report']).default('report'),
  platform: z.string().trim().min(1).max(32),
  appVersion: z.string().trim().max(64).default(''),
  device: z.string().trim().max(200).default(''),
  note: z.string().max(2000).default(''),
  summary: z.string().transform((s) => s.slice(0, 16 * 1024)),
  details: z.string().default('').transform(cutDetails),
});

export type AppReportBody = z.infer<typeof appReportBodySchema>;

const SECRET_HEADER =
  /((?:token|apikey|api_key|password|pw)\s*[=:]\s*"?)[^",;&\s]+/gi;
const BEARER = /(bearer\s+)[\w.~+/=-]+/gi;
// A configuration's encrypted password follows its uuid in addresses.
const CONFIG_PATH =
  /(\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/)[^/\s?#"]+/gi;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Passwords, tokens and keys taken out; with `ids`, configuration ids too, for another server. */
export function redactReportText(text: string, ids = false): string {
  let out = redactUrlParams(text)
    .replace(SECRET_HEADER, '$1***')
    .replace(BEARER, '$1***')
    .replace(CONFIG_PATH, '$1***');
  if (ids) out = out.replace(UUID, '<id>');
  return out;
}

function redacted(body: AppReportBody, ids: boolean): AppReportBody {
  return {
    ...body,
    note: redactReportText(body.note, ids),
    summary: redactReportText(body.summary, ids),
    details: redactReportText(body.details, ids),
  };
}

export class AppReportsDisabledError extends Error {}

export interface SentReport {
  /** As shown, `ABC-DEFG`. */
  code: string;
  /** The developer's code, when it went there too. */
  forwarded: string | null;
  /** Why it didn't reach the developer. */
  forwardError: string | null;
}

const originOf = (url: string | null | undefined) => {
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
};

/** Whether this server offers to pass reports on to the developer, which it doesn't when it is the developer's. */
export function appReportsForward(): boolean {
  const target = originOf(appConfig.appReports.forwardTo);
  return (
    appConfig.appReports.accept !== 'off' &&
    !!target &&
    target !== originOf(appConfig.bootstrap.baseUrl)
  );
}

/** Keeps a report from one of this server's users, and passes it on when asked. */
export async function submitAppReport(
  body: AppReportBody,
  from: { uuid: string; persona: string | null },
  forward: boolean
): Promise<SentReport> {
  if (appConfig.appReports.accept === 'off')
    throw new AppReportsDisabledError();
  const code = await keep({
    ...toInput(redacted(body, false)),
    uuid: from.uuid,
    persona: from.persona,
  });
  logger.info(
    { code, kind: body.kind, platform: body.platform },
    'app report kept'
  );
  const sent: SentReport = {
    code: formatReportCode(code),
    forwarded: null,
    forwardError: null,
  };
  if (!forward || !appReportsForward()) return sent;
  try {
    sent.forwarded = await forwardReport(redacted(body, true));
  } catch (error) {
    sent.forwardError = error instanceof Error ? error.message : String(error);
    logger.warn({ code, error: sent.forwardError }, 'app report not passed on');
  }
  return sent;
}

/** Keeps a report another server passed on, where this one takes them from anyone. */
export async function receiveAppReport(
  body: AppReportBody,
  origin: string | null
): Promise<string> {
  if (appConfig.appReports.accept !== 'public')
    throw new AppReportsDisabledError();
  const code = await keep({
    ...toInput(redacted(body, true)),
    origin: origin?.slice(0, 200) ?? null,
  });
  logger.info({ code, origin }, 'app report received');
  return formatReportCode(code);
}

async function keep(report: AppReportInput): Promise<string> {
  const code = await AppReportRepository.create(report);
  await AppReportRepository.trim(appConfig.appReports.max);
  return code;
}

function toInput(body: AppReportBody): AppReportInput {
  return {
    kind: body.kind,
    platform: body.platform,
    appVersion: body.appVersion,
    device: body.device,
    note: body.note,
    summary: body.summary,
    details: body.details,
  };
}

async function forwardReport(body: AppReportBody): Promise<string> {
  const target = new URL('/api/v1/reports', appConfig.appReports.forwardTo!);
  const origin = appConfig.bootstrap.baseUrl
    ? createHash('sha256')
        .update(new URL(appConfig.bootstrap.baseUrl).host)
        .digest('hex')
        .slice(0, 8)
    : null;
  const res = await makeRequest(target.toString(), {
    method: 'POST',
    timeout: 15_000,
    ignoreRecursion: true,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, origin }),
  });
  const json = (await res.json().catch(() => null)) as {
    data?: { code?: string };
    error?: { message?: string };
  } | null;
  if (!res.ok || !json?.data?.code)
    throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
  return json.data.code;
}
