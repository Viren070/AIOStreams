import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
// Load the core entry point first; the config, db and service modules import each other.
import '../index.js';
import { ParentChangePusher, type ParentPushDeps } from './parent-push.js';

const DELAY = 30_000;

function setup(overrides: Partial<ParentPushDeps> = {}) {
  const pushed: string[] = [];
  const tree: Record<string, string[]> = { p: ['a', 'b'], q: [] };
  const links: Record<string, string[]> = { a: ['a1'], b: ['b1', 'b2'] };
  const deps: ParentPushDeps = {
    enabled: () => true,
    delayMs: () => DELAY,
    maxLinks: () => 100,
    targets: async (parent, _depth, limit) =>
      (tree[parent] ?? [])
        .flatMap((uuid) => (links[uuid] ?? []).map((id) => ({ uuid, id })))
        .slice(0, limit),
    pushIfChanged: async (uuid, id) => {
      pushed.push(`${uuid}/${id}`);
      return { outcomes: [] };
    },
    ...overrides,
  };
  return { pusher: new ParentChangePusher(deps), pushed };
}

async function elapse(pusher: ParentChangePusher, ms: number) {
  mock.timers.tick(ms);
  await pusher.idle();
}

describe('ParentChangePusher', () => {
  beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }));
  afterEach(() => mock.timers.reset());

  it('pushes every opted-in link of the descendants after the delay', async () => {
    const { pusher, pushed } = setup();
    pusher.saved('p');
    await elapse(pusher, DELAY - 1);
    assert.deepEqual(pushed, []);
    await elapse(pusher, 1);
    assert.deepEqual(pushed, ['a/a1', 'b/b1', 'b/b2']);
  });

  it('handles saves within the delay once, timed from the last one', async () => {
    const { pusher, pushed } = setup();
    pusher.saved('p');
    await elapse(pusher, DELAY - 1);
    pusher.saved('p');
    await elapse(pusher, DELAY - 1);
    assert.deepEqual(pushed, []);
    await elapse(pusher, 1);
    assert.deepEqual(pushed, ['a/a1', 'b/b1', 'b/b2']);
  });

  it('does nothing for a configuration nobody inherits from', async () => {
    const { pusher, pushed } = setup();
    pusher.saved('q');
    await elapse(pusher, DELAY);
    assert.deepEqual(pushed, []);
  });

  it('pushes at most maxLinks links', async () => {
    const { pusher, pushed } = setup({ maxLinks: () => 2 });
    pusher.saved('p');
    await elapse(pusher, DELAY);
    assert.deepEqual(pushed, ['a/a1', 'b/b1']);
  });

  it('carries on past a link that fails', async () => {
    const pushed: string[] = [];
    const { pusher } = setup({
      pushIfChanged: async (uuid, id) => {
        pushed.push(`${uuid}/${id}`);
        if (id === 'b1') throw new Error('platform refused');
        return null;
      },
    });
    pusher.saved('p');
    await elapse(pusher, DELAY);
    assert.deepEqual(pushed, ['a/a1', 'b/b1', 'b/b2']);
  });

  it('ignores saves while linked accounts are disabled', async () => {
    const { pusher, pushed } = setup({ enabled: () => false });
    pusher.saved('p');
    await elapse(pusher, DELAY);
    assert.deepEqual(pushed, []);
  });

  it('keeps working after a run fails unexpectedly', async () => {
    let calls = 0;
    const { pusher, pushed } = setup({
      maxLinks: () => {
        if (calls++ === 0) throw new Error('config unavailable');
        return 100;
      },
    });
    pusher.saved('p');
    await elapse(pusher, DELAY);
    assert.deepEqual(pushed, []);
    pusher.saved('p');
    await elapse(pusher, DELAY);
    assert.deepEqual(pushed, ['a/a1', 'b/b1', 'b/b2']);
  });

  it('drops pending work when stopped', async () => {
    const { pusher, pushed } = setup();
    pusher.saved('p');
    pusher.stop();
    await elapse(pusher, DELAY);
    assert.deepEqual(pushed, []);
  });
});
