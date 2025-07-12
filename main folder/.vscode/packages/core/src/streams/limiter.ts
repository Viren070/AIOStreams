import { ParsedStream, UserData } from '../db/schemas';
import { createLogger, getTimeTakenSincePoint } from '../utils';

const logger = createLogger('limiter');

class StreamLimiter {
  private userData: UserData;

  constructor(userData: UserData) {
    this.userData = userData;
  }

  public async limit(streams: ParsedStream[]): Promise<ParsedStream[]> {
    if (!this.userData.resultLimits) {
      return streams;
    }

    // these are our limits
    const {
      indexer,
      releaseGroup,
      resolution,
      quality,
      global,
      addon,
      streamType,
      service,
    } = this.userData.resultLimits;

    const start = Date.now();

    // Track counts for each category
    const counts = {
      indexer: new Map<string, number>(),
      releaseGroup: new Map<string, number>(),
      resolution: new Map<string, number>(),
      quality: new Map<string, number>(),
      addon: new Map<string, number>(),
      streamType: new Map<string, number>(),
      service: new Map<string, number>(),
      global: 0,
    };

    // Keep track of which indexes to remove
    const indexesToRemove = new Set<number>();

    // Process each stream and check against limits
    streams.forEach((stream, index) => {
      // Skip if already marked for removal
      if (indexesToRemove.has(index)) return;

      // Check global limit first
      if (global && counts.global >= global) {
        indexesToRemove.add(index);
        return;
      }

      // Check indexer limit
      if (indexer && stream.indexer) {
        const count = counts.indexer.get(stream.indexer) || 0;
        if (count >= indexer) {
          indexesToRemove.add(index);
          return;
        }
        counts.indexer.set(stream.indexer, count + 1);
      }

      // Check release group limit
      if (releaseGroup && stream.parsedFile?.releaseGroup) {
        const count =
          counts.releaseGroup.get(stream.parsedFile?.releaseGroup || '') || 0;
        if (count >= releaseGroup) {
          indexesToRemove.add(index);
          return;
        }
        counts.releaseGroup.set(stream.parsedFile.releaseGroup, count + 1);
      }

      // Check resolution limit
      if (resolution) {
        const count =
          counts.resolution.get(stream.parsedFile?.resolution || 'Unknown') ||
          0;
        if (count >= resolution) {
          indexesToRemove.add(index);
          return;
        }
        counts.resolution.set(
          stream.parsedFile?.resolution || 'Unknown',
          count + 1
        );
      }

      // Check quality limit
      if (quality) {
        const count =
          counts.quality.get(stream.parsedFile?.quality || 'Unknown') || 0;
        if (count >= quality) {
          indexesToRemove.add(index);
          return;
        }
        counts.quality.set(stream.parsedFile?.quality || 'Unknown', count + 1);
      }

      // Check addon limit
      if (addon) {
        const count = counts.addon.get(stream.addon.presetInstanceId) || 0;
        if (count >= addon) {
          indexesToRemove.add(index);
          return;
        }
        counts.addon.set(stream.addon.presetInstanceId, count + 1);
      }

      // Check stream type limit
      if (streamType && stream.type) {
        const count = counts.streamType.get(stream.type) || 0;
        if (count >= streamType) {
          indexesToRemove.add(index);
          return;
        }
        counts.streamType.set(stream.type, count + 1);
      }

      // Check service limit
      if (service && stream.service?.id) {
        const count = counts.service.get(stream.service.id) || 0;
        if (count >= service) {
          indexesToRemove.add(index);
          return;
        }
        counts.service.set(stream.service.id, count + 1);
      }

      // If we got here, increment global count
      counts.global++;
    });

    // Filter out the streams that exceeded limits
    const limitedStreams = streams.filter(
      (_, index) => !indexesToRemove.has(index)
    );

    // Log summary of removed streams
    const removedCount = streams.length - limitedStreams.length;
    if (removedCount > 0) {
      logger.info(
        `Removed ${removedCount} streams due to limits in ${getTimeTakenSincePoint(start)}`
      );
    }

    return limitedStreams;
  }
}

export default StreamLimiter;
