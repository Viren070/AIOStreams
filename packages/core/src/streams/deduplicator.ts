import { ParsedStream, UserData } from '../db/schemas.js';
import {
  createLogger,
  DSU,
  getSimpleTextHash,
  constants,
} from '../utils/index.js';
import StreamUtils, { shouldPassthroughStage } from './utils.js';
import { shouldProxyStream } from './proxifier.js';
import { isExternalDebridFailover } from '../main/play-chain.js';
import { PLAYBACK_PATH_PREFIX } from '../debrid/utils.js';
import { arrayMerge } from '../parser/merge.js';

type MergeOptions = NonNullable<NonNullable<UserData['deduplicator']>['merge']>;
type FailoverVariant = NonNullable<ParsedStream['failoverVariants']>[number];

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

    const merge = deduplicator.merge;
    const failoverTypes: ('usenet' | 'debrid')[] = this.userData.failover
      ?.contentTypes ?? ['usenet'];
    const includeExternal =
      this.userData.failover?.includeExternalFailover ?? false;

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
      smartDetectAttributes:
        deduplicator.smartDetectAttributes ??
        constants.DEFAULT_SMART_DETECT_ATTRIBUTES,
      smartDetectRounding: deduplicator.smartDetectRounding ?? 10,
      libraryBehaviour: deduplicator.libraryBehaviour ?? 'ignore',
      tiebreakers: deduplicator.tiebreakers ?? [
        { type: 'torrent_seeders' as const, position: 'before_addon' as const },
        { type: 'usenet_age' as const, position: 'before_addon' as const },
      ],
    };

    // Group streams by their deduplication keys
    // const streamGroups = new Map<string, ParsedStream[]>();
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

    // Process ALL streams (including excluded ones) for deduplication grouping
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

      // Some addons provide fileIdx (to distinguish multiple files
      // within a single torrent), while others don't. This creates an unavoidable trade-off
      // where addons that provide fileIdx will not deduplicate properly with those that don't
      // via infoHash alone.
      if (
        deduplicationKeys.includes('infoHash') &&
        stream.torrent?.infoHash &&
        stream.type !== 'usenet'
      ) {
        currentStreamKeyStrings.push(
          `infoHash:${stream.torrent.infoHash}${stream.torrent.fileIdx ?? 0}`
        );
      }
      if (
        deduplicationKeys.includes('infoHash') &&
        stream.type === 'usenet' &&
        stream.nzbUrl
      ) {
        currentStreamKeyStrings.push(`infoHash:${stream.nzbUrl}`);
      }

      if (deduplicationKeys.includes('smartDetect')) {
        const roundPct = deduplicator.smartDetectRounding ?? 10;
        const geometricRound = (value: number): string => {
          if (value <= 0) return '0';
          const logStep = Math.log(1 + roundPct / 100);
          const bucketIndex = Math.round(Math.log(value) / logStep);
          return String(Math.round(Math.exp(bucketIndex * logStep)));
        };
        const attrs =
          deduplicator.smartDetectAttributes ??
          constants.DEFAULT_SMART_DETECT_ATTRIBUTES;
        const parts = attrs.map((attr) => {
          switch (attr) {
            case 'size':
              return stream.size !== undefined
                ? geometricRound(stream.size)
                : undefined;
            case 'bitrate':
              return stream.bitrate !== undefined
                ? geometricRound(stream.bitrate)
                : undefined;
            default: {
              const val = (
                stream.parsedFile as Record<string, unknown> | undefined
              )?.[attr];
              if (val === undefined) return undefined;
              if (Array.isArray(val))
                return [...val].map(String).sort().join(',');
              return String(val);
            }
          }
        });
        const hash = getSimpleTextHash(
          parts.filter((p) => p !== undefined).join('|')
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
    for (const excludedStreamId of excludedStreamIds) {
      const stream = idToStreamMap.get(excludedStreamId);
      if (stream) {
        processedStreams.add(stream);
      }
    }

    for (const group of finalDuplicateGroupsMap.values()) {
      const groupWinners: ParsedStream[] = [];
      // Group streams by type
      const streamsByType = new Map<string, ParsedStream[]>();
      for (const stream of group) {
        let type = stream.type as string;
        if (
          (type === 'debrid' ||
            type === 'usenet' ||
            type === 'stremio-usenet') &&
          stream.service
        ) {
          type = stream.service.cached ? 'cached' : 'uncached';
        }
        if (shouldPassthroughStage(stream, 'dedup') || type === 'info') {
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
      const seedersEntry = deduplicator.tiebreakers!.find(
        (t) => t.type === 'torrent_seeders'
      );
      const usenetEntry = deduplicator.tiebreakers!.find(
        (t) => t.type === 'usenet_age'
      );

      const tiebreakerCmp = (
        a: ParsedStream,
        b: ParsedStream,
        type: string,
        position: 'before_addon' | 'after_addon' | 'any'
      ): number => {
        if (
          seedersEntry &&
          (position === 'any' || seedersEntry.position === position) &&
          (type === 'p2p' || type === 'uncached') &&
          a.torrent?.seeders !== undefined &&
          b.torrent?.seeders !== undefined &&
          (a.torrent.seeders || 0) !== (b.torrent.seeders || 0)
        ) {
          return (b.torrent.seeders || 0) - (a.torrent.seeders || 0);
        }
        if (
          usenetEntry &&
          (position === 'any' || usenetEntry.position === position) &&
          (type === 'usenet' || type === 'stremio-usenet') &&
          a.age !== undefined &&
          b.age !== undefined &&
          Math.abs(a.age - b.age) > 24
        ) {
          return a.age - b.age;
        }
        return 0;
      };

      for (const [type, rawTypeStreams] of streamsByType.entries()) {
        if (type.startsWith('passthrough-')) {
          rawTypeStreams.forEach((stream) => processedStreams.add(stream));
          continue;
        }
        const mode = deduplicator[type as keyof typeof deduplicator] as string;
        if (mode === 'disabled') {
          rawTypeStreams.forEach((stream) => processedStreams.add(stream));
          continue;
        }

        const typeStreams =
          deduplicator.libraryBehaviour === 'exclusive' &&
          rawTypeStreams.some((s) => s.library)
            ? rawTypeStreams.filter((s) => s.library)
            : rawTypeStreams;

        const libraryCmp = (a: ParsedStream, b: ParsedStream): number => {
          if (deduplicator.libraryBehaviour !== 'prefer') return 0;
          if (a.library && !b.library) return -1;
          if (!a.library && b.library) return 1;
          return 0;
        };

        switch (mode) {
          case 'single_result': {
            // Keep one result with highest priority service and addon
            let selectedStream = typeStreams.sort((a, b) => {
              const lc = libraryCmp(a, b);
              if (lc !== 0) return lc;

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

              const tb = tiebreakerCmp(a, b, type, 'before_addon');
              if (tb !== 0) return tb;

              // the addon index MUST exist, its not possible for it to not exist
              const aAddonIndex = this.userData.presets.findIndex(
                (preset) => preset.instanceId === a.addon.preset.id
              );
              const bAddonIndex = this.userData.presets.findIndex(
                (preset) => preset.instanceId === b.addon.preset.id
              );
              if (aAddonIndex !== bAddonIndex) {
                return aAddonIndex - bAddonIndex;
              }

              const tb2 = tiebreakerCmp(a, b, type, 'after_addon');
              if (tb2 !== 0) return tb2;

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
            groupWinners.push(selectedStream);
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
                const lc = libraryCmp(a, b);
                if (lc !== 0) return lc;

                const tb = tiebreakerCmp(a, b, type, 'before_addon');
                if (tb !== 0) return tb;

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

                const tb2 = tiebreakerCmp(a, b, type, 'after_addon');
                if (tb2 !== 0) return tb2;

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
            });
            for (const stream of perServiceStreams) {
              groupWinners.push(stream);
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
                const lc = libraryCmp(a, b);
                if (lc !== 0) return lc;
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
                return tiebreakerCmp(a, b, type, 'any');
              })[0];
            });
            for (const stream of perAddonStreams) {
              groupWinners.push(stream);
            }
            break;
          }
        }
      }

      // Merge discarded duplicates' info into each surviving winner, then
      // add the winners to the result.
      if (merge?.enabled) {
        for (const winner of groupWinners) {
          this.mergeIntoWinner(
            winner,
            group,
            merge,
            failoverTypes,
            includeExternal
          );
        }
      }
      for (const winner of groupWinners) {
        processedStreams.add(winner);
      }
    }

    let deduplicatedStreams = StreamUtils.mergeStreams(
      Array.from(processedStreams)
    );
    logger.debug(
      {
        removed: streams.length - deduplicatedStreams.length,
        kept: deduplicatedStreams.length,
        excluded: excludedStreamIds.size,
        took: Date.now() - start,
      },
      'deduplication complete'
    );
    return deduplicatedStreams;
  }

  /**
   * Fold info from a duplicate group's discarded streams into the surviving
   * winner: same-release failover variants and selected metadata fields. Mutates
   * the winner in place (consistent with the rest of the pipeline).
   */
  private mergeIntoWinner(
    winner: ParsedStream,
    group: ParsedStream[],
    merge: MergeOptions,
    failoverTypes: ('usenet' | 'debrid')[],
    includeExternal: boolean
  ): void {
    const others = group.filter((s) => s.id !== winner.id);
    if (others.length === 0) return;

    // Same-release failover variants ---
    if (merge.failoverVariants) {
      const seen = new Set<string>();
      const winnerIdentity = winner.nzbUrl ?? winner.torrent?.infoHash;
      if (winnerIdentity) seen.add(winnerIdentity);

      const variants: FailoverVariant[] = [];
      for (const other of others) {
        let entry: FailoverVariant | undefined;
        if (
          other.url?.includes(PLAYBACK_PATH_PREFIX) &&
          (other.type === 'usenet' || other.type === 'debrid') &&
          failoverTypes.includes(other.type)
        ) {
          entry = {
            url: other.url,
            type: other.type,
            serviceId: other.service?.id,
            filename: other.filename,
            identity: other.nzbUrl ?? other.torrent?.infoHash ?? other.url,
            kind: 'owned',
            proxied: shouldProxyStream(other, this.userData.proxy),
          };
        } else if (includeExternal && isExternalDebridFailover(other)) {
          let identity = other.url;
          try {
            const u = new URL(other.url);
            identity = u.host + u.pathname;
          } catch {}
          entry = {
            url: other.url,
            type: 'debrid',
            serviceId: other.service?.id,
            filename: other.filename,
            identity,
            kind: 'external',
            proxied: shouldProxyStream(other, this.userData.proxy),
          };
        }
        if (!entry) continue;
        const key = entry.identity ?? entry.url;
        if (seen.has(key)) continue;
        seen.add(key);
        variants.push(entry);
      }
      if (variants.length > 0) {
        winner.failoverVariants = [
          ...(winner.failoverVariants ?? []),
          ...variants,
        ];
      }
    }

    // Metadata
    const fields = merge.fields ?? [];
    if (fields.includes('languages') || fields.includes('subtitles')) {
      this.mergeLanguagesAndSubtitles(winner, others, fields);
    }
    if (fields.includes('library') && !winner.library) {
      if (others.some((s) => s.library)) winner.library = true;
    }
    if (fields.includes('seadex') && !winner.seadex) {
      const withSeadex = others.filter((s) => s.seadex);
      const best = withSeadex.find((s) => s.seadex?.isBest) ?? withSeadex[0];
      if (best?.seadex) winner.seadex = best.seadex;
    }
    if (fields.includes('sizes')) {
      if (winner.size === undefined) {
        const max = Math.max(0, ...others.map((s) => s.size ?? 0));
        if (max > 0) winner.size = max;
      }
      if (winner.folderSize === undefined) {
        const max = Math.max(0, ...others.map((s) => s.folderSize ?? 0));
        if (max > 0) winner.folderSize = max;
      }
    }
  }

  /**
   * Accuracy-aware merge of parsed `languages`/`subtitles` plus actual subtitle
   * tracks.
   */
  private mergeLanguagesAndSubtitles(
    winner: ParsedStream,
    others: ParsedStream[],
    fields: readonly string[]
  ): void {
    const sources = [winner, ...others].filter((s) => s.parsedFile);
    const accurate = sources.filter(
      (s) =>
        (s.parsedFile?.languages?.length ?? 0) > 0 &&
        (s.parsedFile?.subtitles?.length ?? 0) > 0
    );
    const pool = accurate.length > 0 ? accurate : sources;

    if (winner.parsedFile) {
      if (fields.includes('languages')) {
        winner.parsedFile.languages = arrayMerge(
          [],
          pool.flatMap((s) => s.parsedFile?.languages ?? [])
        );
      }
      if (fields.includes('subtitles')) {
        winner.parsedFile.subtitles = arrayMerge(
          [],
          pool.flatMap((s) => s.parsedFile?.subtitles ?? [])
        );
      }
    }

    // Merge actual subtitle tracks (with URLs) by unique (lang, url).
    if (fields.includes('subtitles')) {
      const seen = new Set<string>();
      const merged: NonNullable<ParsedStream['subtitles']> = [];
      for (const sub of [
        ...(winner.subtitles ?? []),
        ...others.flatMap((s) => s.subtitles ?? []),
      ]) {
        const key = `${sub.lang}|${sub.url}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(sub);
      }
      if (merged.length > 0) winner.subtitles = merged;
    }
  }
}

export default StreamDeduplicator;
