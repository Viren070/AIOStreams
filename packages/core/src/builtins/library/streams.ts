import {
  BuiltinServiceId,
  constants,
  encryptString,
} from '../../utils/index.js';
import {
  DebridDownload,
  DebridFile,
  FileInfo,
  generatePlaybackUrl,
} from '../../debrid/index.js';
import { Stream } from '../../db/schemas.js';

/**
 * Creates a library stream object with a playback URL for a specific file
 * within a debrid download item.
 */
export function createLibraryStream(
  item: DebridDownload,
  service: { id: BuiltinServiceId; credential: string },
  itemType: 'torrent' | 'usenet',
  fileIndex: number | undefined,
  file: DebridFile | undefined
): Stream {
  const serviceMeta = constants.SERVICE_DETAILS[service.id];
  const encryptedStoreAuth =
    encryptString(
      JSON.stringify({ id: service.id, credential: service.credential })
    ).data ?? '';

  const metadataId = 'catalog';

  const fileInfo: FileInfo =
    itemType === 'torrent'
      ? {
          type: 'torrent',
          hash: item.hash ?? '',
          sources: [],
          serviceItemId: item.id.toString(),
          fileIndex,
          cacheAndPlay: false,
          autoRemoveDownloads: false,
        }
      : {
          type: 'usenet',
          hash: item.hash ?? item.name ?? '',
          nzb: '', // no nzb needed, already on account.
          serviceItemId: item.id.toString(),
          fileIndex,
          cacheAndPlay: false,
          autoRemoveDownloads: false,
        };

  const fileName = file?.name ?? item.name ?? 'unknown';

  const url = generatePlaybackUrl(
    encryptedStoreAuth,
    metadataId,
    fileInfo,
    fileName
  );

  const shortCode = serviceMeta.shortName;
  const name = `🗃️ [⚡ ${shortCode}] Library `;
  const description = `${item.name ?? ''}\n${file?.name ?? ''}`;

  return {
    url,
    name,
    description,
    type: itemType === 'torrent' ? 'torrent' : 'usenet',
    fileIdx: file?.index,
    behaviorHints: {
      videoSize: file?.size,
      filename: file?.name,
      folderSize: item.size ?? undefined,
    },
  };
}
