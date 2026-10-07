import React from 'react';
import { useRefreshWatchState } from './queries';
import { useSession } from './session';
import { useLatest } from './use-latest';

const RETRY_MS = [2_000, 5_000, 15_000, 60_000];
const SETTLE_MS = 1_000;

function socketUrl(base: string, token: string, deviceId: string): string {
  const url = new URL(`${base}/socket`);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('api_key', token);
  url.searchParams.set('deviceId', deviceId);
  return url.toString();
}

/** Refreshes watch state when the server pushes a change made elsewhere. */
export function useServerEvents(): void {
  const { client } = useSession();
  const refresh = useLatest(useRefreshWatchState());
  React.useEffect(() => {
    const token = client.token;
    if (!token) return;
    let socket: WebSocket | undefined;
    let closed = false;
    let failures = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let settle: ReturnType<typeof setTimeout> | undefined;
    let keepAlive: ReturnType<typeof setInterval> | undefined;

    const connect = () => {
      const ws = new WebSocket(socketUrl(client.base, token, client.deviceId));
      socket = ws;
      ws.onopen = () => {
        failures = 0;
      };
      ws.onmessage = (event) => {
        let message: { MessageType?: string; Data?: unknown };
        try {
          message = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (message.MessageType === 'ForceKeepAlive') {
          // The server closes a socket that stays quiet for longer than this.
          const seconds = Number(message.Data) || 60;
          clearInterval(keepAlive);
          keepAlive = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN)
              ws.send(JSON.stringify({ MessageType: 'KeepAlive' }));
          }, seconds * 500);
        } else if (message.MessageType === 'UserDataChanged') {
          clearTimeout(settle);
          settle = setTimeout(() => void refresh.current(), SETTLE_MS);
        }
      };
      ws.onclose = () => {
        clearInterval(keepAlive);
        if (closed) return;
        const wait = RETRY_MS[Math.min(failures++, RETRY_MS.length - 1)];
        retry = setTimeout(connect, wait);
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      clearTimeout(settle);
      clearInterval(keepAlive);
      socket?.close();
    };
  }, [client, refresh]);
}
