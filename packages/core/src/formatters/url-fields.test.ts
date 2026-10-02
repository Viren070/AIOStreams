import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ParsedStreamSchema } from '../db/schemas.js';
import type { ParsedStream, UserData } from '../db/schemas.js';
import { CustomFormatter } from './custom.js';

function makeStream(overrides: Partial<ParsedStream>): ParsedStream {
  return ParsedStreamSchema.parse({
    id: 'test-stream',
    type: 'http',
    addon: {
      name: 'Test Addon',
      instanceId: 'test-addon',
      enabled: true,
      preset: { id: 'custom', type: 'custom', options: {} },
      manifestUrl: 'https://addon.example/manifest.json',
      timeout: 15000,
    },
    url: 'https://mirror.example.com/path/file.mkv',
    filename: 'file.mkv',
    size: 123456789,
    ...overrides,
  });
}

const ctx = {
  userData: { addonName: 'AIOStreams' } as unknown as UserData,
  addonName: 'AIOStreams',
};

describe('custom formatter url fields', () => {
  it('renders {stream.url} as the full url', async () => {
    const formatter = new CustomFormatter(
      '{stream.url}',
      '{stream.filename}',
      ctx as never
    );
    const result = await formatter.format(makeStream({}));
    assert.equal(result.name, 'https://mirror.example.com/path/file.mkv');
  });

  it('renders {stream.urlHost} as the url host', async () => {
    const formatter = new CustomFormatter(
      '{stream.urlHost}',
      '{stream.filename}',
      ctx as never
    );
    const result = await formatter.format(makeStream({}));
    assert.equal(result.name, 'mirror.example.com');
  });

  it('falls back to the false branch when the stream has no url', async () => {
    const formatter = new CustomFormatter(
      '{stream.urlHost::exists["host={stream.urlHost}"||"no-host"]}',
      '{stream.filename}',
      ctx as never
    );
    const stream = makeStream({ url: undefined });
    const result = await formatter.format(stream);
    assert.equal(result.name, 'no-host');
  });

  it('renders a conditional mirror label next to the resolution', async () => {
    const formatter = new CustomFormatter(
      '{stream.resolution}{stream.urlHost::exists[" • {stream.urlHost}"||""]}',
      '{stream.filename}',
      ctx as never
    );
    const result = await formatter.format(
      makeStream({
        parsedFile: {
          resolution: '1080p',
          audioChannels: [],
          visualTags: [],
          audioTags: [],
          languages: [],
          subtitles: [],
          seasons: [],
          episodes: [],
          editions: [],
        } as never,
      })
    );
    assert.equal(result.name, '1080p • mirror.example.com');
  });
});
