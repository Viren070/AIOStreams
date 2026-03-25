import { DiffAnnotation } from '@/components/shared/diff-viewer';
import { DiffItem, getObjectDiff } from './diff';

interface ManifestCatalog {
  type: string;
  id: string;
  name: string;
  extra?: Array<{
    name: string;
    isRequired?: boolean;
    options?: any;
    optionsLimit?: number;
  }>;
}

interface ManifestResource {
  name: string;
  types: string[];
  idPrefixes?: string[] | null;
}

interface Manifest {
  catalogs?: ManifestCatalog[];
  resources?: Array<string | ManifestResource>;
  idPrefixes?: string[] | null;
  [key: string]: any;
}

/** Human-readable label for a catalog: "Movie Streams (movie)" */
export function catalogLabel(catalog: ManifestCatalog): string {
  return `${catalog.name} (${catalog.type})`;
}

/** Resolve a manifest value for display. Catalog objects become label strings. */
export function manifestValueFormatter(value: any): string {
  if (value == null) return String(value);

  // A single catalog object
  if (isCatalogObject(value)) {
    return catalogLabel(value as ManifestCatalog);
  }

  // An array that looks like catalogs (order-change diff emits string[])
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v === 'string')) {
      // order-change list already pre-formatted by getLabel in diff.ts
      return value.join('\n');
    }
    if (value.every(isCatalogObject)) {
      return (value as ManifestCatalog[]).map(catalogLabel).join('\n');
    }
  }

  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return '[object]';
    }
  }

  return String(value);
}

function isCatalogObject(v: any): boolean {
  return (
    v != null &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    typeof v.type === 'string' &&
    typeof v.id === 'string' &&
    typeof v.name === 'string'
  );
}

/**
 * Produces a clean diff between two manifests.
 * - Ignores volatile fields (id, version, description, name, logo, behaviorHints, stremioAddonsConfig)
 * - Keeps catalogs, resources, idPrefixes, types, addonCatalogs
 */
function normaliseManifest(m: Manifest): Partial<Manifest> {
  const {
    id,
    version,
    description,
    name,
    logo,
    behaviorHints,
    stremioAddonsConfig,
    ...rest
  } = m;
  void id;
  void version;
  void description;
  void name;
  void logo;
  void behaviorHints;
  void stremioAddonsConfig;
  return rest;
}

/**
 * Diff two catalog arrays using a composite `type:id` key so that:
 * - Catalogs sharing only `id` (different `type`) are matched correctly
 * - Pure reordering is detected as a single CHANGE on `catalogs` rather than
 *   pairs of REMOVE + ADD
 */
function diffCatalogsKeyed(
  oldCatalogs: ManifestCatalog[],
  newCatalogs: ManifestCatalog[]
): DiffItem[] {
  const getKey = (c: ManifestCatalog) => `${c.type}:${c.id}`;

  // Bail out if either array has duplicate composite keys — fall back gracefully
  const oldKeys = oldCatalogs.map(getKey);
  const newKeys = newCatalogs.map(getKey);
  if (
    new Set(oldKeys).size !== oldCatalogs.length ||
    new Set(newKeys).size !== newCatalogs.length
  ) {
    return getObjectDiff(
      { catalogs: oldCatalogs },
      { catalogs: newCatalogs }
    ).map((d) => ({ ...d })); // already prefixed with 'catalogs'
  }

  const oldMap = new Map(oldCatalogs.map((c) => [getKey(c), c]));
  const newMap = new Map(newCatalogs.map((c) => [getKey(c), c]));

  const diffs: DiffItem[] = [];

  // Removed catalogs
  for (const key of oldKeys) {
    if (!newMap.has(key)) {
      const idx = oldKeys.indexOf(key);
      diffs.push({
        path: ['catalogs', `[${idx}]`],
        type: 'REMOVE',
        oldValue: oldMap.get(key),
      });
    }
  }

  // Added catalogs + field-level changes within existing catalogs
  for (const key of newKeys) {
    const idx = newKeys.indexOf(key);
    if (!oldMap.has(key)) {
      diffs.push({
        path: ['catalogs', `[${idx}]`],
        type: 'ADD',
        newValue: newMap.get(key),
      });
    } else {
      const subDiffs = getObjectDiff(oldMap.get(key), newMap.get(key));
      for (const d of subDiffs) {
        diffs.push({ ...d, path: ['catalogs', `[${idx}]`, ...d.path] });
      }
    }
  }

  // Order change: compare the relative order of keys that exist in both arrays
  const sharedOld = oldKeys.filter((k) => newMap.has(k));
  const sharedNew = newKeys.filter((k) => oldMap.has(k));
  const isReordered = sharedOld.some((k, i) => k !== sharedNew[i]);

  if (isReordered) {
    const getLabel = (key: string) => {
      const c = newMap.get(key) ?? oldMap.get(key);
      return c ? catalogLabel(c) : key;
    };
    diffs.push({
      path: ['catalogs'],
      type: 'CHANGE',
      oldValue: oldKeys.map(getLabel),
      newValue: newKeys.map(getLabel),
    });
  }

  return diffs;
}

