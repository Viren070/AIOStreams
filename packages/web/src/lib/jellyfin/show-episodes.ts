import type { Query } from './client';
import type { BaseItemDto, BaseItemDtoQueryResult } from './types';

/**
 * One page of a show's episodes. The server answers at most 1000 episodes
 * when no Limit is given (2000 at most), so this stays at that default.
 */
export const EPISODE_PAGE = 1000;

/** The least a show-episode fetch needs: a Jellyfin client's `get`. */
export interface ShowEpisodesClient {
  get<T>(path: string, query?: Query, signal?: AbortSignal): Promise<T>;
}

/**
 * A show's episodes, all of them. `/Shows/{id}/Episodes` caps one answer at
 * 1000 episodes, so a long season is fetched page by page until
 * TotalRecordCount is reached — otherwise a show like One Piece stops at
 * episode 1000 in the list, even though later episodes still play.
 */
export async function fetchShowEpisodes(
  client: ShowEpisodesClient,
  userId: string,
  seriesId: string,
  query: Query = {},
  signal?: AbortSignal
): Promise<BaseItemDtoQueryResult> {
  const items: BaseItemDto[] = [];
  let total: number | undefined;
  let start = 0;
  for (;;) {
    const page = await client.get<BaseItemDtoQueryResult>(
      `/Shows/${seriesId}/Episodes`,
      { userId, ...query, StartIndex: start, Limit: EPISODE_PAGE },
      signal
    );
    const pageItems = page.Items ?? [];
    items.push(...pageItems);
    total = page.TotalRecordCount ?? total;
    start += pageItems.length;
    if (
      pageItems.length < EPISODE_PAGE ||
      (total !== undefined && start >= total)
    ) {
      return {
        ...page,
        StartIndex: 0,
        Items: items,
        TotalRecordCount: total ?? items.length,
      };
    }
  }
}
