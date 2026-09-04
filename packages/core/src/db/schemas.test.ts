import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { UserDataSchema } from './schemas.js';

// Services and addons share one healthCheckUrl definition, so exercising it
// through the service list covers both.
const services = UserDataSchema.shape.services;

function parse(healthCheckUrl?: string) {
  return services.safeParse([
    {
      id: 'realdebrid',
      credentials: { apiKey: 'x' },
      ...(healthCheckUrl === undefined ? {} : { healthCheckUrl }),
    },
  ]);
}

describe('healthCheckUrl', () => {
  it('accepts a public https address', () => {
    assert.equal(parse('https://api.example.com/health').success, true);
  });

  it('accepts a service with no health check at all', () => {
    assert.equal(parse().success, true);
  });

  it('rejects a private address, which the gate treats as healthy and never skips', () => {
    assert.equal(parse('http://192.168.1.50:8080/health').success, false);
    assert.equal(parse('http://10.0.0.5/health').success, false);
  });

  it('rejects loopback', () => {
    assert.equal(parse('http://127.0.0.1:8080/health').success, false);
    assert.equal(parse('http://localhost:8080/health').success, false);
  });

  it('rejects a non-http scheme', () => {
    assert.equal(parse('ftp://example.com/health').success, false);
  });
});
