import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import '../index.js';
import { imageTagsFor, decodeImageTag } from './images.js';

describe('jellyfin images', () => {
  it('encodes image tags for valid HTTP and HTTPS URLs', () => {
    const tags = imageTagsFor({
      Primary: 'https://example.com/poster.jpg',
      Backdrop: 'http://example.com/fanart.jpg',
      Logo: 'https://example.com/logo.png',
      Thumb: 'https://example.com/thumb.jpg',
    });

    assert.ok(tags.ImageTags.Primary);
    assert.ok(tags.ImageTags.Logo);
    assert.ok(tags.ImageTags.Thumb);
    assert.equal(tags.BackdropImageTags.length, 1);

    assert.equal(
      decodeImageTag(tags.ImageTags.Primary!),
      'https://example.com/poster.jpg'
    );
    assert.equal(
      decodeImageTag(tags.BackdropImageTags[0]),
      'http://example.com/fanart.jpg'
    );
  });

  it('rejects non-HTTP placeholder strings from ImageTags', () => {
    const tags = imageTagsFor({
      Primary: '[redacted]',
      Backdrop: 'null',
      Logo: 'not-a-url',
      Thumb: '',
    });

    assert.equal(tags.ImageTags.Primary, undefined);
    assert.equal(tags.ImageTags.Logo, undefined);
    assert.equal(tags.ImageTags.Thumb, undefined);
    assert.deepEqual(tags.BackdropImageTags, []);
  });

  it('rejects malformed HTTP(S) values without a host from ImageTags', () => {
    const tags = imageTagsFor({
      Primary: 'http://',
      Backdrop: 'https://',
      Logo: 'http:// ',
      Thumb: 'https://:8080',
    });

    assert.equal(tags.ImageTags.Primary, undefined);
    assert.equal(tags.ImageTags.Logo, undefined);
    assert.equal(tags.ImageTags.Thumb, undefined);
    assert.deepEqual(tags.BackdropImageTags, []);
  });
});