/**
 * Groups individual idPrefix ADD/REMOVE diffs (e.g. `resources[0].idPrefixes[1]`)
 * into a single diff per parent array (e.g. `resources[0].idPrefixes`), and
 * filters out order-only CHANGE diffs on idPrefixes arrays (order is a no-op in Stremio).
 */
function groupAndFilterIdPrefixDiffs(diffs: DiffItem[]): DiffItem[] {
  const result: DiffItem[] = [];
  const addGroups = new Map<string, { parentPath: string[]; values: any[] }>();
  const removeGroups = new Map<
    string,
    { parentPath: string[]; values: any[] }
  >();

  for (const diff of diffs) {
    const lastSeg = diff.path[diff.path.length - 1] ?? '';
    const parentSeg = diff.path[diff.path.length - 2];
    const isIdPrefixElement =
      parentSeg === 'idPrefixes' && /^\[\d+\]$/.test(lastSeg);

    if (isIdPrefixElement && diff.type === 'ADD') {
      const parentPath = diff.path.slice(0, -1);
      const key = parentPath.join('\0');
      if (!addGroups.has(key)) addGroups.set(key, { parentPath, values: [] });
      addGroups.get(key)!.values.push(diff.newValue);
      continue;
    }

    if (isIdPrefixElement && diff.type === 'REMOVE') {
      const parentPath = diff.path.slice(0, -1);
      const key = parentPath.join('\0');
      if (!removeGroups.has(key))
        removeGroups.set(key, { parentPath, values: [] });
      removeGroups.get(key)!.values.push(diff.oldValue);
      continue;
    }

    // Filter array-to-array CHANGE diffs on idPrefixes. When getObjectDiff
    // compares two string arrays via the keyed path, the only CHANGE it emits
    // at the array level is an order-change diff (individual element additions/
    // removals are emitted as REMOVE/ADD at the element level, handled above).
    // idPrefixes order is irrelevant to Stremio, so these order CHANGEs are no-ops.
    if (
      diff.type === 'CHANGE' &&
      diff.path[diff.path.length - 1] === 'idPrefixes' &&
      Array.isArray(diff.oldValue) &&
      Array.isArray(diff.newValue)
    ) {
      continue;
    }

    result.push(diff);
  }

  for (const [, { parentPath, values }] of addGroups) {
    result.push({ path: parentPath, type: 'ADD', newValue: values });
  }
  for (const [, { parentPath, values }] of removeGroups) {
    result.push({ path: parentPath, type: 'REMOVE', oldValue: values });
  }

  return result;
}

