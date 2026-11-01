import type { Catalog, CollectionType } from './dto.js';

export const COLLECTION_ENTRY = 'collection';

export type ViewKind = CollectionType | 'mixed';

/**
 * Checks whether a catalog is a dedicated boxset / collection catalog.
 *
 * Matches catalog types like 'collection', 'collections', 'boxset', or 'boxsets',
 * or IDs containing collection identifiers. Catalog name is excluded so regular
 * movie catalogs with "Collection" in the title are not misidentified.
 *
 * @param catalog - Catalog metadata descriptor.
 * @returns True if the catalog represents boxsets / collections.
 */
export function isBoxsetCatalog(
  catalog: { type: string; id: string; name?: string } | undefined
): boolean {
  if (!catalog) return false;
  return (
    /^(collections?|boxsets?)$/i.test(catalog.type) ||
    /\bcollections?\b/i.test(catalog.id)
  );
}

/**
 * Determines whether a catalog entry represents a BoxSet.
 *
 * @param preview - Entry preview metadata.
 * @param catalog - Optional containing catalog descriptor.
 * @returns True if the preview is a boxset entry.
 */
export function isBoxsetEntry(
  preview: { type: string; collection?: unknown },
  catalog?: { type: string; id: string; name?: string }
): boolean {
  return (
    !!preview.collection ||
    (isBoxsetCatalog(catalog) && preview.type === 'movie')
  );
}

/**
 * Determines the Jellyfin view collection type for a catalog based on its
 * declared metadata and sniffed entry types.
 *
 * @param catalog - The catalog definition to classify.
 * @param entryTypes - The distinct entry types sniffed from the catalog's first page.
 * @returns The collection type ('movies', 'tvshows', 'boxsets') or 'mixed'.
 */
export function collectionTypeFor(
  catalog: Catalog,
  entryTypes: string[]
): ViewKind {
  const boxsets =
    /collections?/i.test(catalog.name) ||
    /^(collections?|boxsets?)$/i.test(catalog.type);
  const playable = entryTypes.filter(
    (t) =>
      t === 'movie' || t === 'series' || t === 'anime' || t === COLLECTION_ENTRY
  );
  if (playable.length) {
    if (playable.every((t) => t === COLLECTION_ENTRY)) return 'boxsets';
    if (
      playable.includes(COLLECTION_ENTRY) &&
      playable.every((t) => t === 'movie' || t === COLLECTION_ENTRY)
    )
      return boxsets ? 'boxsets' : 'movies';
    if (playable.every((t) => t === 'movie')) return 'movies';
    if (playable.every((t) => t === 'series' || t === 'anime'))
      return 'tvshows';
    // Both kinds: fall through to the declared type, since a client may drop a
    // library with no CollectionType rather than browse it as mixed.
  }
  if (
    boxsets &&
    catalog.type !== 'movie' &&
    catalog.type !== 'series' &&
    catalog.type !== 'anime'
  )
    return 'boxsets';
  switch (catalog.type) {
    case 'movie':
      return 'movies';
    case 'series':
    case 'anime':
      return 'tvshows';
    default:
      return boxsets ? 'boxsets' : 'mixed';
  }
}

/**
 * Resolves the view's CollectionType, absent when the catalog is mixed.
 *
 * @param catalog - The catalog definition.
 * @param entryTypes - The distinct entry types sniffed from the catalog.
 * @returns The resolved CollectionType, or undefined if mixed.
 */
export function viewCollectionType(
  catalog: Catalog,
  entryTypes: string[]
): CollectionType | undefined {
  const kind = collectionTypeFor(catalog, entryTypes);
  return kind === 'mixed' ? undefined : kind;
}
