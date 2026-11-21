/* eslint-disable lingui/no-unlocalized-strings -- test names, never shown to users */
import { describe, it, expect } from 'vitest';
import type { BaseItemDto, BaseItemDtoQueryResult } from './types';
import {
  EPISODE_PAGE,
  fetchShowEpisodes,
  type ShowEpisodesClient,
} from './show-episodes';

function episode(n: number): BaseItemDto {
  return { Id: `ep-${n}`, IndexNumber: n } as BaseItemDto;
}

/**
 * A server that behaves like AIOStreams' `/Shows/{id}/Episodes`: no Limit
 * means 1000 at most, an explicit Limit is honoured up to 2000, and the
 * answer always carries the show's full TotalRecordCount.
 */
function cappedServer(
  total: number,
  reportTotal = true
): {
  client: ShowEpisodesClient;
  calls: { StartIndex?: number; Limit?: number; SeasonId?: string }[];
} {
  const calls: { StartIndex?: number; Limit?: number; SeasonId?: string }[] =
    [];
  const client: ShowEpisodesClient = {
    get: async <T>(path: string, query?: Record<string, unknown>) => {
      expect(path).toBe('/Shows/series-1/Episodes');
      const limit = Math.min(Math.max(1, Number(query?.Limit ?? 1000)), 2000);
      const start = Math.max(0, Number(query?.StartIndex ?? 0));
      calls.push({
        StartIndex: query?.StartIndex as number | undefined,
        Limit: query?.Limit as number | undefined,
        SeasonId: query?.SeasonId as string | undefined,
      });
      const items = Array.from(
        { length: Math.max(0, Math.min(limit, total - start)) },
        (_, i) => episode(start + i + 1)
      );
      return {
        Items: items,
        TotalRecordCount: reportTotal ? total : undefined,
        StartIndex: start,
      } as T;
    },
  };
  return { client, calls };
}

describe('fetchShowEpisodes', () => {
  it('fetches a short season in one request', async () => {
    const { client, calls } = cappedServer(42);
    const res = await fetchShowEpisodes(client, 'user-1', 'series-1', {
      SeasonId: 'season-1',
    });
    expect(calls).toEqual([
      { StartIndex: 0, Limit: EPISODE_PAGE, SeasonId: 'season-1' },
    ]);
    expect(res.Items).toHaveLength(42);
    expect(res.Items?.[0].IndexNumber).toBe(1);
    expect(res.Items?.[41].IndexNumber).toBe(42);
    expect(res.TotalRecordCount).toBe(42);
  });

  it('pages past the 1000-episode cap until the whole season is listed', async () => {
    const { client, calls } = cappedServer(2500);
    const res: BaseItemDtoQueryResult = await fetchShowEpisodes(
      client,
      'user-1',
      'series-1'
    );
    // A single uncapped request would stop at 1000; paging fetches all 2500.
    expect(calls).toEqual([
      { StartIndex: 0, Limit: EPISODE_PAGE, SeasonId: undefined },
      { StartIndex: 1000, Limit: EPISODE_PAGE, SeasonId: undefined },
      { StartIndex: 2000, Limit: EPISODE_PAGE, SeasonId: undefined },
    ]);
    expect(res.Items).toHaveLength(2500);
    expect(res.Items?.map((e) => e.IndexNumber)).toEqual(
      Array.from({ length: 2500 }, (_, i) => i + 1)
    );
    expect(res.TotalRecordCount).toBe(2500);
  });

  it('stops exactly at a season of 2000 episodes', async () => {
    const { client, calls } = cappedServer(2000);
    const res = await fetchShowEpisodes(client, 'user-1', 'series-1');
    expect(calls).toHaveLength(2);
    expect(res.Items).toHaveLength(2000);
    expect(res.TotalRecordCount).toBe(2000);
  });

  it('stops on a short page when the server reports no total', async () => {
    const { client, calls } = cappedServer(1500, false);
    const res = await fetchShowEpisodes(client, 'user-1', 'series-1');
    expect(calls).toHaveLength(2);
    expect(res.Items).toHaveLength(1500);
    expect(res.TotalRecordCount).toBe(1500);
  });

  it('returns an empty list for a season with no episodes', async () => {
    const { client } = cappedServer(0);
    const res = await fetchShowEpisodes(client, 'user-1', 'series-1');
    expect(res.Items).toHaveLength(0);
    expect(res.TotalRecordCount).toBe(0);
  });
});
