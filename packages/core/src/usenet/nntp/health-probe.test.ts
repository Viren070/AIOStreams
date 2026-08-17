import assert from 'node:assert/strict';
import { once } from 'node:events';
import net from 'node:net';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { testUsenetProvider } from '../integration/dashboard/providers.js';
import { CommandPriority, type ProviderConfig } from '../types.js';
import { NntpConnection } from './connection.js';
import {
  ProviderWorkerPool,
  type WorkerPoolOptions,
} from './provider-worker-pool.js';

const HEALTHCHECK_COMMAND = 'STAT <aiostreams-healthcheck@invalid>';

interface FakeNntpServer {
  port: number;
  commands: string[];
  activeSockets: Set<net.Socket>;
  acceptedConnections: number;
  close: () => Promise<void>;
}

type CommandHandler = (command: string, socket: net.Socket) => void;

async function startFakeNntpServer(
  onCommand: CommandHandler
): Promise<FakeNntpServer> {
  const commands: string[] = [];
  const activeSockets = new Set<net.Socket>();
  let acceptedConnections = 0;

  const server = net.createServer((socket) => {
    acceptedConnections++;
    activeSockets.add(socket);
    socket.once('close', () => activeSockets.delete(socket));
    socket.setEncoding('utf8');

    // Let the client finish its connect callback and install its greeting reader.
    setImmediate(() => socket.write('201 fake nntp ready\r\n'));

    let buffered = '';
    socket.on('data', (chunk: string) => {
      buffered += chunk;
      for (;;) {
        const end = buffered.indexOf('\r\n');
        if (end === -1) break;
        const command = buffered.slice(0, end);
        buffered = buffered.slice(end + 2);
        commands.push(command);
        onCommand(command, socket);
      }
    });
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');

  return {
    port: address.port,
    commands,
    activeSockets,
    get acceptedConnections() {
      return acceptedConnections;
    },
    close: async () => {
      for (const socket of activeSockets) socket.destroy();
      if (!server.listening) return;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function reply(socket: net.Socket, code: number, message: string): void {
  socket.write(`${code} ${message}\r\n`);
}

function provider(
  port: number,
  overrides: Partial<ProviderConfig> = {}
): ProviderConfig {
  return {
    id: 'fake',
    host: '127.0.0.1',
    port,
    tls: false,
    maxConnections: 1,
    priority: 0,
    ...overrides,
  };
}

const CONNECTION_OPTIONS = {
  dialTimeoutMs: 1_000,
  idleConnectionMs: 1_000,
};

const WORKER_OPTIONS: WorkerPoolOptions = {
  ...CONNECTION_OPTIONS,
  circuitBreakerThreshold: 5,
  circuitBreakerCooldownMs: 1_000,
  pipelineDepth: 2,
  streamingPriority: 1,
};

async function waitFor(
  predicate: () => boolean,
  description: string,
  timeoutMs = 2_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(10);
  }
  assert.fail(`timed out waiting for ${description}`);
}

function runKeepalive(pool: ProviderWorkerPool): void {
  (pool as unknown as { keepalive: () => void }).keepalive();
}

function submitStat(pool: ProviderWorkerPool, messageId: string) {
  return pool.submit<boolean>({
    priority: CommandPriority.High,
    run: async (conn) => ({
      value: await conn.stat(messageId, undefined, 1_000),
      bytes: 0,
    }),
  });
}

test('reader probe accepts a missing article and leaves the connection reusable', async () => {
  const fake = await startFakeNntpServer((command, socket) => {
    if (command.startsWith('STAT ')) reply(socket, 430, 'no such article');
  });
  let conn: NntpConnection | undefined;

  try {
    conn = await NntpConnection.connect(
      provider(fake.port),
      CONNECTION_OPTIONS
    );
    await conn.probeReader(undefined, 1_000);
    assert.equal(
      await conn.stat('second@test.invalid', undefined, 1_000),
      false
    );
    assert.deepEqual(fake.commands.slice(0, 2), [
      HEALTHCHECK_COMMAND,
      'STAT <second@test.invalid>',
    ]);
    assert.equal(conn.isUsable, true);
  } finally {
    conn?.destroy();
    await fake.close();
  }
});

for (const { code, message } of [
  { code: 223, message: 'article exists' },
  { code: 423, message: 'no article with that number' },
] as const) {
  test(`reader probe accepts ${code}`, async () => {
    const fake = await startFakeNntpServer((command, socket) => {
      if (command.startsWith('STAT ')) reply(socket, code, message);
    });
    let conn: NntpConnection | undefined;

    try {
      conn = await NntpConnection.connect(
        provider(fake.port),
        CONNECTION_OPTIONS
      );
      await conn.probeReader(undefined, 1_000);
      assert.deepEqual(fake.commands, [HEALTHCHECK_COMMAND]);
      assert.equal(conn.isUsable, true);
    } finally {
      conn?.destroy();
      await fake.close();
    }
  });
}

test('dashboard provider test uses the reader probe after authentication', async () => {
  const fake = await startFakeNntpServer((command, socket) => {
    if (command.startsWith('AUTHINFO USER '))
      reply(socket, 381, 'password required');
    else if (command.startsWith('AUTHINFO PASS '))
      reply(socket, 281, 'authentication accepted');
    else if (command.startsWith('STAT ')) reply(socket, 430, 'no such article');
    else if (command === 'DATE') reply(socket, 400, 'DATE unavailable');
  });

  try {
    const result = await testUsenetProvider({
      ...provider(fake.port),
      username: 'test-user',
      password: 'test-password',
    });

    assert.equal(result.ok, true);
    assert.equal(typeof result.latencyMs, 'number');
    assert(fake.commands.includes(HEALTHCHECK_COMMAND));
    assert.equal(fake.commands.includes('DATE'), false);
  } finally {
    await fake.close();
  }
});

test('failed idle probe destroys the socket before the pool redials', async () => {
  const fake = await startFakeNntpServer((command, socket) => {
    if (command === HEALTHCHECK_COMMAND) reply(socket, 400, 'probe failed');
    else if (command.startsWith('STAT ')) reply(socket, 430, 'no such article');
    else if (command === 'DATE') reply(socket, 400, 'DATE unavailable');
  });
  const pool = new ProviderWorkerPool(provider(fake.port), WORKER_OPTIONS);

  try {
    await submitStat(pool, 'warmup@test.invalid');
    assert.equal(fake.acceptedConnections, 1);
    assert.equal(fake.activeSockets.size, 1);

    runKeepalive(pool);
    await waitFor(
      () => fake.activeSockets.size === 0,
      'failed probe socket close'
    );
    assert.equal(pool.info().total, 0);

    await submitStat(pool, 'replacement@test.invalid');
    assert.equal(fake.acceptedConnections, 2);
    assert.equal(fake.activeSockets.size, 1);
    assert.equal(pool.info().total, 1);
  } finally {
    pool.close();
    await fake.close();
  }
});

test('queued work waits for an idle probe instead of pipelining behind it', async () => {
  let probeSocket: net.Socket | undefined;
  const fake = await startFakeNntpServer((command, socket) => {
    if (command === HEALTHCHECK_COMMAND) {
      probeSocket = socket;
      return;
    }
    if (command.startsWith('STAT ')) reply(socket, 430, 'no such article');
  });
  const pool = new ProviderWorkerPool(provider(fake.port), WORKER_OPTIONS);

  try {
    await submitStat(pool, 'warmup@test.invalid');
    runKeepalive(pool);
    await waitFor(() => probeSocket !== undefined, 'reader probe command');
    assert.equal(
      pool.freeSlots,
      0,
      "a reader probe reserves the slot's full pipeline capacity"
    );

    const queued = submitStat(pool, 'after-probe@test.invalid');
    await delay(25);
    assert.equal(
      fake.commands.includes('STAT <after-probe@test.invalid>'),
      false,
      'real work was written while the idle probe still owned the slot'
    );

    reply(probeSocket!, 430, 'no such article');
    assert.equal((await queued).value, false);
    assert(fake.commands.includes('STAT <after-probe@test.invalid>'));
  } finally {
    pool.close();
    await fake.close();
  }
});
