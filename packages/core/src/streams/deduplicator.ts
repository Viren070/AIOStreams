import { ParsedStream, UserData } from '../db/schemas.js';
import {
  createLogger,
  getTimeTakenSincePoint,
  DSU,
  getSimpleTextHash,
} from '../utils/index.js';
import StreamUtils, { shouldPassthroughStage } from './utils.js';

const logger = createLogger('deduplicator');

class StreamDeduplicator {
  private userData: UserData;

  constructor(userData: UserData) {
    this.userData = userData;
  }

  public async deduplicate(streams: ParsedStream[]): Promise<ParsedStream[]> {
    let deduplicator = this.userData.deduplicator;
    if (!deduplicator || !deduplicator.enabled) {
      return streams;
    }
    const start = Date.now();

    const deduplicationKeys = deduplicator.keys || ['filename', 'infoHash'];

    deduplicator = {
      enabled: true,
      multiGroupBehaviour: deduplicator.multiGroupBehaviour || 'aggressive',
      excludeAddons: deduplicator.excludeAddons || [],
      keys: deduplicationKeys,
      cached: deduplicator.cached || 'per_addon',
      uncached: deduplicator.uncached || 'per_addon',
      p2p: deduplicator.p2p || 'per_addon',
      http: deduplicator.http || 'disabled',
      live: deduplicator.live || 'disabled',
      youtube: deduplicator.youtube || 'disabled',
      external: deduplicator.external || 'disabled',
    };

    const dsu = new DSU<string>();

    const keyToStreamIds = new Map<string, string[]>();

    const excludedStreamIds = new Set<string>();
    for (const stream of streams) {
      const isExcluded =
        stream.addon?.instanceId &&
        deduplicator.excludeAddons?.includes(stream.addon.preset.id);

      if (isExcluded) {
        excludedStreamIds.add(stream.id);
      }
    }

// ## start change
    // Map stream ID -> stream for quick access to library status
    const idToStreamMap = new Map(streams.map((s) => [s.id, s]));
// ## end change

    // Process ALL streams (including excluded ones) for deduplication grouping
    for (const stream of streams) {
      dsu.makeSet(stream.id);

      const currentStreamKeyStrings: string[] = [];

      if (deduplicationKeys.includes('filename') && stream.filename) {
        let normalisedFilename = stream.filename
          .replace(
            /(mkv|mp4|avi|mov|wmv|flv|webm|m4v|mpg|mpeg|3gp|3g2|m2ts|ts|vob|ogv|ogm|divx|xvid|rm|rmvb|asf|mxf|mka|mks|mk3d|webm|f4v|f4p|f4a|f4b)$/i,
            ''
          )
          .replace(/[^\p{L}\p{N}+]/gu, '')
          .replace(/\s+/g, '')
          .toLowerCase();
        currentStreamKeyStrings.push(`filename:${normalisedFilename}`);
      }

      if (deduplicationKeys.includes('infoHash') && stream.torrent?.infoHash) {
        currentStreamKeyStrings.push(
          `infoHash:${stream.torrent.infoHash}${stream.torrent.fileIdx ?? 0}`
        );
      }

      if (deduplicationKeys.includes('smartDetect')) {
        const roundedSize = stream.size
          ? Math.round(stream.size / 100000000) * 100000000
          : undefined;
        const hash = getSimpleTextHash(
          `${roundedSize}${stream.parsedFile?.resolution}${stream.parsedFile?.quality}${stream.parsedFile?.visualTags}${stream.parsedFile?.audioTags}${stream.parsedFile?.languages}${stream.parsedFile?.encode}`
        );
        currentStreamKeyStrings.push(`smartDetect:${hash}`);
      }


// ## START change 1
// Library-only deduplication key so library streams dedupe among themselves
// without affecting non-library streams
      if (stream.library && normalisedFilename) {
        currentStreamKeyStrings.push(`library:${normalisedFilename}`);
      }
// ## END change 1
      
      if (currentStreamKeyStrings.length > 0) {
        for (const key of currentStreamKeyStrings) {
          if (!keyToStreamIds.has(key)) {
            keyToStreamIds.set(key, []);
          }

// ## start change
          const existingStreamIds = keyToStreamIds.get(key)!;
          const hasConflict = existingStreamIds.some(
            (id) => idToStreamMap.get(id)?.library !== stream.library
          );
          if (hasConflict) continue;
// ## end change

          keyToStreamIds.get(key)!.push(stream.id);
        }
      }
    }

    for (const streamIdsSharingCommonKey of keyToStreamIds.values()) {
      if (streamIdsSharingCommonKey.length > 1) {
        const firstStreamId = streamIdsSharingCommonKey[0];
        for (let i = 1; i < streamIdsSharingCommonKey.length; i++) {
          dsu.union(firstStreamId, streamIdsSharingCommonKey[i]);
        }
      }
    }

    const finalDuplicateGroupsMap = new Map<string, ParsedStream[]>();
    for (const stream of streams) {
      const representativeId = dsu.find(stream.id);
      if (!finalDuplicateGroupsMap.has(representativeId)) {
        finalDuplicateGroupsMap.set(representativeId, []);
      }
      finalDuplicateGroupsMap.get(representativeId)!.push(stream);
    }

    const processedStreams = new Set<ParsedStream>();
    for (const excludedStreamId of excludedStreamIds) {
      const stream = idToStreamMap.get(excludedStreamId);
      if (stream) {
        processedStreams.add(stream);
      }
    }

    for (const group of finalDuplicateGroupsMap.values()) {

// ## start change
      const libraryStreams = group.filter(s => s.library);
      const nonLibraryStreams = group.filter(s => !s.library);

      if (libraryStreams.length > 0) {
        const selectedLibraryStream = libraryStreams.sort((a, b) => {
          let aServiceIdx = this.userData.services?.filter(s => s.enabled).findIndex(s => s.id === a.service?.id) ?? 0;
          let bServiceIdx = this.userData.services?.filter(s => s.enabled).findIndex(s => s.id === b.service?.id) ?? 0;
          aServiceIdx = aServiceIdx === -1 ? Infinity : aServiceIdx;
          bServiceIdx = bServiceIdx === -1 ? Infinity : bServiceIdx;
          if (aServiceIdx !== bServiceIdx) return aServiceIdx - bServiceIdx;

          const aAddonIdx = this.userData.presets.findIndex(p => p.instanceId === a.addon.preset.id);
          const bAddonIdx = this.userData.presets.findIndex(p => p.instanceId === b.addon.preset.id);
          if (aAddonIdx !== bAddonIdx) return aAddonIdx - bAddonIdx;

          let aTypeIdx = this.userData.preferredStreamTypes?.findIndex(t => t === a.type) ?? 0;
          let bTypeIdx = this.userData.preferredStreamTypes?.findIndex(t => t === b.type) ?? 0;
          aTypeIdx = aTypeIdx === -1 ? Infinity : aTypeIdx;
          bTypeIdx = bTypeIdx === -1 ? Infinity : bTypeIdx;
          if (aTypeIdx !== bTypeIdx) return aTypeIdx - bTypeIdx;

          return 0;
        })[0];
        processedStreams.add(selectedLibraryStream);
      }

      const streamsByType = new Map<string, ParsedStream[]>();
      for (const stream of nonLibraryStreams) {
// ## end change
        let type = stream.type as string;
        if (
          (type === 'debrid' ||
            type === 'usenet' ||
            type === 'stremio-usenet') &&
          stream.service
        ) {
          type = stream.service.cached ? 'cached' : 'uncached';
        }
        if (shouldPassthroughStage(stream, 'dedup')) {
          type = `passthrough-${Math.random()}`;
        }
        const typeGroup = streamsByType.get(type) || [];
        typeGroup.push(stream);
        streamsByType.set(type, typeGroup);
      }

      const cachedStreams = streamsByType.get('cached') || [];
      const uncachedStreams = streamsByType.get('uncached') || [];
      const p2pStreams = streamsByType.get('p2p') || [];

      const groupTypes = [cachedStreams, uncachedStreams, p2pStreams];
      if (groupTypes.filter((arr) => arr.length > 0).length >= 2) {
        switch (deduplicator.multiGroupBehaviour) {
          case 'aggressive':
            if (cachedStreams.length > 0) {
              streamsByType.delete('p2p');
              streamsByType.delete('uncached');
            } else if (p2pStreams.length > 0) {
              streamsByType.delete('uncached');
            }
            break;
          case 'keep_all':
            break;
          case 'conservative':
            streamsByType.set(
              'uncached',
              uncachedStreams.filter(
                (s) =>
                  !cachedStreams.some((cs) => cs.service?.id === s.service?.id)
              )
            );
            if (streamsByType.get('uncached')?.length === 0) {
              streamsByType.delete('uncached');
            }
            if (cachedStreams.length > 0) {
              streamsByType.delete('p2p');
            }
            break;
        }
      }

      // Process each type according to its deduplication mode
      for (const [type, typeStreams] of streamsByType.entries()) {
        if (type.startsWith('passthrough-')) {
          typeStreams.forEach((stream) => processedStreams.add(stream));
          continue;
        }
        const mode = deduplicator[type as keyof typeof deduplicator] as string;
        if (mode === 'disabled') {
          typeStreams.forEach((stream) => processedStreams.add(stream));
          continue;
        }

        switch (mode) {
          case 'single_result': {
            // Keep one result with highest priority service and addon
            let selectedStream = typeStreams.sort((a, b) => {
              // so a specific type may either have both streams not have a service, or both streams have a service
              // if both streams have a service, then we can simpl
              let aProviderIndex =
                this.userData.services
                  ?.filter((service) => service.enabled)
                  .findIndex((service) => service.id === a.service?.id) ?? 0;
              let bProviderIndex =
                this.userData.services
                  ?.filter((service) => service.enabled)
                  .findIndex((service) => service.id === b.service?.id) ?? 0;
              aProviderIndex =
                aProviderIndex === -1 ? Infinity : aProviderIndex;
              bProviderIndex =
                bProviderIndex === -1 ? Infinity : bProviderIndex;
              if (aProviderIndex !== bProviderIndex) {
                return aProviderIndex - bProviderIndex;
              }

              // look at seeders for p2p and uncached streams
              if (
                (type === 'p2p' || type === 'uncached') &&
                a.torrent?.seeders &&
                b.torrent?.seeders
              ) {
                return (b.torrent.seeders || 0) - (a.torrent.seeders || 0);
              }

              // now look at the addon index

              const aAddonIndex = this.userData.presets.findIndex(
                (preset) => preset.instanceId === a.addon.preset.id
              );
              const bAddonIndex = this.userData.presets.findIndex(
                (preset) => preset.instanceId === b.addon.preset.id
              );

              // the addon index MUST exist, its not possible for it to not exist
              if (aAddonIndex !== bAddonIndex) {
                return aAddonIndex - bAddonIndex;
              }

              // now look at stream type
              let aTypeIndex =
                this.userData.preferredStreamTypes?.findIndex(
                  (type) => type === a.type
                ) ?? 0;
              let bTypeIndex =
                this.userData.preferredStreamTypes?.findIndex(
                  (type) => type === b.type
                ) ?? 0;

              aTypeIndex = aTypeIndex === -1 ? Infinity : aTypeIndex;
              bTypeIndex = bTypeIndex === -1 ? Infinity : bTypeIndex;

              if (aTypeIndex !== bTypeIndex) {
                return aTypeIndex - bTypeIndex;
              }

              return 0;
            })[0];
            processedStreams.add(selectedStream);
            break;
          }
          case 'per_service': {
            // Keep one result from each service (highest priority available addon for that service)
            // first, ensure that all streams have a service, otherwise we can't use this mode
            if (typeStreams.some((stream) => !stream.service)) {
              throw new Error(
                'per_service mode requires all streams to have a service'
              );
            }
            let perServiceStreams = Object.values(
              typeStreams.reduce(
                (acc, stream) => {
                  acc[stream.service!.id] = acc[stream.service!.id] || [];
                  acc[stream.service!.id].push(stream);
                  return acc;
                },
                {} as Record<string, ParsedStream[]>
              )
            ).map((serviceStreams) => {
              return serviceStreams.sort((a, b) => {
                let aAddonIndex = this.userData.presets.findIndex(
                  (preset) => preset.instanceId === a.addon.preset.id
                );
                let bAddonIndex = this.userData.presets.findIndex(
                  (preset) => preset.instanceId === b.addon.preset.id
                );
                aAddonIndex = aAddonIndex === -1 ? Infinity : aAddonIndex;
                bAddonIndex = bAddonIndex === -1 ? Infinity : bAddonIndex;
                if (aAddonIndex !== bAddonIndex) {
                  return aAddonIndex - bAddonIndex;
                }

                // now look at stream type
                let aTypeIndex =
                  this.userData.preferredStreamTypes?.findIndex(
                    (type) => type === a.type
                  ) ?? 0;
                let bTypeIndex =
                  this.userData.preferredStreamTypes?.findIndex(
                    (type) => type === b.type
                  ) ?? 0;
                aTypeIndex = aTypeIndex === -1 ? Infinity : aTypeIndex;
                bTypeIndex = bTypeIndex === -1 ? Infinity : bTypeIndex;
                if (aTypeIndex !== bTypeIndex) {
                  return aTypeIndex - bTypeIndex;
                }

                // look at seeders for p2p and uncached streams
                if (type === 'p2p' || type === 'uncached') {
                  return (b.torrent?.seeders || 0) - (a.torrent?.seeders || 0);
                }
                return 0;
              })[0];
            });
            for (const stream of perServiceStreams) {
              processedStreams.add(stream);
            }
            break;
          }
          case 'per_addon': {
            if (typeStreams.some((stream) => !stream.addon)) {
              throw new Error(
                'per_addon mode requires all streams to have an addon'
              );
            }
            let perAddonStreams = Object.values(
              typeStreams.reduce(
                (acc, stream) => {
                  acc[stream.addon.preset.id] =
                    acc[stream.addon.preset.id] || [];
                  acc[stream.addon.preset.id].push(stream);
                  return acc;
                },
                {} as Record<string, ParsedStream[]>
              )
            ).map((addonStreams) => {
              return addonStreams.sort((a, b) => {
                let aServiceIndex =
                  this.userData.services
                    ?.filter((service) => service.enabled)
                    .findIndex((service) => service.id === a.service?.id) ?? 0;
                let bServiceIndex =
                  this.userData.services
                    ?.filter((service) => service.enabled)
                    .findIndex((service) => service.id === b.service?.id) ?? 0;
                aServiceIndex = aServiceIndex === -1 ? Infinity : aServiceIndex;
                bServiceIndex = bServiceIndex === -1 ? Infinity : bServiceIndex;
                if (aServiceIndex !== bServiceIndex) {
                  return aServiceIndex - bServiceIndex;
                }
                if (type === 'p2p' || type === 'uncached') {
                  return (b.torrent?.seeders || 0) - (a.torrent?.seeders || 0);
                }
                return 0;
              })[0];
            });
            for (const stream of perAddonStreams) {
              processedStreams.add(stream);
            }
            break;
          }
        }
      }
    }

    let deduplicatedStreams = StreamUtils.mergeStreams(
      Array.from(processedStreams)
    );
    logger.info(
      `Filtered out ${streams.length - deduplicatedStreams.length} duplicate streams to ${deduplicatedStreams.length}${Array.from(excludedStreamIds.values()).length > 0 ? ' (' + Array.from(excludedStreamIds.values()).length + ' streams excluded from deduplication) ' : ''} streams in ${getTimeTakenSincePoint(start)}`
    );
    return deduplicatedStreams;
  }
}

export default StreamDeduplicator;
