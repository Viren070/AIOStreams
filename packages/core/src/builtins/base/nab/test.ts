import { createLogger } from '../../../utils/index.js';
import { failedTest, type EndpointTestResult } from '../../test-result.js';
import { BaseNabApi, type NabTestResult } from './api.js';

const logger = createLogger('nab-test');

export type NabNamespaceId = 'newznab' | 'torznab';

const STAGE_HINTS: Record<string, string> = {
  caps: 'Could not reach a Newznab API here. Check the URL, including its path.',
  auth: 'The endpoint is reachable, but the API key was rejected.',
  search: 'The endpoint is reachable, but the search request failed.',
};

function describeIdSearch(params: NabTestResult['idSearchParams']): string {
  const movie = params?.movie ?? [];
  const series = params?.series ?? [];
  if (!movie.length && !series.length)
    return 'No ID search, results are matched by title only';
  if (movie.length === series.length && movie.every((p) => series.includes(p)))
    return `ID search: ${movie.join(', ')}`;
  return `ID search: ${movie.length ? movie.join(', ') : 'none'} (movies), ${series.length ? series.join(', ') : 'none'} (series)`;
}

function summarise(result: NabTestResult): EndpointTestResult {
  if (!result.ok) {
    const hint = result.stage ? STAGE_HINTS[result.stage] : undefined;
    const code =
      result.error?.code !== undefined ? ` (${result.error.code})` : '';
    return failedTest(
      [hint, result.error?.message].filter(Boolean).join(' ') + code
    );
  }
  return {
    ok: true,
    title: `Connected to ${result.server?.title || 'the indexer'}`,
    description: [
      describeIdSearch(result.idSearchParams),
      result.resultCount !== undefined && `${result.resultCount} results`,
      result.limits?.max !== undefined &&
        `max ${result.limits.max} per request`,
      result.searchModes?.length && `supports ${result.searchModes.join(', ')}`,
    ]
      .filter(Boolean)
      .join(' · '),
    warning: result.missingInfoHash
      ? {
          title: 'No hash in the sample result',
          description:
            'This indexer may need to download the torrent file for every result, which can affect performance or hit request limits. Consider lowering the results limit if you notice issues.',
        }
      : undefined,
  };
}

/**
 * Probe a newznab/torznab endpoint
 */
export async function testNabEndpoint(args: {
  namespace: NabNamespaceId;
  url: string;
  apiKey?: string;
}): Promise<EndpointTestResult> {
  let api: BaseNabApi<NabNamespaceId>;
  try {
    api = new BaseNabApi(args.namespace, logger, args.url, args.apiKey, '');
  } catch {
    return failedTest('That does not look like a valid URL');
  }
  return summarise(await api.testConnection());
}
