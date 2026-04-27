import {
  createLogger,
  Env,
  getSimpleTextHash,
  maskSensitiveInfo,
} from '../utils/index.js';
import { constants } from '../utils/index.js';
import { Wrapper } from './wrapper.js';
import { PresetManager } from '../presets/index.js';
import { FeatureControl } from '../utils/feature.js';
import { createProxy } from '../proxy/index.js';
import { getAddonName } from '../utils/general.js';
import type { Addon, Resource, UserData } from '../db/index.js';
import type { AIOStreamsContext } from './types.js';

const logger = createLogger('core');

export async function applyPresets(ctx: AIOStreamsContext): Promise<void> {
  if (!ctx.userData.presets) {
    return;
  }

  const serviceWrap = ctx.userData.serviceWrap;

  for (const preset of ctx.userData.presets.filter((p) => p.enabled)) {
    try {
      const Preset = PresetManager.fromId(preset.type);
      if (Preset.METADATA.DISABLED) {
        throw new Error(
          `${Preset.METADATA.NAME} has been ${Preset.METADATA.DISABLED.removed ? 'removed' : 'disabled'}: ${Preset.METADATA.DISABLED.reason}`
        );
      }

      // Determine if P2P wrap applies to this preset
      const shouldServiceWrap =
        serviceWrap?.enabled &&
        Preset.METADATA.SUPPORTED_STREAM_TYPES.includes(
          constants.P2P_STREAM_TYPE
        ) &&
        !Preset.METADATA.BUILTIN &&
        (!serviceWrap.presets ||
          serviceWrap.presets.length === 0 ||
          serviceWrap.presets.includes(preset.instanceId));

      // When Service Wrap is active, only generate normal addons for services
      // that are NOT builtin-supported (since builtin services will be handled
      // by resolveServiceWrappedStreams through the service-wrapped addon).
      // This avoids redundant debrid addons.
      const normalUserData = shouldServiceWrap
        ? {
            ...ctx.userData,
            services: (ctx.userData.services ?? []).filter(
              (s) =>
                !(
                  constants.BUILTIN_SUPPORTED_SERVICES as readonly string[]
                ).includes(s.id)
            ),
            presets: ctx.userData.presets?.map((p) =>
              p.instanceId === preset.instanceId
                ? {
                    ...p,
                    options: {
                      ...p.options,
                      // only keep non-builtin specified services.
                      services: p.options.services?.filter(
                        (s: string) =>
                          !(
                            constants.BUILTIN_SUPPORTED_SERVICES as readonly string[]
                          ).includes(s)
                      ),
                    },
                  }
                : p
            ),
          }
        : ctx.userData;

      const options = shouldServiceWrap
        ? { ...preset.options, services: [] }
        : preset.options;

      const addons = await Preset.generateAddons(normalUserData, options);

      // When service wrapping, don't add addons that fell into P2P mode
      // due to having no usable services — those would be unmarked duplicates
      // of the serviceWrapped addon we generate below.
      const filteredAddons = shouldServiceWrap
        ? addons.filter((a) => a.identifier !== 'p2p')
        : addons;

      ctx.addons.push(
        ...filteredAddons.map(
          (a): Addon => ({
            ...a,
            preset: {
              ...a.preset,
              id: preset.instanceId,
            },
            // if no identifier is present, we can assume that the preset can only generate one addon at a time and so no
            // unique identifier is needed as the preset instance id is enough to identify the addon
            instanceId: `${preset.instanceId}${getSimpleTextHash(`${a.identifier ?? ''}`).slice(0, 4)}`,
          })
        )
      );

      // Service Wrap: generate the P2P-mode addon for this preset
      // so its torrent results can be resolved through builtin debrid services
      if (shouldServiceWrap) {
        try {
          // Generate addons with no services, forcing the preset into P2P mode
          const p2pUserData: UserData = {
            ...ctx.userData,
            services: [], // empty services → preset falls into P2P codepath
            presets: ctx.userData.presets?.map((p) =>
              p.instanceId === preset.instanceId
                ? {
                    ...p,
                    options: {
                      ...p.options,
                      services: [], // remove specified services to avoid errors.
                    },
                  }
                : p
            ),
          };
          const p2pOptions = { ...preset.options, services: [] };
          const p2pAddons = await Preset.generateAddons(
            p2pUserData,
            p2pOptions
          );
          // Only keep addons that are actually P2P (not debrid addons from presets that don't care about services)
          ctx.addons.push(
            ...p2pAddons.map(
              (a): Addon => ({
                ...a,
                preset: {
                  ...a.preset,
                  id: preset.instanceId,
                },
                instanceId: `${preset.instanceId}${getSimpleTextHash(`servicewrap-${a.identifier ?? ''}`).slice(0, 4)}`,
                serviceWrapped: true,
              })
            )
          );
          logger.info(
            `Service Wrap: generated ${p2pAddons.length} P2P-mode addon(s) for preset ${Preset.METADATA.NAME}`
          );
        } catch (error) {
          logger.warn(
            `Service Wrap: failed to generate P2P addons for ${Preset.METADATA.NAME}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    } catch (error) {
      if (ctx.options?.skipFailedAddons !== false) {
        ctx.addonInitialisationErrors.push({
          addon: preset,
          error: error instanceof Error ? error.message : String(error),
        });
        logger.error(
          `${error instanceof Error ? error.message : String(error)}, skipping`
        );
      } else {
        throw error;
      }
    }
  }

  if (ctx.addons.length > Env.MAX_ADDONS) {
    throw new Error(
      `Your current configuration requires ${ctx.addons.length} addons, but the maximum allowed is ${Env.MAX_ADDONS}. Please reduce the number of addons installed or services enabled. If you own the instance or know the owner, increase the value of the MAX_ADDONS environment variable.`
    );
  }
}

export function validateAddon(ctx: AIOStreamsContext, addon: Addon): void {
  const manifestUrl = new URL(addon.manifestUrl);
  const baseUrl = Env.BASE_URL ? new URL(Env.BASE_URL) : undefined;
  if (ctx.userData.uuid && addon.manifestUrl.includes(ctx.userData.uuid)) {
    logger.warn(
      `${ctx.userData.uuid} detected to be trying to cause infinite self scraping`
    );
    throw new Error(
      `${getAddonName(addon)} would cause infinite self scraping, ensure you wrap a different AIOStreams user.`
    );
  } else if (
    ((baseUrl && manifestUrl.host === baseUrl.host) ||
      (manifestUrl.host.startsWith('localhost') &&
        manifestUrl.port === Env.PORT.toString())) &&
    !manifestUrl.pathname.startsWith('/builtins') &&
    Env.DISABLE_SELF_SCRAPING === true
  ) {
    throw new Error(
      `Scraping the same AIOStreams instance is disabled. Please use a different AIOStreams instance, or enable it through the environment variables.`
    );
  }
  if (
    addon.preset.type &&
    FeatureControl.removedAddons.has(addon.preset.type)
  ) {
    throw new Error(
      `Addon ${getAddonName(addon)} has been removed: ${FeatureControl.removedAddons.get(
        addon.preset.type
      )}`
    );
  } else if (
    addon.preset.type &&
    FeatureControl.disabledAddons.has(addon.preset.type)
  ) {
    throw new Error(
      `Addon ${getAddonName(addon)} is disabled: ${FeatureControl.disabledAddons.get(
        addon.preset.type
      )}`
    );
  } else if (FeatureControl.disabledHosts.has(manifestUrl.host.split(':')[0])) {
    throw new Error(
      `Addon ${getAddonName(addon)} is disabled: ${FeatureControl.disabledHosts.get(
        manifestUrl.host.split(':')[0]
      )}`
    );
  }
}

export async function fetchManifests(ctx: AIOStreamsContext): Promise<void> {
  ctx.manifests = Object.fromEntries(
    await Promise.all(
      ctx.addons.map(async (addon) => {
        try {
          validateAddon(ctx, addon);
          return [
            addon.instanceId,
            await new Wrapper(addon).getManifest({
              timeout: ctx.options?.increasedManifestTimeout
                ? Env.MANIFEST_INCREASED_TIMEOUT
                : undefined,
              bypassCache: ctx.options?.bypassManifestCache,
            }),
          ];
        } catch (error: any) {
          if (ctx.options?.skipFailedAddons !== false) {
            ctx.addonInitialisationErrors.push({
              addon: addon,
              error: error.message,
            });
            logger.error(`${error.message}, skipping`);
            return [addon.instanceId, null];
          }
          throw error;
        }
      })
    )
  );
}

/**
 * Builds the extras array for a merged catalog by analyzing the source catalogs' manifest definitions.
 * - Only adds an extra (like skip, search, genre) if at least one source catalog supports it
 * - Merges options arrays (e.g., genre options) from all sources
 * - Sets isRequired to true only if ALL sources have isRequired=true for that extra
 */
function buildMergedCatalogExtras(
  ctx: AIOStreamsContext,
  catalogIds: string[]
): Array<{
  name: string;
  isRequired?: boolean;
  options?: (string | null)[] | null;
  optionsLimit?: number;
}> {
  // Track extras by name: { appearances: number, allRequired: boolean, options: Set, optionsLimit: max }
  const extrasMap = new Map<
    string,
    {
      appearances: number;
      allRequired: boolean;
      options: Set<string | null>;
      optionsLimit?: number;
    }
  >();

  let sourceCatalogCount = 0;

  for (const encodedCatalogId of catalogIds) {
    const params = new URLSearchParams(encodedCatalogId);
    const catalogId = params.get('id');
    const catalogType = params.get('type');
    if (!catalogId || !catalogType) continue;

    // Parse the catalog ID to get addon instance ID and actual catalog ID
    const addonInstanceId = catalogId.split('.', 2)[0];
    const actualCatalogId = catalogId.split('.').slice(1).join('.');

    // Get the manifest for this addon
    const manifest = ctx.manifests[addonInstanceId];
    if (!manifest) continue;

    // Find the catalog definition in the manifest
    const catalogDef = manifest.catalogs.find(
      (c) => c.id === actualCatalogId && c.type === catalogType
    );
    if (!catalogDef) continue;

    sourceCatalogCount++;

    // Process each extra from this catalog
    if (catalogDef.extra) {
      for (const extra of catalogDef.extra) {
        const existing = extrasMap.get(extra.name);
        if (existing) {
          existing.appearances++;
          // allRequired stays true only if this one is also required
          existing.allRequired =
            existing.allRequired && extra.isRequired === true;
          // Merge options
          if (extra.options) {
            for (const opt of extra.options) {
              existing.options.add(opt);
            }
          }
          // Take the maximum optionsLimit
          if (extra.optionsLimit !== undefined) {
            existing.optionsLimit = Math.max(
              existing.optionsLimit ?? 0,
              extra.optionsLimit
            );
          }
        } else {
          extrasMap.set(extra.name, {
            appearances: 1,
            allRequired: extra.isRequired === true,
            options: new Set(extra.options ?? []),
            optionsLimit: extra.optionsLimit,
          });
        }
      }
    }
  }

  // Build the final extras array
  const mergedExtras: Array<{
    name: string;
    isRequired?: boolean;
    options?: (string | null)[] | null;
    optionsLimit?: number;
  }> = [];

  for (const [name, data] of extrasMap) {
    const extra: {
      name: string;
      isRequired?: boolean;
      options?: (string | null)[] | null;
      optionsLimit?: number;
    } = { name };

    // isRequired is true only if ALL source catalogs that have this extra have it as required
    // If not all catalogs have this extra, it's effectively not required since some don't need it
    if (data.appearances === sourceCatalogCount && data.allRequired) {
      extra.isRequired = true;
    }

    // Include options if any were collected
    if (data.options.size > 0) {
      extra.options = Array.from(data.options);
    }

    // Include optionsLimit if set
    if (data.optionsLimit !== undefined) {
      extra.optionsLimit = data.optionsLimit;
    }

    mergedExtras.push(extra);
  }

  return mergedExtras;
}

export function buildResources(ctx: AIOStreamsContext): void {
  for (const [instanceId, manifest] of Object.entries(ctx.manifests)) {
    if (!manifest) continue;

    // Convert string resources to StrictManifestResource objects
    let addonResources = manifest.resources.map((resource) => {
      if (typeof resource === 'string') {
        return {
          name: resource as Resource,
          types: manifest.types,
          idPrefixes: manifest.idPrefixes,
        };
      }
      return resource;
    });

    if (manifest.catalogs) {
      const existing = addonResources.find((r) => r.name === 'catalog');
      if (existing) {
        existing.types = [
          ...new Set([
            ...manifest.catalogs.map((c) => {
              const type = c.type;
              const modification = ctx.userData.catalogModifications?.find(
                (m) => m.id === `${instanceId}.${c.id}` && m.type === type
              );
              return modification?.overrideType ?? type;
            }),
          ]),
        ];
      } else {
        addonResources.push({
          name: 'catalog',
          types: manifest.catalogs.map((c) => {
            const type = c.type;
            const modification = ctx.userData.catalogModifications?.find(
              (m) => m.id === `${instanceId}.${c.id}` && m.type === type
            );
            return modification?.overrideType ?? type;
          }),
        });
      }
    }

    const addon = ctx.addons.find((a) => a.instanceId === instanceId);

    if (!addon) {
      logger.error(`Addon with instanceId ${instanceId} not found`);
      continue;
    }

    // Filter and merge resources
    for (const resource of addonResources) {
      if (
        addon.resources &&
        addon.resources.length > 0 &&
        !addon.resources.includes(resource.name)
      ) {
        addonResources = addonResources.filter((r) => r.name !== resource.name);
        continue;
      }

      const existing = ctx.finalResources.find((r) => r.name === resource.name);
      if (existing) {
        existing.types = [...new Set([...existing.types, ...resource.types])];
        if (
          existing.idPrefixes &&
          existing.idPrefixes.length > 0 &&
          resource.idPrefixes &&
          resource.idPrefixes.length > 0
        ) {
          existing.idPrefixes = [
            ...new Set([...existing.idPrefixes, ...resource.idPrefixes]),
          ];
        } else {
          if (resource.name !== 'catalog' && !resource.idPrefixes?.length) {
            logger.warn(
              `Addon ${getAddonName(addon)} does not provide idPrefixes for type ${resource.name}, setting idPrefixes to undefined`
            );
          }
          existing.idPrefixes = undefined;
        }
      } else {
        if (!resource.idPrefixes?.length && resource.name !== 'catalog') {
          logger.warn(
            `Addon ${getAddonName(addon)} does not provide idPrefixes for type ${resource.name}, setting idPrefixes to undefined`
          );
        }
        ctx.finalResources.push({
          ...resource,
          idPrefixes: resource.idPrefixes?.length
            ? resource.idPrefixes
            : undefined,
        });
      }
    }

    logger.verbose(
      `Determined that ${getAddonName(addon)} (Instance ID: ${instanceId}) has support for the following resources: ${JSON.stringify(
        addonResources
      )}`
    );

    if (
      !addon.resources?.length ||
      (addon.resources && addon.resources.includes('catalog'))
    ) {
      ctx.finalCatalogs.push(
        ...manifest.catalogs.map((catalog) => ({
          ...catalog,
          id: `${addon.instanceId}.${catalog.id}`,
        }))
      );
    }

    if (manifest.addonCatalogs) {
      ctx.finalAddonCatalogs!.push(
        ...(manifest.addonCatalogs || []).map((catalog) => ({
          ...catalog,
          id: `${addon.instanceId}.${catalog.id}`,
        }))
      );
    }

    ctx.supportedResources[instanceId] = addonResources;
  }

  // if meta resource exists, add aiostreamserror to idPrefixes only if idPrefixes is defined
  const metaResource = ctx.finalResources.find((r) => r.name === 'meta');
  if (metaResource) {
    if (metaResource.idPrefixes) {
      metaResource.idPrefixes = [...metaResource.idPrefixes, 'aiostreamserror'];
    }
  }

  // Build set of source catalog IDs that are part of enabled merged catalogs
  // This is done BEFORE overrideType is applied so we use the original catalog types
  const catalogsInMergedCatalogs = new Set<string>();
  if (ctx.userData.mergedCatalogs?.length) {
    const enabledMergedCatalogs = ctx.userData.mergedCatalogs.filter(
      (mc) => mc.enabled !== false
    );
    for (const mc of enabledMergedCatalogs) {
      for (const encodedCatalogId of mc.catalogIds) {
        const params = new URLSearchParams(encodedCatalogId);
        const catalogId = params.get('id');
        const catalogType = params.get('type');
        if (catalogId && catalogType) {
          catalogsInMergedCatalogs.add(`${catalogId}-${catalogType}`);
        }
      }
    }
  }

  // Add enabled merged catalogs to finalCatalogs BEFORE sorting
  // so they participate in the natural catalogModifications-based sort
  if (ctx.userData.mergedCatalogs?.length) {
    const enabledMergedCatalogs = ctx.userData.mergedCatalogs.filter(
      (mc) => mc.enabled !== false
    );
    for (const mc of enabledMergedCatalogs) {
      const mergedExtras = buildMergedCatalogExtras(ctx, mc.catalogIds);
      ctx.finalCatalogs.push({
        id: mc.id,
        name: mc.name,
        type: mc.type,
        extra: mergedExtras.length > 0 ? mergedExtras : undefined,
      });
    }
  }

  if (ctx.userData.catalogModifications) {
    ctx.finalCatalogs = ctx.finalCatalogs
      .sort((a, b) => {
        const aModIndex = ctx.userData.catalogModifications!.findIndex(
          (mod) => mod.id === a.id && mod.type === a.type
        );
        const bModIndex = ctx.userData.catalogModifications!.findIndex(
          (mod) => mod.id === b.id && mod.type === b.type
        );

        if (aModIndex === -1 && bModIndex === -1) {
          return ctx.finalCatalogs.indexOf(a) - ctx.finalCatalogs.indexOf(b);
        }

        if (aModIndex === -1) return 1;
        if (bModIndex === -1) return -1;

        return aModIndex - bModIndex;
      })
      .filter((catalog) => {
        if (catalog.id.startsWith('aiostreams.merged.')) {
          const modification = ctx.userData.catalogModifications!.find(
            (mod) => mod.id === catalog.id && mod.type === catalog.type
          );
          return modification?.enabled !== false;
        }

        const key = `${catalog.id}-${catalog.type}`;
        if (catalogsInMergedCatalogs.has(key)) {
          logger.debug(
            `Filtering out catalog ${catalog.id} of type ${catalog.type} as it is part of an enabled merged catalog`
          );
          return false;
        }

        const modification = ctx.userData.catalogModifications!.find(
          (mod) => mod.id === catalog.id && mod.type === catalog.type
        );
        return modification?.enabled !== false;
      })
      .map((catalog) => {
        const modification = ctx.userData.catalogModifications!.find(
          (mod) => mod.id === catalog.id && mod.type === catalog.type
        );
        if (modification?.name) {
          catalog.name = modification.name;
        }

        const canApplyOnlyOnDiscover = catalog.extra
          ? catalog.extra.every((e) => !e.isRequired)
          : true;
        const canApplyOnlyOnSearch = catalog.extra?.some(
          (e) => e.name === 'search' && !e.isRequired
        );
        const canDisableSearch = catalog.extra?.some(
          (e) => e.name === 'search' && !e.isRequired
        );

        if (modification?.onlyOnDiscover && canApplyOnlyOnDiscover) {
          const genreExtra = catalog.extra?.find((e) => e.name === 'genre');
          if (genreExtra) {
            if (!genreExtra.isRequired) {
              genreExtra.options?.unshift('None');
            }
            genreExtra.isRequired = true;
          } else {
            if (!catalog.extra) {
              catalog.extra = [];
            }
            catalog.extra.push({
              name: 'genre',
              options: ['None'],
              isRequired: true,
            });
          }
        } else if (modification?.onlyOnSearch && canApplyOnlyOnSearch) {
          const searchExtra = catalog.extra?.find((e) => e.name === 'search');
          if (searchExtra) {
            searchExtra.isRequired = true;
          }
        }
        if (modification?.overrideType !== undefined) {
          catalog.type = modification.overrideType;
        }
        if (modification?.disableSearch && canDisableSearch) {
          catalog.extra = catalog.extra?.filter((e) => e.name !== 'search');
        }
        return catalog;
      });
  }
}

async function getProxyIp(ctx: AIOStreamsContext): Promise<string | undefined> {
  let userIp = ctx.userData.ip;
  const PRIVATE_IP_REGEX =
    /^(::1|::ffff:(10|127|192|172)\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})|10\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})|127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})|192\.168\.(\d{1,3})\.(\d{1,3})|172\.(1[6-9]|2[0-9]|3[0-1])\.(\d{1,3})\.(\d{1,3}))$/;

  if (userIp && PRIVATE_IP_REGEX.test(userIp)) {
    userIp = undefined;
  }
  if (!ctx.userData.proxy) {
    return userIp;
  }

  const proxy = createProxy(ctx.userData.proxy);
  if (proxy.getConfig().enabled) {
    userIp = await retryGetIp(() => proxy.getPublicIp(), 'Proxy public IP');
  }
  return userIp;
}

async function retryGetIp<T>(
  getter: () => Promise<T | null>,
  label: string,
  maxRetries: number = 3
): Promise<T> {
  let lastError: string | null = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await getter();
      if (result) {
        return result;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      logger.warn(
        `Failed to get ${label}, retrying... (${attempt}/${maxRetries})`,
        {
          error: lastError,
        }
      );
    }
  }
  throw new Error(
    `Failed to get ${label} after ${maxRetries} attempts: ${lastError}`
  );
}

export async function assignPublicIps(ctx: AIOStreamsContext): Promise<void> {
  let userIp = ctx.userData.ip;
  let proxyIp = undefined;
  if (ctx.userData.proxy?.enabled) {
    proxyIp = await getProxyIp(ctx);
  }
  for (const addon of ctx.addons) {
    const proxy =
      ctx.userData.proxy?.enabled &&
      (!ctx.userData.proxy?.proxiedAddons?.length ||
        ctx.userData.proxy.proxiedAddons.includes(addon.preset.id));
    logger.debug(
      `Using ${proxy ? 'proxy' : 'user'} ip for ${getAddonName(addon)}: ${
        proxy
          ? maskSensitiveInfo(proxyIp ?? 'none')
          : maskSensitiveInfo(userIp ?? 'none')
      }`
    );
    if (proxy) {
      addon.ip = proxyIp;
    } else {
      addon.ip = userIp;
    }
  }
}
