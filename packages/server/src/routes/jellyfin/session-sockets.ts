import { randomUUID } from 'crypto';
import type { WebSocket } from 'ws';
import { sharedBackend } from '@aiostreams/core';

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

type Listener = (key: string) => void;

const sockets = new Map<string, Set<WebSocket>>();
const online = new Set<Listener>();
const offline = new Set<Listener>();

export function addClientSocket(key: string, ws: WebSocket): void {
  let set = sockets.get(key);
  if (!set) {
    set = new Set();
    sockets.set(key, set);
    sharedBackend().presence.add(key);
    for (const listener of online) listener(key);
  }
  set.add(ws);
}

export function removeClientSocket(key: string, ws: WebSocket): void {
  const set = sockets.get(key);
  if (!set?.delete(ws) || set.size) return;
  sockets.delete(key);
  sharedBackend().presence.remove(key);
  for (const listener of offline) listener(key);
}

/** Calls `listener` when a client's first socket on this replica opens. */
export function onClientOnline(listener: Listener): () => void {
  online.add(listener);
  return () => void online.delete(listener);
}

/** Calls `listener` when a client's last socket on this replica closes. */
export function onClientOffline(listener: Listener): () => void {
  offline.add(listener);
  return () => void offline.delete(listener);
}

/** Pushes a whole message to every socket the client has here. */
export function sendFrameToClient(key: string, text: Buffer): void {
  const set = sockets.get(key);
  if (!set) return;
  for (const ws of set)
    if (ws.readyState === ws.OPEN) ws.send(text, { binary: false });
}
