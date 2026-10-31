import { describe, it, vi } from 'vitest';
import assert from 'node:assert/strict';

vi.mock('@aiostreams/core', () => ({
  config: { api: { trustedIps: [] } },
  createLogger: () => ({
    warn: () => {},
    debug: () => {},
    info: () => {},
    error: () => {},
  }),
}));

import { isPrivateIp, ipMiddleware } from './ip.js';

describe('Issue #1525: isPrivateIp and ipMiddleware with IPv4-mapped IPv6 addresses', () => {
  it('identifies standard IPv4 private, loopback, and link-local addresses as private', () => {
    assert.equal(isPrivateIp('10.0.0.1'), true);
    assert.equal(isPrivateIp('127.0.0.1'), true);
    assert.equal(isPrivateIp('172.16.0.1'), true);
    assert.equal(isPrivateIp('172.17.0.1'), true);
    assert.equal(isPrivateIp('172.31.255.254'), true);
    assert.equal(isPrivateIp('192.168.1.1'), true);
    assert.equal(isPrivateIp('169.254.169.254'), true);
  });

  it('identifies IPv4-mapped IPv6 private, loopback, and link-local addresses as private', () => {
    assert.equal(isPrivateIp('::ffff:10.0.0.5'), true);
    assert.equal(isPrivateIp('::ffff:a00:5'), true);
    assert.equal(isPrivateIp('0:0:0:0:0:ffff:a00:5'), true);
    assert.equal(isPrivateIp('::ffff:127.0.0.1'), true);
    assert.equal(isPrivateIp('::ffff:172.17.0.1'), true);
    assert.equal(isPrivateIp('::ffff:172.31.0.1'), true);
    assert.equal(isPrivateIp('::ffff:192.168.1.10'), true);
    assert.equal(isPrivateIp('::ffff:169.254.1.1'), true);
    assert.equal(isPrivateIp('::FFFF:172.17.0.1'), true);
  });

  it('identifies IPv6 loopback, ULA, and link-local addresses as private', () => {
    assert.equal(isPrivateIp('::1'), true);
    assert.equal(isPrivateIp('fc00::1'), true);
    assert.equal(isPrivateIp('fd12:3456:789a::1'), true);
    assert.equal(isPrivateIp('fe80::1'), true);
  });

  it('identifies public IPv4, IPv4-mapped public IPv6, and public IPv6 addresses as non-private', () => {
    assert.equal(isPrivateIp('8.8.8.8'), false);
    assert.equal(isPrivateIp('1.1.1.1'), false);
    assert.equal(isPrivateIp('172.15.0.1'), false);
    assert.equal(isPrivateIp('172.32.0.1'), false);
    assert.equal(isPrivateIp('::ffff:8.8.8.8'), false);
    assert.equal(isPrivateIp('::ffff:808:808'), false);
    assert.equal(isPrivateIp('::ffff:93.184.216.34'), false);
    assert.equal(isPrivateIp('2001:4860:4860::8888'), false);
    assert.equal(isPrivateIp('2606:4700:4700::1111'), false);
  });

  it('strips IPv4-mapped private req.ip from req.userIp in ipMiddleware', () => {
    const reqPrivate: any = {
      ip: '::ffff:172.17.0.1',
      get: () => undefined,
    };
    let nextCalled = false;
    ipMiddleware(reqPrivate, {} as any, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
    assert.equal(reqPrivate.userIp, undefined);
    assert.equal(reqPrivate.requestIp, '::ffff:172.17.0.1');

    const reqPublic: any = {
      ip: '::ffff:172.17.0.1',
      get: (header: string) =>
        header === 'X-Forwarded-For' ? '93.184.216.34' : undefined,
    };
    ipMiddleware(reqPublic, {} as any, () => {});
    assert.equal(reqPublic.userIp, '93.184.216.34');
  });
});
