import type { ParsedStream } from '../db/schemas.js';
import { mergeParsedMediaInfos, parseMediaInfo } from '../utils/index.js';
import type { MediaInfoRecord } from './record.js';
import { toWireMediaInfo } from './wire.js';

/** Lay a probed file over a stream, keeping what the probe did not report. */
export function applyMediaInfo(
  stream: Pick<ParsedStream, 'parsedFile' | 'duration' | 'bitrate'>,
  record: MediaInfoRecord
): void {
  const merged = mergeParsedMediaInfos(
    stream.parsedFile,
    parseMediaInfo(toWireMediaInfo(record))
  );
  if (!merged) return;

  stream.parsedFile = {
    ...stream.parsedFile,
    ...merged,
    languages: merged.languages?.length
      ? merged.languages
      : (stream.parsedFile?.languages ?? []),
    subtitles: merged.subtitles?.length
      ? merged.subtitles
      : (stream.parsedFile?.subtitles ?? []),
    audioChannels: merged.audioChannels?.length
      ? merged.audioChannels
      : (stream.parsedFile?.audioChannels ?? []),
    visualTags: merged.visualTags?.length
      ? merged.visualTags
      : (stream.parsedFile?.visualTags ?? []),
    audioTags: merged.audioTags?.length
      ? merged.audioTags
      : (stream.parsedFile?.audioTags ?? []),
    hasChapters: merged.hasChapters ?? stream.parsedFile?.hasChapters,
    videoIndex: merged.videoIndex,
  };
  if (record.duration && !stream.duration) {
    stream.duration = record.duration * 1000;
  }
  if (record.bitrate && !stream.bitrate) {
    stream.bitrate = record.bitrate;
  }
}
