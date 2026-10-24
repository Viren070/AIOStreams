import type { Server as HttpServer, IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  config as appConfig,
  createLogger,
  extractAuth,
  getWatchStateProvider,
  itemIdForWatchRow,
  userDataFromRow,
  type WatchScope,
} from '@aiostreams/core';
import {
  resolveAddressCode,
  resolvePickerAlias,
  userForToken,
} from './context.js';
import {
  addClientSocket,
  clientKey,
  frame,
  removeClientSocket,
} from './session-sockets.js';

const logger = createLogger('jellyfin');

const MAX_SOCKETS_PER_USER = 16;
const MAX_SOCKETS_TOTAL = 50_000;
const KEEPALIVE_SECONDS = 60;

const SOCKET_PATH =
  /^\/jellyfin(?:\/([^/?]+)\/([^/?]+))?(?:\/(?:emby|mediabrowser))?\/(?:socket|websocket)(?:\?|$)/i;

interface SocketUser {
  /** The rows this socket follows. */
  scope: WatchScope;
  /** The id the client signed in as, stamped on every push so it keeps it. */
  userId: string;
  deviceId: string;
}

function reject(socket: Duplex, status: number, text: string) {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

/** The configuration a mount names, as the HTTP routes find it. */
async function mountUuid(
  first: string,
  second: string
): Promise<string | null> {
  const kind = first.toLowerCase();
  const value = decodeURIComponent(second);
  if (kind === 'u') return (await resolvePickerAlias(value))?.uuid ?? null;
  if (kind === 'p') return (await resolveAddressCode(value))?.uuid ?? null;
  return decodeURIComponent(first);
}

async function authenticateUpgrade(
  req: IncomingMessage
): Promise<SocketUser | null> {
  const url = req.url ?? '';
  const m = SOCKET_PATH.exec(url);
  if (!m) return null;
  const query = new URLSearchParams(url.split('?')[1] ?? '');
  const { token } = extractAuth({
    header: (name) => {
      const value = req.headers[name];
      return Array.isArray(value) ? value[0] : value;
    },
    query: Object.fromEntries(query),
  });
  const apiKey = token ?? query.get('token') ?? '';
  // Nothing here pushes sessions; a tool polls /Sessions once its socket fails.
  const user = apiKey ? await userForToken(apiKey) : null;
  if (!user) return null;
  if (m[1] && m[2]) {
    const mount = await mountUuid(m[1], m[2]);
    if (mount?.toLowerCase() !== user.payload.u.toLowerCase()) return null;
  }
  return {
    scope: user.watch,
    userId: user.userId,
    deviceId: query.get('deviceId') ?? user.payload.d ?? '',
  };
}

function scopeKey(scope: WatchScope): string {
  return `${scope.uuid}|${scope.persona}`;
}

/**
 * Keepalive, `UserDataChanged` pushes for the connected history, and SyncPlay's
 * pushes to each client (see session-sockets).
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
      const client = clientKey(user.userId, user.deviceId);
      addClientSocket(client, ws);
      send(ws, 'ForceKeepAlive', KEEPALIVE_SECONDS);
      const timer = setInterval(
        () => send(ws, 'ForceKeepAlive', KEEPALIVE_SECONDS),
        (KEEPALIVE_SECONDS * 1000) / 2
      );
      const release = () => {
        clearInterval(timer);
        removeClientSocket(client, ws);
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
    void authenticateUpgrade(req)
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
