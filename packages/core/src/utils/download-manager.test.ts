import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { describe, it } from 'node:test';
import {
  downloadManager,
  InvalidNzbPayloadError,
  assertLikelyNzbPayload,
} from './download-manager.js';

const SIMPLE_NZB = Buffer.from(
  '<?xml version="1.0" encoding="UTF-8"?><nzb></nzb>',
  'utf8'
);

const VALID_NZB = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<nzb xmlns="http://www.newzbin.com/DTD/2003/nzb">
  <file poster="poster" date="1" subject="&quot;video.mkv&quot; yEnc (1/1)">
    <groups><group>alt.binaries.test</group></groups>
    <segments><segment bytes="10" number="1">part@example.test</segment></segments>
  </file>
</nzb>`);

describe('assertLikelyNzbPayload', () => {
  for (const contentType of [
    'application/x-nzb',
    'application/octet-stream',
    'text/plain',
    '',
  ]) {
    it(`accepts an NZB served as ${contentType || 'no content type'}`, () => {
      assert.doesNotThrow(() =>
        assertLikelyNzbPayload(contentType, SIMPLE_NZB)
      );
    });
  }

  it('accepts a BOM, whitespace, XML declaration, and namespaced root', () => {
    const body = Buffer.from(
      '\uFEFF  \n\t<?xml version="1.0"?>\n<NZB xmlns="http://www.newzbin.com/DTD/2003/nzb"><head /></NZB>',
      'utf8'
    );
    assert.doesNotThrow(() => assertLikelyNzbPayload('application/xml', body));
  });

  it('accepts comments and an NZB doctype before the document root', () => {
    const body = Buffer.from(
      '<?xml version="1.0"?><!-- generated --><!DOCTYPE nzb PUBLIC "-//newzBin//DTD NZB 1.1//EN" "http://www.newzbin.com/DTD/nzb/nzb-1.1.dtd"><nzb></nzb>'
    );
    assert.doesNotThrow(() => assertLikelyNzbPayload('application/xml', body));
  });

  it('rejects an empty body with the typed payload error', () => {
    assert.throws(
      () => assertLikelyNzbPayload('application/x-nzb', Buffer.alloc(0)),
      (error: unknown) => {
        assert.ok(error instanceof InvalidNzbPayloadError);
        assert.equal(error.name, 'InvalidNzbPayloadError');
        assert.equal(error.message, 'grab response is not an NZB document');
        assert.equal(error.contentType, 'application/x-nzb');
        assert.equal(error.bytes, 0);
        return true;
      }
    );
  });

  it('rejects text/html even when the body contains an NZB tag', () => {
    assert.throws(
      () => assertLikelyNzbPayload('text/html; charset=utf-8', SIMPLE_NZB),
      InvalidNzbPayloadError
    );
  });

  it('rejects an HTML doctype served with a generic content type', () => {
    assert.throws(
      () =>
        assertLikelyNzbPayload(
          'application/octet-stream',
          Buffer.from('<!DOCTYPE html><html><body>Login</body></html>')
        ),
      InvalidNzbPayloadError
    );
  });

  it('rejects an HTML root without a content type', () => {
    assert.throws(
      () =>
        assertLikelyNzbPayload(
          '',
          Buffer.from('  <HtMl lang="en"><body>Challenge</body></HtMl>')
        ),
      InvalidNzbPayloadError
    );
  });

  for (const root of ['error', 'rss']) {
    it(`rejects XML with a non-NZB ${root} root`, () => {
      assert.throws(
        () =>
          assertLikelyNzbPayload(
            'application/xml',
            Buffer.from(`<?xml version="1.0"?><${root}></${root}>`)
          ),
        InvalidNzbPayloadError
      );
    });
  }

  it('rejects an NZB element nested under a non-NZB document root', () => {
    assert.throws(
      () =>
        assertLikelyNzbPayload(
          'application/xml',
          Buffer.from('<?xml version="1.0"?><error><nzb></nzb></error>')
        ),
      InvalidNzbPayloadError
    );
  });

  it('only sniffs the first 64 KiB for the NZB root', () => {
    const body = Buffer.concat([
      Buffer.alloc(64 * 1024, 0x20),
      Buffer.from('<nzb></nzb>'),
    ]);
    assert.throws(
      () => assertLikelyNzbPayload('application/octet-stream', body),
      InvalidNzbPayloadError
    );
  });
});

describe('DownloadManager NZB cache admission', () => {
  it('does not cache a 200 HTML response and does cache a valid NZB', async () => {
    const nonce = randomUUID();
    const htmlPath = `/html-${nonce}`;
    const nestedPath = `/nested-${nonce}`;
    const validPath = `/valid-${nonce}`;
    const requests = new Map<string, number>();
    const server = createServer((req, res) => {
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
      requests.set(pathname, (requests.get(pathname) ?? 0) + 1);
      if (pathname === htmlPath) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><html><body>Login required</body></html>');
        return;
      }
      if (pathname === nestedPath) {
        res.writeHead(200, { 'Content-Type': 'application/xml' });
        res.end('<error><nzb></nzb></error>');
        return;
      }
      if (pathname === validPath) {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
        res.end(VALID_NZB);
        return;
      }
      res.writeHead(404).end();
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const htmlUrl = `${baseUrl}${htmlPath}`;
    const nestedUrl = `${baseUrl}${nestedPath}`;
    const validUrl = `${baseUrl}${validPath}`;

    try {
      await assert.rejects(
        downloadManager.fetchNzb(htmlUrl),
        InvalidNzbPayloadError
      );
      await assert.rejects(
        downloadManager.fetchNzb(htmlUrl),
        InvalidNzbPayloadError
      );
      assert.equal(requests.get(htmlPath), 2);

      await assert.rejects(
        downloadManager.fetchNzb(nestedUrl),
        InvalidNzbPayloadError
      );
      await assert.rejects(
        downloadManager.fetchNzb(nestedUrl),
        InvalidNzbPayloadError
      );
      assert.equal(requests.get(nestedPath), 2);

      assert.deepEqual(await downloadManager.fetchNzb(validUrl), VALID_NZB);
      assert.deepEqual(await downloadManager.fetchNzb(validUrl), VALID_NZB);
      assert.equal(requests.get(validPath), 1);
    } finally {
      await downloadManager.invalidateNzb(htmlUrl);
      await downloadManager.invalidateNzb(nestedUrl);
      await downloadManager.invalidateNzb(validUrl);
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
