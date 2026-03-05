import { ParsedStream, UserData } from '../db/schemas.js';
import { createLogger, getTimeTakenSincePoint } from '../utils/index.js';
import { shouldPassthroughStage } from './utils.js';

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

    const {
      indexer,
      releaseGroup,
      resolution,
      quality,
      global,
      addon,
      streamType,
      service,
      mode,
    } = this.userData.resultLimits;

    const start = Date.now();

    const isConjunctive = mode === 'conjunctive';

    // Keep track of which indexes to remove
    const indexesToRemove = new Set<number>();

    if (isConjunctive) {
      // Conjunctive mode: combine enabled category limits into a composite key.
      // Each unique combination gets min(enabled limits) as its cap.
      const enabledLimits: number[] = [];
      if (resolution) enabledLimits.push(resolution);
      if (addon) enabledLimits.push(addon);
      if (service) enabledLimits.push(service);
      if (quality) enabledLimits.push(quality);
      if (indexer) enabledLimits.push(indexer);
      if (releaseGroup) enabledLimits.push(releaseGroup);
      if (streamType) enabledLimits.push(streamType);

      const compositeLimit =
        enabledLimits.length > 0 ? Math.min(...enabledLimits) : undefined;
      const compositeCounts = new Map<string, number>();
      let globalCount = 0;

      streams.forEach((stream, index) => {
        if (indexesToRemove.has(index)) return;
        if (global && globalCount >= global) {
          indexesToRemove.add(index);
          return;
        }
        if (shouldPassthroughStage(stream, 'limit')) return;
        if (stream.type === 'info') return;

        if (compositeLimit !== undefined) {
          // Build composite key from all enabled categories
          const parts: string[] = [];
          if (resolution)
            parts.push(stream.parsedFile?.resolution || 'Unknown');
          if (addon) parts.push(stream.addon.preset.id);
          if (service) parts.push(stream.service?.id || 'none');
          if (quality) parts.push(stream.parsedFile?.quality || 'Unknown');
          if (indexer) parts.push(stream.indexer || 'none');
          if (releaseGroup)
            parts.push(stream.parsedFile?.releaseGroup || 'Unknown');
          if (streamType) parts.push(stream.type || 'unknown');

          const key = parts.join('|');
          const count = compositeCounts.get(key) || 0;
          if (count >= compositeLimit) {
            indexesToRemove.add(index);
            return;
          }
          compositeCounts.set(key, count + 1);
        }

        globalCount++;
      });
    } else {
      // Independent mode (default): each category limit is checked separately
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

      streams.forEach((stream, index) => {
        if (indexesToRemove.has(index)) return;
        if (global && counts.global >= global) {
          indexesToRemove.add(index);
          return;
        }
        if (shouldPassthroughStage(stream, 'limit')) return;
        if (stream.type === 'info') return;

        if (indexer && stream.indexer) {
          const count = counts.indexer.get(stream.indexer) || 0;
          if (count >= indexer) {
            indexesToRemove.add(index);
            return;
          }
          counts.indexer.set(stream.indexer, count + 1);
        }

        if (releaseGroup && stream.parsedFile?.releaseGroup) {
          const count =
            counts.releaseGroup.get(stream.parsedFile?.releaseGroup || '') || 0;
          if (count >= releaseGroup) {
            indexesToRemove.add(index);
            return;
          }
          counts.releaseGroup.set(stream.parsedFile.releaseGroup, count + 1);
        }

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

        if (quality) {
          const count =
            counts.quality.get(stream.parsedFile?.quality || 'Unknown') || 0;
          if (count >= quality) {
            indexesToRemove.add(index);
            return;
          }
          counts.quality.set(
            stream.parsedFile?.quality || 'Unknown',
            count + 1
          );
        }

        if (addon) {
          const count = counts.addon.get(stream.addon.preset.id) || 0;
          if (count >= addon) {
            indexesToRemove.add(index);
            return;
          }
          counts.addon.set(stream.addon.preset.id, count + 1);
        }

        if (streamType && stream.type) {
          const count = counts.streamType.get(stream.type) || 0;
          if (count >= streamType) {
            indexesToRemove.add(index);
            return;
          }
          counts.streamType.set(stream.type, count + 1);
        }

        if (service && stream.service?.id) {
          const count = counts.service.get(stream.service.id) || 0;
          if (count >= service) {
            indexesToRemove.add(index);
            return;
          }
          counts.service.set(stream.service.id, count + 1);
        }

        counts.global++;
      });
    }

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
