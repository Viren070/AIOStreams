import { describe, it, expect, vi } from 'vitest';

// Stub out the heavy utils chain to avoid circular dependency issues that
// arise when loading utils/index.js → config.js → main/index.js → debrid/index.js.
vi.mock('../utils/index.js', () => {
  const noop = () => ({});
  const mockCache = {
    get: vi.fn().mockResolvedValue(undefined),
    set: vi.fn().mockResolvedValue(undefined),
  };
  return {
    appConfig: {
      builtins: { debrid: { playbackLinkCacheTtl: 3600 } },
    },
    createLogger: () => ({
      debug: noop,
      info: noop,
      warn: noop,
      error: noop,
    }),
    Cache: { getInstance: () => mockCache },
    DistributedLock: { getInstance: () => ({ acquire: vi.fn(), release: vi.fn() }) },
    Time: { Second: 1000, Hour: 3600000 },
    getTimeTakenSincePoint: () => '0ms',
    maskSensitiveInfo: (s: string) => s,
    fromUrlSafeBase64: (s: string) => s,
    formatZodError: (e: unknown) => String(e),
    ServiceId: undefined,
    IdParser: undefined,
    constants: {
      BUILTIN_SUPPORTED_SERVICES: [] as const,
      SERVICES: [] as const,
    },
  };
});

// Stub ./utils.js to avoid pulling in its heavy dependency chain.
vi.mock('./utils.js', () => ({
  isVideoFile: () => false,
  selectFileInTorrentOrNZB: vi.fn(),
  hashNzbUrl: (url: string) => url,
  buildResolveKey: (...args: string[]) => args.join(':'),
}));

// Stub proxy imports used by usenet-stream-base.
vi.mock('../proxy/builtin.js', () => ({ BuiltinProxy: class {} }));
vi.mock('../proxy/index.js', () => ({ createProxy: vi.fn() }));

import {
  UsenetStreamService,
  UsenetStreamServiceConfig,
} from './usenet-stream-base.js';
import { DebridError, DebridServiceConfig, PlaybackInfo } from './base.js';

// Minimal concrete subclass for testing.
class TestService extends UsenetStreamService {
  readonly serviceName = 'nzbdav' as const;

  protected getContentPathPrefix(): string {
    return '/complete';
  }

  protected getExpectedFolderName(_nzb: PlaybackInfo & { type: 'usenet' }): string {
    return 'test-folder';
  }
}

const debridConfig: DebridServiceConfig = { token: 'test-token' };

const configWithWebdav: UsenetStreamServiceConfig = {
  webdavUrl: 'http://localhost:5080/webdav/',
  publicWebdavUrl: 'http://localhost:5080/webdav/',
  webdavUser: 'user',
  webdavPassword: 'pass',
  apiUrl: 'http://localhost:5080/sabnzbd/api',
  apiKey: 'apikey',
};

const configWithoutWebdav: UsenetStreamServiceConfig = {
  apiUrl: 'http://localhost:5080/sabnzbd/api',
  apiKey: 'apikey',
};

describe('UsenetStreamService — optional WebDAV config', () => {
  it('creates the webdav client when webdavUrl is provided', () => {
    const svc = new TestService(debridConfig, configWithWebdav, 'nzbdav');
    expect((svc as unknown as { webdavClient: unknown }).webdavClient).toBeDefined();
  });

  it('leaves webdavClient undefined when webdavUrl is omitted', () => {
    const svc = new TestService(debridConfig, configWithoutWebdav, 'nzbdav');
    expect((svc as unknown as { webdavClient: unknown }).webdavClient).toBeUndefined();
  });

  it('throws DebridError from getNzb when WebDAV is not configured', async () => {
    const svc = new TestService(debridConfig, configWithoutWebdav, 'nzbdav');
    // Use an id with '/' so resolveContentPath takes the fast path and
    // collectFiles is called directly, surfacing the missing-webdav error.
    await expect(svc.getNzb('category/some-file')).rejects.toMatchObject({
      message: expect.stringMatching(/WebDAV is not configured/i),
    });
  });

  it('throws DebridError 503 from getPublicWebdavUrlWithAuth when publicWebdavUrl is omitted', () => {
    const svc = new TestService(debridConfig, configWithoutWebdav, 'nzbdav');
    const getUrl = () =>
      (
        svc as unknown as { getPublicWebdavUrlWithAuth(): string }
      ).getPublicWebdavUrlWithAuth();
    expect(getUrl).toThrowError(DebridError);
    try {
      getUrl();
    } catch (e) {
      expect((e as DebridError).statusCode).toBe(503);
      expect((e as DebridError).message).toMatch(/WebDAV is not configured/i);
    }
  });
});
