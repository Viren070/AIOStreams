import type { Server as HttpServer, IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import { randomUUID } from 'crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  accountScope,
  config as appConfig,
  createLogger,
  getWatchStateProvider,
  itemIdForWatchRow,
  personaUserId,
  readToken,
  userDataFromRow,
  type WatchScope,
} from '@aiostreams/core';
import { personaById, resolveConfig, verifyCredentials } from './context.js';

const logger = createLogger('jellyfin');

const MAX_SOCKETS_PER_USER = 16;
const MAX_SOCKETS_TOTAL = 50_000;
const KEEPALIVE_SECONDS = 60;

const SOCKET_PATH =
  /^\/jellyfin(?:\/([^/?]+)\/([^/?]+))?(?:\/v\/[^/?]+)?(?:\/(?:emby|mediabrowser))?\/(?:socket|websocket)(?:\?|$)/i;

interface SocketUser {
  /** The rows this socket follows. */
  scope: WatchScope;
  /** The id the client signed in as, stamped on every push so it keeps it. */
  userId: string;
}

function reject(socket: Duplex, status: number, text: string) {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

async function authenticateUpgrade(url: string): Promise<SocketUser | null> {
  const m = SOCKET_PATH.exec(url);
  if (!m) return null;
  const query = new URLSearchParams(url.split('?')[1] ?? '');
  const apiKey =
    query.get('api_key') ??
    query.get('ApiKey') ??
    query.get('apikey') ??
    query.get('token') ??
    '';
  let uuid: string | null = null;
  let encryptedPassword = '';
  let personaKey = '';
  if (apiKey) {
    const payload = readToken(apiKey);
    if (payload) {
      uuid = await verifyCredentials(payload.u, payload.p);
      encryptedPassword = payload.p;
      personaKey = payload.k ?? '';
    }
  }
  if (!uuid && m[1] && m[2]) {
    uuid = await verifyCredentials(decodeURIComponent(m[1]), m[2]);
    encryptedPassword = m[2];
  }
  if (!uuid) return null;
  if (!personaKey) {
    return { scope: accountScope(uuid), userId: personaUserId(uuid, '') };
  }
  const userData = await resolveConfig(uuid, encryptedPassword);
  const persona = userData ? personaById(userData, personaKey) : null;
  if (!persona) return null;
  return {
    scope:
      persona.history === 'shared'
        ? accountScope(uuid)
        : { uuid, persona: persona.id },
    userId: personaUserId(uuid, persona.id),
  };
}

function frame(MessageType: string, Data: unknown = null): string {
  return JSON.stringify({
    MessageType,
    MessageId: randomUUID().replace(/-/g, ''),
    Data,
  });
}

function scopeKey(scope: WatchScope): string {
  return `${scope.uuid}|${scope.persona}`;
}

/**
 * Keepalive plus `UserDataChanged` pushes for the connected history. Clients
 * treat the socket as optional, so nothing here is load-bearing.
 */
export function attachJellyfinWebSocket(server: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true });
  const byScope = new Map<string, Map<WebSocket, string>>();

  const send = (ws: WebSocket, type: string, data?: unknown) => {
    if (ws.readyState === ws.OPEN) ws.send(frame(type, data));
  };

  // Per configuration, or personas would multiply the cap.
  const socketsOf = (uuid: string): number => {
    let count = 0;
    for (const [key, sockets] of byScope) {
      if (key.startsWith(`${uuid}|`)) count += sockets.size;
    }
    return count;
  };

  getWatchStateProvider().onChange((scope, rows) => {
    const sockets = byScope.get(scopeKey(scope));
    if (!sockets?.size) return;
    const UserDataList = rows.map((row) => {
      const id = itemIdForWatchRow(row);
      return userDataFromRow(id, row, row.snapshot?.runtimeMs);
    });
    for (const [ws, userId] of sockets) {
      send(ws, 'UserDataChanged', { UserId: userId, UserDataList });
    }
  });

  wss.on(
    'connection',
    (ws: WebSocket, _req: IncomingMessage, user: SocketUser) => {
      const key = scopeKey(user.scope);
      let sockets = byScope.get(key);
      if (!sockets) {
        sockets = new Map();
        byScope.set(key, sockets);
      }
      sockets.set(ws, user.userId);
      send(ws, 'ForceKeepAlive', KEEPALIVE_SECONDS);
      const timer = setInterval(
        () => send(ws, 'ForceKeepAlive', KEEPALIVE_SECONDS),
        (KEEPALIVE_SECONDS * 1000) / 2
      );
      const release = () => {
        clearInterval(timer);
        const s = byScope.get(key);
        if (s) {
          s.delete(ws);
          if (!s.size) byScope.delete(key);
        }
      };
      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(String(raw)) as { MessageType?: string };
          if (msg.MessageType === 'KeepAlive') send(ws, 'KeepAlive');
        } catch {}
      });
      ws.on('close', release);
      ws.on('error', release);
    }
  );

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = req.url ?? '';
    if (!SOCKET_PATH.test(url)) return;
    if (!appConfig.jellyfin.enabled) {
      reject(socket, 404, 'Not Found');
      return;
    }
    void authenticateUpgrade(url)
      .then((user) => {
        if (socket.destroyed) return;
        if (!user) {
          reject(socket, 401, 'Unauthorized');
          return;
        }
        if (socketsOf(user.scope.uuid) >= MAX_SOCKETS_PER_USER) {
          reject(socket, 429, 'Too Many Requests');
          return;
        }
        if (wss.clients.size >= MAX_SOCKETS_TOTAL) {
          reject(socket, 503, 'Service Unavailable');
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit('connection', ws, req, user);
        });
      })
      .catch((error) => {
        logger.debug(
          { err: error instanceof Error ? error.message : String(error) },
          'websocket upgrade auth failed'
        );
        if (!socket.destroyed) reject(socket, 500, 'Internal Server Error');
      });
  });
  logger.debug('jellyfin websocket attached');
}
