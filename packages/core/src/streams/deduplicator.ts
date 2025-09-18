import { ParsedStream, UserData } from '../db/schemas.js';
import {
  createLogger,
  getTimeTakenSincePoint,
  DSU,
  getSimpleTextHash,
} from '../utils/index.js';

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
      keys: deduplicationKeys,
      cached: deduplicator.cached || 'per_addon',
      uncached: deduplicator.uncached || 'per_addon',
      p2p: deduplicator.p2p || 'per_addon',
      http: deduplicator.http || 'disabled',
      live: deduplicator.live || 'disabled',
      youtube: deduplicator.youtube || 'disabled',
      external: deduplicator.external || 'disabled',
    };

    // Group streams by their deduplication keys
    // const streamGroups = new Map<string, ParsedStream[]>();
    const dsu = new DSU<string>();
    const keyToStreamIds = new Map<string, string[]>();

    for (const stream of streams) {
      // Create a unique key based on the selected deduplication methods
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
        currentStreamKeyStrings.push(`infoHash:${stream.torrent.infoHash}`);
      }

      if (deduplicationKeys.includes('smartDetect')) {
        // generate a hash using many different attributes
        // round size to nearest 100MB for some margin of error
        const roundedSize = stream.size
          ? Math.round(stream.size / 100000000) * 100000000
          : undefined;
        const hash = getSimpleTextHash(
          `${roundedSize}${stream.parsedFile?.resolution}${stream.parsedFile?.quality}${stream.parsedFile?.visualTags}${stream.parsedFile?.audioTags}${stream.parsedFile?.languages}${stream.parsedFile?.encode}`
        );
        currentStreamKeyStrings.push(`smartDetect:${hash}`);
      }

      if (currentStreamKeyStrings.length > 0) {
        for (const key of currentStreamKeyStrings) {
          if (!keyToStreamIds.has(key)) {
            keyToStreamIds.set(key, []);
          }
          keyToStreamIds.get(key)!.push(stream.id);
        }
      }
    }

    // Perform union operations based on shared keys
    for (const streamIdsSharingCommonKey of keyToStreamIds.values()) {
      if (streamIdsSharingCommonKey.length > 1) {
        const firstStreamId = streamIdsSharingCommonKey[0];
        for (let i = 1; i < streamIdsSharingCommonKey.length; i++) {
          dsu.union(firstStreamId, streamIdsSharingCommonKey[i]);
        }
      }
    }
    // Group actual stream objects by their DSU representative ID
    const idToStreamMap = new Map(streams.map((s) => [s.id, s])); // For quick lookup
    const finalDuplicateGroupsMap = new Map<string, ParsedStream[]>(); // Maps representative ID to stream objects

    for (const stream of streams) {
      const representativeId = dsu.find(stream.id);
      if (!finalDuplicateGroupsMap.has(representativeId)) {
        finalDuplicateGroupsMap.set(representativeId, []);
      }
      finalDuplicateGroupsMap.get(representativeId)!.push(stream);
    }

    const processedStreams = new Set<ParsedStream>();

    for (const group of finalDuplicateGroupsMap.values()) {
      // Group streams by type
      const streamsByType = new Map<string, ParsedStream[]>();
      for (const stream of group) {
        let type = stream.type as string;
        if ((type === 'debrid' || type === 'usenet') && stream.service) {
          type = stream.service.cached ? 'cached' : 'uncached';
        }
        if (stream.addon.resultPassthrough) {
          // ensure that passthrough streams are not deduplicated by adding each to a separate group
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

    let deduplicatedStreams = Array.from(processedStreams);
    logger.info(
      `Filtered out ${streams.length - deduplicatedStreams.length} duplicate streams to ${deduplicatedStreams.length} streams in ${getTimeTakenSincePoint(start)}`
    );
    return deduplicatedStreams;
  }
}

export default StreamDeduplicator;
