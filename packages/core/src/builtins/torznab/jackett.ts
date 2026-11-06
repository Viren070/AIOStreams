import {
  createLogger,
  makeRequest,
  makeUrlLogSafe,
  readBodyUpTo,
} from '../../utils/index.js';
import { config as appConfig } from '../../config/index.js';
import { parseXmlCompat } from '../../utils/xml.js';

const logger = createLogger('jackett');

const INDEXER_LIST_TIMEOUT = 10_000;

export interface JackettCredentials {
  url: string;
  apiKey: string;
}

export interface JackettIndexer {
  id: string;
  title: string;
}

/** The user's Jackett, else the preconfigured one. */
export function resolveJackettCredentials(input: {
  url?: string;
  apiKey?: string;
}): JackettCredentials | undefined {
  const user = { url: input.url?.trim(), apiKey: input.apiKey?.trim() };
  const { url, apiKey } =
    user.url || user.apiKey ? user : appConfig.builtins.jackett;
  return url && apiKey ? { url: url.replace(/\/+$/, ''), apiKey } : undefined;
}

/** Torznab api url of one indexer, or of the combined `all` indexer. */
export function jackettTorznabUrl(baseUrl: string, indexerId: string): string {
  return `${baseUrl}/api/v2.0/indexers/${encodeURIComponent(indexerId)}/results/torznab/api`;
}

/** List the indexers configured in a Jackett instance. */
export async function fetchJackettIndexers(
  credentials: JackettCredentials
): Promise<JackettIndexer[]> {
  const url = new URL(jackettTorznabUrl(credentials.url, 'all'));
  url.search = new URLSearchParams({
    t: 'indexers',
    configured: 'true',
    apikey: credentials.apiKey,
  }).toString();

  logger.debug(`Fetching Jackett indexers from ${makeUrlLogSafe(url.href)}`);
  const response = await makeRequest(url.href, {
    method: 'GET',
    timeout: INDEXER_LIST_TIMEOUT,
    headers: {
      Accept: 'application/xml, text/xml',
      'User-Agent': appConfig.http.defaultUserAgent,
    },
    context: 'torznab',
  });
  const { body } = await readBodyUpTo(
    response,
    appConfig.builtins.nab.maxResponseBytes
  );

  let document: any;
  try {
    document = parseXmlCompat(body);
  } catch {
    throw new Error(
      response.ok
        ? 'Jackett returned an invalid response. Check the URL.'
        : `Jackett responded with ${response.status}`
    );
  }
  if (!document.indexers) {
    // e.g. <error code="100" description="Invalid API Key"/>
    throw new Error(
      document.error?.$?.description ||
        'Jackett returned an unexpected response. Check the URL.'
    );
  }

  const entries: any[] = document.indexers.indexer ?? [];
  return entries
    .filter((entry) => entry?.$?.id)
    .map((entry) => ({
      id: entry.$.id,
      title: typeof entry.title?.[0] === 'string' ? entry.title[0] : entry.$.id,
    }));
}
