import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateKey, rootDomain, type SourceVerdict } from './evaluate.js';
import type { ScreenerEvalOptions } from './types.js';

const OPTS = (over: Partial<ScreenerEvalOptions> = {}): ScreenerEvalOptions => ({
  quorum: 2,
  backboneScope: false,
  myBackbones: [],
  ...over,
});

const row = (over: Partial<SourceVerdict> = {}): SourceVerdict => ({
  isLocal: false,
  trust: 'corroborate',
  verdict: 'dead',
  backbones: [],
  ...over,
});

describe('evaluateKey: trust + quorum', () => {
  it('a full source filters on its own', () => {
    const r = evaluateKey([row({ trust: 'full', isLocal: true })], OPTS());
    assert.equal(r.filtered, true);
    assert.equal(r.verdict, 'dead');
    assert.equal(r.reason, 'dead');
  });

  it('one corroborate source does not meet quorum 2', () => {
    assert.equal(evaluateKey([row()], OPTS()).filtered, false);
  });

  it('two corroborate sources meet quorum 2', () => {
    const r = evaluateKey([row(), row()], OPTS());
    assert.equal(r.filtered, true);
    assert.equal(r.reason, 'dead (2 sources)');
  });

  it('observe sources never filter', () => {
    assert.equal(
      evaluateKey([row({ trust: 'observe' }), row({ trust: 'observe' })], OPTS())
        .filtered,
      false
    );
  });

  it('surfaces the most severe verdict', () => {
    const r = evaluateKey(
      [row({ verdict: 'dead' }), row({ verdict: 'fake' })],
      OPTS()
    );
    assert.equal(r.verdict, 'fake');
  });
});

describe('evaluateKey: backbone scope', () => {
  const scoped = OPTS({ backboneScope: true, myBackbones: ['news.myprovider.com'] });

  it('excludes a remote verdict from a non-matching backbone', () => {
    assert.equal(
      evaluateKey(
        [row({ trust: 'full', backbones: ['news.other.com'] })],
        scoped
      ).filtered,
      false
    );
  });

  it('honours a remote verdict whose backbone matches mine (root domain)', () => {
    assert.equal(
      evaluateKey(
        [row({ trust: 'full', backbones: ['feed.myprovider.com'] })],
        scoped
      ).filtered,
      true
    );
  });

  it('treats a verdict with no backbones as in-scope', () => {
    assert.equal(
      evaluateKey([row({ trust: 'full', backbones: [] })], scoped).filtered,
      true
    );
  });

  it('treats a verdict with only unparseable backbones as applying everywhere', () => {
    // No known backbones (all collapse to "unknown") means it applies anywhere,
    // the same as an empty list.
    assert.equal(
      evaluateKey(
        [row({ trust: 'full', backbones: ['', '   '] })],
        scoped
      ).filtered,
      true
    );
  });

  it('local verdicts always count regardless of scope', () => {
    assert.equal(
      evaluateKey(
        [row({ isLocal: true, trust: 'full', backbones: ['news.other.com'] })],
        scoped
      ).filtered,
      true
    );
  });
});

describe('rootDomain', () => {
  it('reduces a host to its registrable root', () => {
    assert.equal(rootDomain('news.example.com'), 'example.com');
    assert.equal(rootDomain('example.com'), 'example.com');
    assert.equal(rootDomain('a.b.co.uk'), 'b.co.uk');
    assert.equal(rootDomain('news.example.com:563'), 'example.com');
    assert.equal(rootDomain('1.2.3.4'), '1.2.3.4');
    assert.equal(rootDomain(''), 'unknown');
    assert.equal(rootDomain(null), 'unknown');
  });

  it('preserves IPv6 literals instead of truncating at the first colon', () => {
    assert.equal(rootDomain('2001:db8::1'), '2001:db8::1');
    assert.equal(rootDomain('[2001:db8::1]:563'), '2001:db8::1');
    assert.equal(rootDomain('[::1]'), '::1');
  });
});
