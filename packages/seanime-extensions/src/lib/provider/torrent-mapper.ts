import { AIOStreamsSearchApiResult } from '../aiostreams';

export type ResultFormat = 'filename' | 'formatter';

export function toAnimeTorrent(
  result: AIOStreamsSearchApiResult,
  resultFormat: ResultFormat
): AnimeTorrent {
  const date = toISODateFromHours(result.age);

  let name = result.folderName ?? result.filename ?? '';
  if (resultFormat === 'formatter') {
    name = [result.name, result.description].filter(Boolean).join('\n');
  }

  return {
    name,
    date,
    size: result.size ?? 0,
    seeders: result.seeders ?? 0,
    leechers: 0,
    downloadCount: 0,
    formattedSize: '',
    link: result.url ?? '',
    magnetLink: buildMagnetLink(result) ?? undefined,
    infoHash: result.infoHash ?? undefined,
    resolution: result.parsedFile?.resolution,
    episodeNumber: result.parsedFile?.episodes?.length
      ? Number(result.parsedFile.episodes[0])
      : -1,
    releaseGroup: result.parsedFile?.releaseGroup,
    isBestRelease: result.seadexBest ?? false,
    isBatch: result.parsedFile?.seasonPack ?? false,
    confirmed: true,
  };
}

export function buildMagnetLink(
  result: AIOStreamsSearchApiResult
): string | null {
  if (!result.infoHash) return null;

  let magnet = `magnet:?xt=urn:btih:${result.infoHash}`;

  const torrentName = result.folderName ?? result.filename;
  if (torrentName) {
    magnet += `&dn=${encodeURIComponent(torrentName)}`;
  }

  if (result.sources) {
    result.sources.forEach((source) => {
      magnet += `&tr=${encodeURIComponent(source)}`;
    });
  }

  return magnet;
}

function toISODateFromHours(ageHours: number | null): string {
  if (!ageHours) {
    return new Date().toISOString();
  }

  const ageMs = ageHours * 60 * 60 * 1000;
  return new Date(Date.now() - ageMs).toISOString();
}
