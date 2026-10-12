import { appBridge } from './bridge';

const WAIT_MS = 20_000;
let requests = 0;

export function resolveYouTube(id: string): Promise<string | null> {
  const bridge = appBridge();
  if (!bridge) return Promise.resolve(null);
  const request = String(++requests);
  return new Promise((resolve) => {
    const done = (url: string | null) => {
      clearTimeout(timer);
      unsubscribe();
      resolve(url);
    };
    const timer = setTimeout(() => done(null), WAIT_MS);
    const unsubscribe = bridge.subscribe((m) => {
      if (m.type === 'youtube-resolved' && m.request === request) done(m.url);
    });
    bridge.send({ type: 'youtube-resolve', request, id });
  });
}
