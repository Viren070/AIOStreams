import path from 'node:path';
import { JsonFileHandleStore, NfsServer } from '@viren070/fsmux';
import {
  config as appConfig,
  createLogger,
  shareFilesystem,
} from '@aiostreams/core';

const logger = createLogger('nfs');

let server: NfsServer | undefined;
let handleStore: JsonFileHandleStore | undefined;

/** Beside the SQLite database when there is one, else `./data`. */
function dataDir(): string {
  const uri = appConfig.bootstrap.databaseUri;
  if (uri.startsWith('sqlite://')) {
    return path.dirname(path.resolve(uri.slice('sqlite://'.length)));
  }
  return path.resolve('data');
}

export async function startNfsShare(): Promise<void> {
  const cfg = appConfig.shares.nfs;
  if (!cfg.enabled) return;
  handleStore = new JsonFileHandleStore(
    path.join(dataDir(), 'nfs-handles.json')
  );
  const restored = await handleStore.load().catch((err) => {
    logger.warn(
      { err },
      'could not read stored nfs filehandles; clients will re-walk paths'
    );
    return 0;
  });
  server = new NfsServer({
    fs: shareFilesystem({ owner: cfg.owner, scope: 'library' }),
    port: cfg.port,
    host: cfg.bindAddress,
    allowedClients: cfg.allowedClients
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    handleStore,
    logger,
  });
  await server.listen();
  logger.info(
    { port: cfg.port, restoredHandles: restored },
    'nfs share started'
  );
}

export async function stopNfsShare(): Promise<void> {
  await server?.close();
  server = undefined;
  await handleStore?.close();
  handleStore = undefined;
}
