import { AIOStreamsSearchApiResult } from '../../../lib/aiostreams';
import { buildMagnetLink } from '../../../lib/aiostreams-resolver';
import { StreamResult } from '../types';

export function toStreamResult(r: AIOStreamsSearchApiResult): StreamResult {
  return {
    infoHash: r.infoHash ?? null,
    url: r.url ?? null,
    externalUrl: r.externalUrl ?? null,
    seeders: r.seeders ?? null,
    size: r.size ?? null,
    name: r.name ?? null,
    description: r.description ?? null,
    service: r.service ?? null,
    cached: r.cached ?? null,
    filename: r.filename ?? null,
    folderName: r.folderName ?? null,
    resolution: r.parsedFile?.resolution ?? null,
    releaseGroup: r.parsedFile?.releaseGroup ?? null,
    addon: r.addon ?? null,
    indexer: r.indexer ?? null,
    type: r.type,
    seadexBest: r.seadexBest ?? null,
    magnetLink: buildMagnetLink(r),
    fileIdx: r.fileIdx ?? null,
    bingeGroup: r.bingeGroup ?? null,
  };
}
