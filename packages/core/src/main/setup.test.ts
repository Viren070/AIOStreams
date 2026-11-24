import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
// load the core entry point first; schemas.ts and setup.ts reach runtime config.
import '../utils/index.js';
import { buildResources } from './setup.js';
import { ManifestSchema, type UserData } from '../db/schemas.js';
import type { AIOStreamsContext } from './types.js';

// A genre-only catalog, the shape AIOMetadata uses for its Home-hideable rows.
const GENRE_CATALOG = {
  id: 'top',
  type: 'movie',
  name: 'Popular',
  showInHome: false,
  extra: [{ name: 'genre', isRequired: true, options: ['None', 'Action'] }],
};

function parseManifest(catalogs: unknown[]) {
  return ManifestSchema.parse({
    id: 'org.example.visibility',
    name: 'Visibility repro',
    version: '1.0.0',
    types: ['movie'],
    resources: ['catalog'],
    catalogs,
  });
}

/**
 * Run the real manifest builder over one upstream manifest and return the
 * catalogs the aggregated manifest will serve.
 */
function buildCatalogs(
  catalogs: unknown[],
  catalogModifications: NonNullable<UserData['catalogModifications']> = []
) {
  const ctx = {
    userData: {
      catalogModifications,
      newCatalogsDisabled: [],
      upstreamCatalogOrder: [],
    },
    manifests: { inst: parseManifest(catalogs) },
    supportedResources: {},
    finalResources: [],
    finalCatalogs: [],
    finalAddonCatalogs: [],
    addons: [{ instanceId: 'inst', name: 'Example', resources: ['catalog'] }],
  } as unknown as AIOStreamsContext;
  buildResources(ctx);
  return ctx.finalCatalogs;
}

describe('catalog showInHome', () => {
  it('keeps the hint an upstream manifest declares', () => {
    const parsed = parseManifest([GENRE_CATALOG]);
    assert.equal(parsed.catalogs[0].showInHome, false);
  });

  it('serves an upstream hint unchanged when nothing overrides it', () => {
    const [catalog] = buildCatalogs([GENRE_CATALOG]);
    assert.equal(catalog.showInHome, false);
  });

  it('turns an explicit Show on Home into showInHome: true', () => {
    const [catalog] = buildCatalogs(
      [GENRE_CATALOG],
      [{ id: 'inst.top', type: 'movie', showOnHome: true }]
    );
    assert.equal(catalog.showInHome, true);
    assert.deepEqual(
      catalog.extra.map(
        (e: { name: string; isRequired?: boolean }) =>
          `${e.name}:${e.isRequired}`
      ),
      ['genre:false']
    );
  });

  it('turns an explicit Only on Discover into showInHome: false', () => {
    const [catalog] = buildCatalogs(
      [
        {
          id: 'recent',
          type: 'movie',
          name: 'Recent',
          extra: [{ name: 'skip' }],
        },
      ],
      [{ id: 'inst.recent', type: 'movie', onlyOnDiscover: true }]
    );
    assert.equal(catalog.showInHome, false);
  });

  it('turns an explicit Only on Search into showInHome: false', () => {
    const [catalog] = buildCatalogs(
      [
        {
          id: 'search',
          type: 'movie',
          name: 'Search',
          extra: [{ name: 'search' }],
        },
      ],
      [{ id: 'inst.search', type: 'movie', onlyOnSearch: true }]
    );
    assert.equal(catalog.showInHome, false);
  });

  it('overrides an upstream false when the user turns Discover Only off', () => {
    const [catalog] = buildCatalogs(
      [
        {
          id: 'recent',
          type: 'movie',
          name: 'Recent',
          showInHome: false,
          extra: [{ name: 'skip' }],
        },
      ],
      [{ id: 'inst.recent', type: 'movie', onlyOnDiscover: false }]
    );
    assert.equal(catalog.showInHome, true);
  });

  it('overrides an upstream true when the user hides the catalog', () => {
    const shown = { ...GENRE_CATALOG, showInHome: true };
    const [catalog] = buildCatalogs(
      [shown],
      [{ id: 'inst.top', type: 'movie', showOnHome: false }]
    );
    assert.equal(catalog.showInHome, false);
  });

  it('leaves an addon catalog that declares no hint without one', () => {
    const { showInHome: _omitted, ...hidden } = GENRE_CATALOG;
    const [catalog] = buildCatalogs([hidden]);
    assert.equal('showInHome' in catalog, false);
  });
});
