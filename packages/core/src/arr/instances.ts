import { appConfig } from '../utils/index.js';
import { ArrClient } from './client.js';
import type { ArrInstance } from './types.js';

/** Every configured, enabled instance, as clients. */
export function arrClients(): ArrClient[] {
  const instances = (appConfig.arr.instances ?? []) as ArrInstance[];
  return instances
    .filter((i) => i.enabled !== false && i.url && i.apiKey)
    .map((i) => new ArrClient(i));
}

/** Enabled instances that handle a download-client category. */
export function arrClientsFor(category?: string): ArrClient[] {
  return arrClients().filter((c) => c.handlesCategory(category));
}

export function arrClientById(id: string): ArrClient | undefined {
  return arrClients().find((c) => c.id === id);
}

export function arrConfigured(): boolean {
  return arrClients().length > 0;
}
