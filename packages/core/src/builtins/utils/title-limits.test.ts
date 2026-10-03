// Load the parser entry point first, as the application does, before builtins.
import '../../parser/utils.js';
import { getTitleLimitForUrl } from './general.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { settingsStore } from '../../config/index.js';
import { SettingsRepository } from '../../db/repositories/settings.js';
import { titleLimitMap } from '../../config/schema/title-limits.js';

describe('title limit configuration', () => {
  it('normalizes object and environment entries, including IPv6 hosts', () => {
    assert.deepEqual(titleLimitMap.parse({ ' Example.COM ': 3 }), {
      'example.com': 3,
    });
    assert.deepEqual(
      titleLimitMap.parse(' Example.COM:3, [2001:db8::1]:4, *:2'),
      { 'example.com': 3, '[2001:db8::1]': 4, '*': 2 }
    );
  });
  it('rejects blank keys and non-positive or fractional limits', () => {
    for (const input of [
      { ' ': 3 },
      ':3',
      'host:0',
      'host:-1',
      'host:1.5',
      'host:no',
      { host: 0 },
      { host: 1.5 },
    ]) {
      assert.equal(
        titleLimitMap.safeParse(input).success,
        false,
        JSON.stringify(input)
      );
    }
  });
});

describe('title limit lookup', () => {
  for (const fixture of [
    {
      name: 'hostname before indexer, addon and wildcard',
      map: 'jackett.test:5,ninja:4,newznab:3,*:2',
      url: 'https://jackett.test/api/v2.0/indexers/ninja/results/torznab',
      expected: 5,
    },
    {
      name: 'Jackett name before addon and wildcard',
      map: 'ninja:4,newznab:3,*:2',
      url: 'https://jackett.test/api/v2.0/indexers/Ninja/results/torznab',
      expected: 4,
    },
    {
      name: 'NZBHydra indexer name',
      map: 'ninja:4,newznab:3,*:2',
      url: 'https://hydra.test/api?indexers=other,Ninja',
      expected: 4,
    },
    {
      name: 'addon before wildcard',
      map: 'newznab:3,*:2',
      url: 'https://indexer.test/api',
      expected: 3,
    },
    {
      name: 'wildcard before global',
      map: '*:2',
      url: 'https://indexer.test/api',
      expected: 2,
    },
    {
      name: 'global fallback',
      map: '',
      url: 'https://indexer.test/api',
      expected: 7,
    },
    {
      name: 'inherited constructor is not an override',
      map: '',
      url: 'https://jackett.test/api/v2.0/indexers/constructor/results/torznab',
      expected: 7,
    },
    {
      name: 'malformed name still falls back to addon',
      map: 'newznab:3',
      url: 'https://jackett.test/api/v2.0/indexers/%E0%A4%A/results/torznab',
      expected: 3,
    },
    {
      name: 'malformed name still falls back to wildcard',
      map: '*:2',
      url: 'https://jackett.test/api/v2.0/indexers/%E0%A4%A/results/torznab',
      expected: 2,
    },
    {
      name: 'IPv6 hostname',
      map: '[2001:db8::1]:4',
      url: 'https://[2001:db8::1]/api',
      expected: 4,
    },
  ]) {
    it(fixture.name, async (t) => {
      const keys = [
        'BUILTIN_SCRAPE_TITLE_LIMITS',
        'BUILTIN_SCRAPE_TITLE_LIMIT',
      ] as const;
      const previous = keys.map((key) => process.env[key]);
      t.after(() =>
        keys.forEach((key, i) => {
          if (previous[i] === undefined) delete process.env[key];
          else process.env[key] = previous[i];
        })
      );
      process.env.BUILTIN_SCRAPE_TITLE_LIMITS = fixture.map;
      process.env.BUILTIN_SCRAPE_TITLE_LIMIT = '7';
      t.mock.method(SettingsRepository, 'getAll', async () => []);
      t.mock.method(SettingsRepository, 'getVersion', async () => 0);
      await settingsStore.initialise();
      assert.equal(
        getTitleLimitForUrl(fixture.url, 'newznab'),
        fixture.expected
      );
    });
  }
});
