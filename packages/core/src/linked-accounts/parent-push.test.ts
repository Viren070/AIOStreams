import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
// Load the core entry point first; the config, db and service modules import each other.
import '../index.js';
import { ParentChangePusher, type ParentPushDeps } from './parent-push.js';

const DELAY = 30_000;
// a1 fetches three manifests, so the pause after it is three times as long.
const SPACED = [
  'a/a1',
  'sleep 6000',
  'b/b1',
  'sleep 2000',
  'b/b2',
  'sleep 2000',
];

function setup(overrides: Partial<ParentPushDeps> = {}) {
  const pushed: string[] = [];
  const tree: Record<string, string[]> = { p: ['a', 'b'], q: [] };
  const links: Record<string, string[]> = { a: ['a1'], b: ['b1', 'b2'] };
  const deps: ParentPushDeps = {
    enabled: () => true,
    delayMs: () => DELAY,
    maxLinks: () => 100,
    spacingMs: () => 2000,
    sleep: async (ms) => {
      pushed.push(`sleep ${ms}`);
    },
    targets: async (parent, limit) =>
      (tree[parent] ?? [])
        .flatMap((uuid) =>
          (links[uuid] ?? []).map((id) => ({
            uuid,
            id,
            urls: id === 'a1' ? 3 : 1,
          }))
        )
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
    assert.deepEqual(pushed, SPACED);
  });

  it('handles saves within the delay once, timed from the last one', async () => {
    const { pusher, pushed } = setup();
    pusher.saved('p');
    await elapse(pusher, DELAY - 1);
    pusher.saved('p');
    await elapse(pusher, DELAY - 1);
    assert.deepEqual(pushed, []);
    await elapse(pusher, 1);
    assert.deepEqual(pushed, SPACED);
  });

  it('queues one more run however often a parent is saved during a run', async () => {
    let resume!: () => void;
    const paused = new Promise<void>((resolve) => (resume = resolve));
    const { pusher, pushed } = setup({ sleep: () => paused });
    pusher.saved('p');
    mock.timers.tick(DELAY);
    // Let the run start; it waits in its first pause.
    await new Promise((resolve) => setImmediate(resolve));
    for (let i = 0; i < 3; i++) {
      pusher.saved('p');
      mock.timers.tick(DELAY);
    }
    resume();
    await pusher.idle();
    const run = ['a/a1', 'b/b1', 'b/b2'];
    assert.deepEqual(pushed, [...run, ...run]);
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
    assert.deepEqual(pushed, ['a/a1', 'sleep 6000', 'b/b1', 'sleep 2000']);
  });

  it('spaces the first push of a run from the last push of the one before', async () => {
    const { pusher, pushed } = setup({
      targets: async (parent) =>
        parent === 'p'
          ? [{ uuid: 'a', id: 'a1', urls: 3 }]
          : [{ uuid: 'c', id: 'c1', urls: 1 }],
    });
    pusher.saved('p');
    pusher.saved('q');
    await elapse(pusher, DELAY);
    assert.deepEqual(pushed, ['a/a1', 'sleep 6000', 'c/c1', 'sleep 2000']);
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
    assert.deepEqual(pushed, SPACED);
  });

  it('drops pending work when stopped', async () => {
    const { pusher, pushed } = setup();
    pusher.saved('p');
    pusher.stop();
    await elapse(pusher, DELAY);
    assert.deepEqual(pushed, []);
  });

  it('waits rather than pushing at once when the delay is too long for a timer', async () => {
    // Real timers: Node runs a longer timeout after 1ms, which the mock does not.
    mock.timers.reset();
    const { pusher, pushed } = setup({ delayMs: () => 2 ** 31 });
    pusher.saved('p');
    await new Promise((resolve) => setTimeout(resolve, 20));
    await pusher.idle();
    pusher.stop();
    assert.deepEqual(pushed, []);
  });
});
