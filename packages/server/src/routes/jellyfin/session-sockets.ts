import { randomUUID } from 'crypto';
import type { WebSocket } from 'ws';

/** One signed-in client: a user on a device. */
export function clientKey(userId: string, deviceId: string): string {
  return `${userId}|${deviceId.toLowerCase()}`;
}

export function frame(MessageType: string, Data: unknown = null): string {
  return JSON.stringify({
    MessageType,
    MessageId: randomUUID().replace(/-/g, ''),
    Data,
  });
}

const sockets = new Map<string, Set<WebSocket>>();
const offline = new Set<(key: string) => void>();

export function addClientSocket(key: string, ws: WebSocket): void {
  let set = sockets.get(key);
  if (!set) {
    set = new Set();
    sockets.set(key, set);
  }
  set.add(ws);
}

export function removeClientSocket(key: string, ws: WebSocket): void {
  const set = sockets.get(key);
  if (!set?.delete(ws) || set.size) return;
  sockets.delete(key);
  for (const listener of offline) listener(key);
}

export function clientOnline(key: string): boolean {
  return sockets.has(key);
}

/** Calls `listener` when a client's last socket closes. */
export function onClientOffline(listener: (key: string) => void): () => void {
  offline.add(listener);
  return () => void offline.delete(listener);
}

/** Pushes to every socket of the client; false when it has none. */
export function sendToClient(
  key: string,
  type: string,
  data?: unknown
): boolean {
  const set = sockets.get(key);
  if (!set) return false;
  const text = frame(type, data);
  for (const ws of set) if (ws.readyState === ws.OPEN) ws.send(text);
  return true;
}
