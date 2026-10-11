import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
// Load the core entry point first; the debrid services import each other.
import '../index.js';
import { altmountStreamsBody } from './altmount.js';

const nzb = 'https://indexer.test/getnzb?id=1';

describe('altmountStreamsBody', () => {
  it('sends season and episode for an episode request', () => {
    const body = altmountStreamsBody(nzb, {
      titles: ['Show'],
      season: 1,
      episode: 2,
    });
    assert.equal(body.get('nzb_url'), nzb);
    assert.equal(body.get('season'), '1');
    assert.equal(body.get('episode'), '2');
  });

  it('sends only the NZB URL for a movie', () => {
    const body = altmountStreamsBody(nzb, { titles: ['Film'] });
    assert.deepEqual([...body.keys()], ['nzb_url']);
  });

  it('sends only the NZB URL without metadata', () => {
    assert.deepEqual([...altmountStreamsBody(nzb).keys()], ['nzb_url']);
  });
});
