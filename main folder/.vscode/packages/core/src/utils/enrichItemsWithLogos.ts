import { fetchLogoForItem } from './fetchLogo';

/**
 * Batch enriches an array of meta/catalog items with the `logo` property using fetchLogoForItem.
 * Always sets the `logo` property (null if not found).
 * @param items Array of meta/catalog items (must have id and type)
 * @returns Promise of enriched items
 */
export async function enrichItemsWithLogos(items: any[]): Promise<any[]> {
  return Promise.all(
    items.map(async (item) => {
      const typeForLogo = item.type === 'collection' ? 'collection' : item.type;
      let logo = await fetchLogoForItem(item.id, typeForLogo);
      // Force fallback for collections if logo is missing
      if (typeForLogo === 'collection' && (!logo || logo === '')) {
        logo = 'https://static.strem.io/catimg/collection-default.png';
      }
      return { ...item, logo: logo || null };
    })
  );
}
