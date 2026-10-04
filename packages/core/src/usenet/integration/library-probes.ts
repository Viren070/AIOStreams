import {
  UsenetLibraryRepository,
  usenetLibraryBus,
  type UsenetLibraryOrigin,
} from '../../db/index.js';
import { featureFiles } from '../../debrid/utils.js';
import { probesOn, queueEngineProbe } from '../../media-info/play.js';
import { libraryFileToken } from './library.js';

/** Probe every file of a library entry, so its versions list real tracks. */
export async function queueLibraryProbes(nzbHash: string): Promise<void> {
  if (!probesOn('library')) return;
  const entry = await UsenetLibraryRepository.get(nzbHash).catch(
    () => undefined
  );
  if (!entry?.nzbUrl || entry.status === 'failed') return;
  for (const file of featureFiles(entry.files)) {
    await queueEngineProbe(libraryFileToken(entry, file), 'library');
  }
}

// A manual add is probed whole at once; arr imports run their own ffprobe.
usenetLibraryBus.on(
  'imported',
  ({ nzbHash, origin }: { nzbHash: string; origin: UsenetLibraryOrigin }) => {
    if (origin === 'dashboard') void queueLibraryProbes(nzbHash);
  }
);
