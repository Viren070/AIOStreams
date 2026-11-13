import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanName } from './names.js';

describe('cleanName', () => {
  it('strips the leading tags providers use', () => {
    for (const name of [
      'UK | BBC One',
      'UK| BBC One',
      '|UK| BBC One',
      '|| UK || BBC One',
      '[UK] BBC One',
    ])
      assert.equal(cleanName(name), 'BBC One', name);
  });
  it('tidies spaces', () => {
    assert.equal(cleanName('  UK | BBC  One '), 'BBC One');
  });
  it('leaves names without a short leading tag alone', () => {
    for (const name of [
      'BBC One',
      'ESPN: Football',
      'Sky Sports | News HD',
      'BBC One | HD Backup',
    ])
      assert.equal(cleanName(name), name, name);
  });
  it('strips only the first tag', () => {
    assert.equal(cleanName('UK | BBC | News'), 'BBC | News');
  });
  it('keeps a name that is only a tag', () => {
    assert.equal(cleanName('[UK]'), '[UK]');
    assert.equal(cleanName('|UK|'), '|UK|');
  });
});
