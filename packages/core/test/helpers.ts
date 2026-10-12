import type { TestContext } from 'node:test';
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { settingsStore } from '../src/config/index.js';
import { SettingsRepository } from '../src/db/repositories/settings.js';
import type { StreamContext } from '../src/streams/context.js';

export async function initialiseTestSettings(t: TestContext) {
  t.mock.method(SettingsRepository, 'getAll', async () => []);
  t.mock.method(SettingsRepository, 'getVersion', async () => 0);
  await settingsStore.initialise();
}

export function mockHttp(t: TestContext) {
  const previous = getGlobalDispatcher();
  const agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  t.after(async () => {
    setGlobalDispatcher(previous);
    await agent.close();
  });
  return agent;
}

export function createTestStreamContext(overrides: Record<string, unknown>) {
  return {
    getEpisodeRuntime: async () => undefined,
    getReleaseDates: async () => undefined,
    getEpisodeAirDate: async () => undefined,
    getPermittedPatterns: async () => ({
      permitted: new Set<string>(),
      unrestricted: true,
    }),
    toExpressionContext: () => ({}),
    ...overrides,
  } as unknown as StreamContext;
}
