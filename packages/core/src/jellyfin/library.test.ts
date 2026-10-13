import assert from 'node:assert/strict';
import { test } from 'node:test';
// Load the core entry point first; its modules import each other.
import '../index.js';
import type { MetaPreview } from '../db/schemas.js';
import type { AIOStreams } from '../main/index.js';
import type { Catalog } from './dto.js';
import { similarPreviews } from './library.js';

const SIMILAR = [{ name: 'similar', isRequired: true }];

function preview(id: string, type = 'movie'): MetaPreview {
  return { id, type, name: id };
}

function catalog(type = 'movie', id = 'a.related', extra = SIMILAR): Catalog {
  return { type, id, name: 'Related', extra };
}

function fakeEngine(
  catalogs: Catalog[],
  answer: MetaPreview[] | Error | null = []
) {
  const calls: string[] = [];
  const engine = {
    getCatalogs: () => catalogs,
    getCatalog: async (type: string, id: string, extras?: string) => {
      calls.push(`${type}/${id}/${extras}`);
      if (answer instanceof Error) throw answer;
      return { success: answer !== null, data: answer ?? [], errors: [] };
    },
  } as unknown as AIOStreams;
  return { engine, calls };
}

test('selects once, then filters before limiting', async () => {
  const blocked = [...SIMILAR, { name: 'search', isRequired: true }];
  const data = [
    preview('tmdb:1'),
    preview('tmdb:1', 'series'),
    preview('tt3'),
    preview('tt2'),
  ];
  const { engine, calls } = fakeEngine(
    [
      catalog('movie', 'a.popular', []),
      catalog('series'),
      catalog('movie', 'aiostreams.merged.related'),
      catalog('movie', 'a.search', blocked),
      catalog(),
      catalog('movie', 'b.related'),
    ],
    data
  );
  assert.deepEqual(await similarPreviews(engine, 'movie', 'tmdb:1', 2), [
    data[1],
    data[2],
  ]);
  assert.deepEqual(calls, ['movie/a.related/similar=tmdb%3A1']);
});

for (const [type, id, encoded] of [
  ['movie', 'tt9', 'tt9'],
  ['series', 'tmdb:1', 'tmdb%3A1'],
  ['anime', 'kitsu:1', 'kitsu%3A1'],
  ['movie', 'custom:a&b=c/%', 'custom%3Aa%26b%3Dc%2F%25'],
] as const) {
  test(`passes ${type}/${id} unchanged`, async () => {
    const data = [preview('other', type)];
    const { engine, calls } = fakeEngine([catalog(type)], data);
    assert.deepEqual(await similarPreviews(engine, type, id, 10), data);
    assert.deepEqual(calls, [`${type}/a.related/similar=${encoded}`]);
  });
}

test('does not call a catalog without a matching type and extra', async () => {
  const { engine, calls } = fakeEngine([
    catalog('movie', 'a.popular', []),
    catalog('series'),
  ]);
  assert.equal(await similarPreviews(engine, 'movie', 'tt9', 10), null);
  assert.deepEqual(calls, []);
});

const failures: [string, MetaPreview[] | Error | null][] = [
  ['empty', []],
  ['self-only', [preview('tt9')]],
  ['reported failure', null],
  ['rejected request', new Error('timed out')],
];

for (const [name, answer] of failures) {
  test(`${name}: falls back without trying a second catalog`, async () => {
    const { engine, calls } = fakeEngine(
      [catalog(), catalog('movie', 'b.related')],
      answer
    );
    assert.equal(await similarPreviews(engine, 'movie', 'tt9', 10), null);
    assert.deepEqual(calls, ['movie/a.related/similar=tt9']);
  });
}
