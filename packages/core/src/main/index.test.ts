import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AIOStreams } from './index.js';

function engine(initialised: boolean, addons: object[]) {
  // Exercise the public diagnostic without initializing real addon/network resources.
  return Object.assign(Object.create(AIOStreams.prototype), {
    ctx: {
      isInitialised: initialised,
      addonInitialisationErrors: addons.map((addon) => ({
        addon,
        error: 'unavailable',
      })),
    },
  }) as AIOStreams;
}

test('initialization errors include failed presets as well as failed addon manifests', () => {
  const subject = engine(true, [
    { instanceId: 'generated-addon', preset: { id: 'manifest-preset' } },
    { instanceId: 'failed-preset' },
  ]);
  assert.equal(subject.hasAddonInitialisationErrors(), true);
  assert.equal(subject.hasAddonInitialisationErrors(['manifest-preset']), true);
  assert.equal(subject.hasAddonInitialisationErrors(['failed-preset']), true);
  assert.equal(
    subject.hasAddonInitialisationErrors(['generated-addon']),
    false
  );
  assert.equal(subject.hasAddonInitialisationErrors(['unrelated']), false);
  assert.equal(subject.hasAddonInitialisationErrors([]), false);
  assert.equal(engine(true, []).hasAddonInitialisationErrors(), false);
});

test('initialization error diagnostics require a completed initialization', () => {
  assert.throws(
    () => engine(false, []).hasAddonInitialisationErrors(),
    /not initialised/
  );
});