export function computeManifestDiff(
  oldManifest: Manifest,
  newManifest: Manifest
): { diffs: DiffItem[]; annotations: Map<string, DiffAnnotation> } {
  // Diff everything except catalogs using the generic differ
  const oldNorm = normaliseManifest(oldManifest);
  const newNorm = normaliseManifest(newManifest);
  const { catalogs: _oc, ...oldRest } = oldNorm as any;
  const { catalogs: _nc, ...newRest } = newNorm as any;
  void _oc;
  void _nc;
  const nonCatalogDiffs = groupAndFilterIdPrefixDiffs(
    getObjectDiff(oldRest, newRest)
  );

  // Diff catalogs separately with a composite type:id key so reordering is
  // detected correctly even when multiple catalogs share the same id.
  const catalogDiffs = diffCatalogsKeyed(
    oldManifest.catalogs ?? [],
    newManifest.catalogs ?? []
  );

  const diffs = [...nonCatalogDiffs, ...catalogDiffs];
  const annotations = buildAnnotations(diffs, oldManifest, newManifest);

  return { diffs, annotations };
}

function buildAnnotations(
  diffs: DiffItem[],
  oldManifest: Manifest,
  newManifest: Manifest
): Map<string, DiffAnnotation> {
  const map = new Map<string, DiffAnnotation>();

  for (const diff of diffs) {
    const pathStr = diff.path.join('.').replace(/\.\[/g, '[');
    const firstSegment = diff.path[0];

    // ── Catalog-related changes ───────────────────────────────────────────────
    if (firstSegment === 'catalogs') {
      const isCatalogOrder = diff.path.length === 1 && diff.type === 'CHANGE';
      const isCatalogAdd = diff.type === 'ADD' && diff.path.length === 2;
      const isCatalogRemove = diff.type === 'REMOVE' && diff.path.length === 2;
      const isCatalogFieldChange = diff.path.length >= 3;

      if (isCatalogOrder) {
        map.set(pathStr, {
          label: '⚑ CATALOG ORDER',
          className: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
          severity: 'warning',
          description:
            'Catalog ordering has changed. Stremio will display them in the old order until you reinstall.',
        });
      } else if (isCatalogAdd) {
        const catalog = diff.newValue as ManifestCatalog | undefined;
        const label = catalog ? catalogLabel(catalog) : 'Unknown';
        map.set(pathStr, {
          label: '⚑ NEW CATALOG',
          className: 'bg-green-500/10 text-green-400 border-green-500/20',
          severity: 'critical',
          description: `"${label}" was added. It won't appear in Stremio until you reinstall.`,
        });
      } else if (isCatalogRemove) {
        const catalog = diff.oldValue as ManifestCatalog | undefined;
        const label = catalog ? catalogLabel(catalog) : 'Unknown';
        map.set(pathStr, {
          label: '⚑ CATALOG REMOVED',
          className: 'bg-red-500/10 text-red-400 border-red-500/20',
          severity: 'critical',
          description: `"${label}" was removed. It will appear empty or broken in Stremio until you reinstall.`,
        });
      } else if (isCatalogFieldChange) {
        // Find parent catalog for context
        const indexMatch = diff.path[1]?.match(/\[(\d+)\]/);
        const catalogIndex = indexMatch ? parseInt(indexMatch[1], 10) : -1;
        const catalog =
          catalogIndex >= 0
            ? (newManifest.catalogs?.[catalogIndex] ??
              oldManifest.catalogs?.[catalogIndex])
            : undefined;
        const ctxLabel = catalog ? catalogLabel(catalog) : '';
        const isExtraRequired =
          diff.path.length >= 4 &&
          diff.path[2] === 'extra' &&
          diff.path[diff.path.length - 1] === 'isRequired';
        if (isExtraRequired) {
          map.set(pathStr, {
            label: '⚑ EXTRA REQUIRED',
            className: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
            severity: 'warning',
            description: `An extra parameter's "required" status changed in catalog${ctxLabel ? `: ${ctxLabel}` : ''}.`,
          });
        } else {
          map.set(pathStr, {
            label: '⚑ CATALOG CHANGED',
            className: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
            severity: 'warning',
            description: ctxLabel ? `In catalog: ${ctxLabel}` : undefined,
          });
        }
      }
      continue;
    }

    // ── idPrefixes at top level ───────────────────────────────────────────────
    if (firstSegment === 'idPrefixes') {
      if (
        diff.type === 'ADD' ||
        (diff.type === 'CHANGE' &&
          hasNewIdPrefixes(diff, oldManifest.idPrefixes))
      ) {
        map.set(pathStr, {
          label: '⚑ NEW ID PREFIXES',
          className: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
          severity: 'critical',
          description:
            "New ID prefixes were added to the manifest. Stremio won't know that this install supports these new prefixes, so it won't query AIOStreams for matching content until you reinstall.",
        });
      }
      continue;
    }

    // ── idPrefixes inside a resource object ───────────────────────────────────
    if (
      firstSegment === 'resources' &&
      diff.path.some((p) => p === 'idPrefixes')
    ) {
      if (diff.type === 'ADD' || diff.type === 'CHANGE') {
        const indexMatch = diff.path[1]?.match(/\[(\d+)\]/);
        const resourceIndex = indexMatch ? parseInt(indexMatch[1], 10) : -1;
        const resource =
          resourceIndex >= 0
            ? ((newManifest.resources ?? [])[resourceIndex] ??
              (oldManifest.resources ?? [])[resourceIndex])
            : undefined;
        const resourceName =
          typeof resource === 'string'
            ? resource
            : typeof resource?.name === 'string'
              ? resource.name
              : 'this resource';
        map.set(pathStr, {
          label: '⚑ NEW ID PREFIXES',
          className: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
          severity: 'critical',
          description: `Stremio won't know that this install supports the new ID prefix(es) for the ${resourceName} resource. Until you reinstall, Stremio won't query AIOStreams for ${resourceName} content with these new prefixes.`,
        });
      }
      continue;
    }

    // ── New resource object added ─────────────────────────────────────────────
    if (
      firstSegment === 'resources' &&
      diff.type === 'ADD' &&
      diff.path.length === 2
    ) {
      const resource = diff.newValue;
      const resourceName =
        typeof resource === 'string'
          ? resource
          : typeof resource?.name === 'string'
            ? resource.name
            : 'Unknown';
      map.set(pathStr, {
        label: '⚑ NEW RESOURCE',
        className: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
        severity: 'critical',
        description: `${resourceName} support was added. Stremio won't request ${resourceName} content from AIOStreams until you reinstall — e.g. if subtitles were added, they won't appear until then.`,
      });
    }
  }

  return map;
}

/**
 * Returns true when computeManifestDiff produces at least one diff after
 * filtering no-op changes (e.g. idPrefixes reordering).
 * Use this instead of raw JSON.stringify comparison to avoid spurious modals.
 */
export function hasAnyManifestChanges(
  oldManifest: Manifest,
  newManifest: Manifest
): boolean {
  const { diffs } = computeManifestDiff(oldManifest, newManifest);
  return diffs.length > 0;
}

/**
 * Quick check: does the diff contain any critical or warning annotations?
 * Used by save.tsx to decide whether to suppress the insignificant-change modal.
 */
export function hasSevereManifestChanges(
  oldManifest: Manifest,
  newManifest: Manifest
): boolean {
  const { annotations } = computeManifestDiff(oldManifest, newManifest);
  return Array.from(annotations.values()).some(
    (ann) => ann.severity === 'critical' || ann.severity === 'warning'
  );
}

/** True if the new value of an idPrefixes diff contains entries not present before */
function hasNewIdPrefixes(
  diff: DiffItem,
  oldPrefixes: string[] | null | undefined
): boolean {
  const oldSet = new Set<string>(oldPrefixes ?? []);
  if (Array.isArray(diff.newValue)) {
    return (diff.newValue as string[]).some((p) => !oldSet.has(p));
  }
  if (typeof diff.newValue === 'string') {
    return !oldSet.has(diff.newValue);
  }
  return false;
}
