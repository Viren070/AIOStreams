import { UserData } from '@aiostreams/core';
import { getObjectDiff, sortKeys, DiffItem } from './diff';

/** Strip volatile / identity fields that should never appear in a diff. */
export function filterForDiff(d: UserData | null): UserData | null {
  if (!d) return d;
  const filtered: any = { ...d };
  delete filtered.ip;
  delete filtered.uuid;
  delete filtered.addonPassword;
  delete filtered.trusted;
  delete filtered.encryptedPassword;
  delete filtered.showChanges;
  if (filtered.parentConfig?.password) {
    filtered.parentConfig = { ...filtered.parentConfig, password: '[hidden]' };
  }
  return sortKeys(filtered) as UserData;
}

/**
 * Replace raw addon instance IDs inside groupings with their human-readable
 * names, so the diff shows "Torrentio" instead of "abc123".
 */
export function resolveNamesInConfig(
  conf: UserData | null,
  presetsSource: UserData['presets']
): UserData | null {
  if (!conf || !conf.groups) return conf;
  const newConf = { ...conf, groups: { ...conf.groups } };
  if (newConf.groups.groupings) {
    newConf.groups.groupings = newConf.groups.groupings.map((g: any) => {
      if (Array.isArray(g.addons)) {
        return {
          ...g,
          addons: g.addons.map((id: string) => {
            const find = (list?: any[]) =>
              list?.find((p) => p.instanceId === id || p.options?.id === id);
            const item = find(presetsSource);
            return item?.options?.name || id;
          }),
        };
      }
      return g;
    });
  }
  return newConf;
}

function resolveId(v: string, allPresets: UserData['presets']): string {
  const addon = allPresets?.find((p) => {
    if (p.instanceId === v) return true;
    const opts = p.options as Record<string, any>;
    return opts?.id === v;
  });
  if (addon) {
    const opts = addon.options as Record<string, any>;
    if (opts?.name && typeof opts.name === 'string') return opts.name;
  }
  return v;
}

/**
 * Returns a formatter function that recursively replaces addon IDs with names
 * and JSON-serialises objects for display in the diff viewer.
 */
export function createValueFormatter(
  allPresets: UserData['presets']
): (val: any) => string {
  const resolveDeep = (v: any): any => {
    if (typeof v === 'string') return resolveId(v, allPresets);
    if (Array.isArray(v)) return v.map(resolveDeep);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v).map(([k, value]) => [k, resolveDeep(value)])
      );
    }
    return v;
  };

  return (val: any): string => {
    const resolved = resolveDeep(val);
    if (typeof resolved === 'object' && resolved !== null) {
      try {
        return JSON.stringify(resolved, null, 2);
      } catch {
        return '[Circular Reference]';
      }
    }
    return String(resolved);
  };
}

export interface UserDataDiffResult {
  diffs: DiffItem[];
  processedOld: UserData | null;
  processedNew: UserData | null;
}

export function computeUserDataDiff(
  oldConfig: UserData | null,
  newConfig: UserData | null
): UserDataDiffResult {
  const allPresets: UserData['presets'] = [
    ...(oldConfig?.presets ?? []),
    ...(newConfig?.presets ?? []),
  ];

  const filteredOld = filterForDiff(oldConfig);
  const filteredNew = filterForDiff(newConfig);
  const processedOld = resolveNamesInConfig(filteredOld, allPresets);
  const processedNew = resolveNamesInConfig(filteredNew, allPresets);
  const diffs = getObjectDiff(processedOld, processedNew);

  return { diffs, processedOld, processedNew };
}
