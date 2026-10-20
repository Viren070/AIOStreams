import React from 'react';
import { currentHost } from './hosts';
import { useRefreshWatchState } from './queries';
import { REMOTE_CAPABILITIES } from './remote/capabilities';
import { commandOf, sendRemote, type RemoteCommand } from './remote/commands';
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

/** Browser tabs share a device id, so only the one in view opens what is sent. */
const ignored = (command: RemoteCommand) =>
  currentHost().name === 'browser' &&
  document.hidden &&
  (command.kind === 'show' || command.kind === 'play');

/**
 * Refreshes watch state when the server pushes a change made elsewhere, once
 * nothing plays, and hands on what other devices send.
 */
export function useServerEvents(playing: boolean): void {
  const { client } = useSession();
  const refresh = useLatest(useRefreshWatchState());
  const isPlaying = useLatest(playing);
  const held = React.useRef(false);
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
        // Servers keep what a device can do only while its socket is open.
        void client
          .post('/Sessions/Capabilities/Full', REMOTE_CAPABILITIES)
          .catch(() => {});
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
          if (isPlaying.current) return void (held.current = true);
          clearTimeout(settle);
          settle = setTimeout(() => void refresh.current(), SETTLE_MS);
        } else {
          const command = commandOf(message.MessageType, message.Data);
          if (command && !ignored(command)) sendRemote(command);
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
  }, [client, refresh, isPlaying]);

  React.useEffect(() => {
    if (playing || !held.current) return;
    held.current = false;
    void refresh.current();
  }, [playing, refresh]);
}
