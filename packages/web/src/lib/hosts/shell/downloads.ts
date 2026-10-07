import type { DownloadsHost } from '../../downloads/types';

function send(message: { type: string; [key: string]: unknown }) {
  window.aiostreamsDesktop?.send(message);
}

/** The desktop app's download queue, which keeps going while the page reloads. */
export const shellDownloads: DownloadsHost = {
  add: (jobs) => send({ type: 'download-add', jobs }),
  control: (id, action) => send({ type: 'download-control', id, action }),
  remove: (id, files) => send({ type: 'download-remove', id, files }),
  list: () => send({ type: 'download-list' }),
  configure: ({ concurrent }) => send({ type: 'download-config', concurrent }),
  subscribe: (listener) =>
    window.aiostreamsDesktop?.subscribe((m) => {
      if (m.type === 'download-state')
        listener({ type: 'state', folder: m.folder, jobs: m.jobs });
      else if (m.type === 'download-progress')
        listener({
          type: 'progress',
          id: m.id,
          bytes: m.bytes,
          total: m.total,
          speed: m.speed,
        });
    }) ?? (() => {}),
  folder: {
    choose: () => send({ type: 'download-folder' }),
    open: (id) => send({ type: 'download-open', id: id ?? null }),
  },
};
