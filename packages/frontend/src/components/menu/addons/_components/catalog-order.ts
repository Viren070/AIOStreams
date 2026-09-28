import { CatalogModification, UserData } from '@aiostreams/core';

export const catalogKey = (c: Pick<CatalogModification, 'id' | 'type'>) =>
  `${c.id}-${c.type}`;

export const addonOf = (id: string) => id.split('.')[0];

/** An addon's instance id is its preset's id plus a 4-character hash. */
export const presetOf = (id: string) => addonOf(id).slice(0, -4);

export const disabledPresets = (presets: UserData['presets'] | undefined) =>
  new Set((presets ?? []).filter((p) => !p.enabled).map((p) => p.instanceId));

/** Refills each listed addon's positions with its catalogs in the addon's own order. */
export function withUpstreamOrder(
  mods: CatalogModification[],
  addons: ReadonlySet<string>,
  upstreamKeys: string[]
): CatalogModification[] {
  if (!addons.size || !upstreamKeys.length) return mods;
  const rank = new Map(upstreamKeys.map((key, i) => [key, i]));
  const rankOf = (m: CatalogModification) =>
    rank.get(catalogKey(m)) ?? Number.MAX_SAFE_INTEGER;
  const queues = new Map<string, CatalogModification[]>();
  for (const mod of mods) {
    const addon = addonOf(mod.id);
    if (addons.has(addon))
      queues.set(addon, [...(queues.get(addon) ?? []), mod]);
  }
  for (const queue of queues.values())
    queue.sort((a, b) => rankOf(a) - rankOf(b));
  return mods.map((mod) => queues.get(addonOf(mod.id))?.shift() ?? mod);
}
