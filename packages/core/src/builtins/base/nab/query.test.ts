import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { getGlobalDispatcher, MockAgent, setGlobalDispatcher } from 'undici';
import { settingsStore } from '../../../config/index.js';
import { SettingsRepository } from '../../../db/repositories/settings.js';
import { createLogger } from '../../../utils/index.js';
import { BaseNabApi } from './api.js';
import { buildNabQuery } from './query.js';

describe('buildNabQuery', () => {
  it('orders params like Prowlarr', () => {
    assert.equal(
      buildNabQuery(
        'movie',
        { limit: '100', imdbid: '0133093', extended: '1', offset: '0' },
        { dl: '1' },
        'KEY'
      ),
      't=movie&extended=1&dl=1&apikey=KEY&imdbid=0133093&limit=100&offset=0'
    );
  });

  it('sends season 0 as 00', () => {
    assert.equal(
      buildNabQuery('tvsearch', { q: 'the office', season: '0' }),
      't=tvsearch&season=00&q=the+office'
    );
  });

  it('takes the api key from the url when none is set', () => {
    assert.equal(
      buildNabQuery('caps', {}, { apikey: 'URLKEY' }, ''),
      't=caps&apikey=URLKEY'
    );
  });
});

describe('BaseNabApi', () => {
  it('tests the connection like Prowlarr', async (t) => {
    mock.method(SettingsRepository, 'getVersion', async () => 0);
    mock.method(SettingsRepository, 'getAll', async () => [
      {
        key: 'http.hostnameUserAgentOverrides',
        value: JSON.stringify({ '[newznab]': '{prowlarr}' }),
      },
    ]);
    await settingsStore.initialise();
    const agent = new MockAgent();
    agent.disableNetConnect();
    const previous = getGlobalDispatcher();
    setGlobalDispatcher(agent);
    t.after(() => {
      setGlobalDispatcher(previous);
      mock.restoreAll();
    });

    const seen: { path: string; traceparent: string }[] = [];
    agent
      .get('https://indexer.test')
      .intercept({ path: () => true })
      .reply(({ path, headers }) => {
        const { traceparent } = headers as Record<string, string>;
        seen.push({ path, traceparent });
        return {
          statusCode: 200,
          data: path.includes('t=caps')
            ? '<caps><searching><search available="yes" supportedParams="q"/></searching></caps>'
            : '<rss><channel></channel></rss>',
        };
      })
      .persist();

    const api = new BaseNabApi(
      'newznab',
      createLogger('test'),
      'https://indexer.test',
      'KEY'
    );
    assert.equal((await api.testConnection()).ok, true);
    assert.deepEqual(
      seen.map((s) => s.path),
      ['/api?t=caps&apikey=KEY', '/api?t=search&extended=1&apikey=KEY']
    );
    for (const { traceparent } of seen) {
      assert.match(traceparent, /^00-[0-9a-f]{32}-[0-9a-f]{16}-00$/);
    }
  });
});
