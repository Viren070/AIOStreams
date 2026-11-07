import { z } from 'zod';
import type { Manifest, Meta, MetaPreview, Stream } from '../../db/index.js';
import { config as appConfig } from '../../config/index.js';
import { getSimpleTextHash } from '../../utils/index.js';
import { XtreamClient } from './api.js';
import {
  type Lineup,
  channelCount,
  groupsOf,
  iconOf,
  indexOfStream,
  lineupOf,
  nameOf,
  searchLineup,
} from './lineup.js';
import {
  EMPTY,
  type Schedule,
  cachedTable,
  firstOnAt,
  onAt,
  soonOf,
  tableOf,
} from './guide.js';

export const XtreamConfigSchema = z.object({
  server: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
});
export type XtreamConfig = z.infer<typeof XtreamConfigSchema>;

const CATALOG_ID = 'xtream';
const PAGE_SIZE = 100;
const MAX_IDS = 200;
const DAY = 86_400;
/** A window starting within this is answered from what's on soon. */
const SOON = 6 * 3600;
/** How long a table near now may take before what's on soon is asked for too. */
const TABLE_HEAD_START_MS = 800;

type Video = NonNullable<Meta['videos']>[number];

/** Programmes mostly start and end on the same few times of day. */
const isoTimes = new Map<number, string>();

function isoTime(seconds: number): string {
  let iso = isoTimes.get(seconds);
  if (iso === undefined) {
    if (isoTimes.size >= 20_000) isoTimes.clear();
    iso = new Date(seconds * 1000).toISOString();
    isoTimes.set(seconds, iso);
  }
  return iso;
}

function parseExtras(extras?: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of extras?.split('&') ?? []) {
    const [key, ...rest] = part.split('=');
    try {
      out[key] = decodeURIComponent(rest.join('='));
    } catch {
      out[key] = rest.join('=');
    }
  }
  return out;
}

export class XtreamAddon {
  private readonly client: XtreamClient;
  /** Per account, so two logins in one config keep their channels apart. */
  private readonly prefix: string;

  constructor(config: unknown) {
    const login = XtreamConfigSchema.parse(config);
    this.client = new XtreamClient(login);
    this.prefix = `xtream.${getSimpleTextHash(login.username).slice(0, 8)}:`;
  }

  async getManifest(): Promise<Manifest> {
    const groups = await groupsOf(this.client);
    return {
      id: `aiostreams.${this.prefix.slice(0, -1)}`,
      version: '1.0.0',
      name: 'Xtream',
      description: 'Live TV from an Xtream login',
      types: ['tv'],
      catalogs: [
        {
          type: 'tv',
          id: CATALOG_ID,
          name: 'Channels',
          extra: [
            { name: 'genre', options: groups, isRequired: false },
            { name: 'skip' },
            { name: 'date' },
            { name: 'ids' },
            { name: 'search' },
          ],
        },
      ],
      resources: [
        { name: 'catalog', types: ['tv'], idPrefixes: [this.prefix] },
        { name: 'meta', types: ['tv'], idPrefixes: [this.prefix] },
        { name: 'stream', types: ['tv'], idPrefixes: [this.prefix] },
      ],
      behaviorHints: { configurable: false, epgProvider: true },
    };
  }

  async getCatalog(
    type: string,
    id: string,
    extras?: string
  ): Promise<{ metas: MetaPreview[] } | { metasDetailed: Meta[] }> {
    if (type !== 'tv' || id !== CATALOG_ID)
      throw new Error(`Unknown catalog ${type}/${id}`);
    const { genre, skip, date, ids, search } = parseExtras(extras);
    const lineup = await lineupOf(this.client);
    const indexes: number[] = [];
    if (ids) {
      for (const id of ids.split(',').slice(0, MAX_IDS)) {
        const index = this.indexOf(lineup, id);
        if (index >= 0) indexes.push(index);
      }
    } else if (search) {
      const start = Math.max(0, Number(skip) || 0);
      indexes.push(
        ...searchLineup(lineup, search, start + PAGE_SIZE).slice(start)
      );
    } else {
      let members: Int32Array | undefined;
      if (genre) {
        members = lineup.members[lineup.groups.indexOf(genre)];
        if (!members) return { metas: [] };
      }
      const total = members ? members.length : channelCount(lineup);
      const start = Math.max(0, Number(skip) || 0);
      for (let at = start; at < Math.min(total, start + PAGE_SIZE); at++)
        indexes.push(members ? members[at] : at);
    }

    const from = date ? Date.parse(`${date}T00:00:00Z`) / 1000 : NaN;
    if (Number.isNaN(from))
      return { metas: indexes.map((i) => this.preview(lineup, i)) };
    const guides = await this.schedules(lineup, indexes, from, from + DAY);
    return {
      metasDetailed: indexes.map((i) => ({
        ...this.preview(lineup, i),
        videos: this.programmes(lineup, i, guides, from, from + DAY),
      })),
    };
  }

  async getMeta(type: string, id: string): Promise<Meta> {
    const lineup = await lineupOf(this.client);
    const index = this.indexOf(lineup, id);
    if (type !== 'tv' || index < 0) throw new Error(`Unknown channel ${id}`);
    const guides = await this.schedules(lineup, [index], 0, Infinity);
    return {
      ...this.preview(lineup, index),
      videos: this.programmes(lineup, index, guides, 0, Infinity),
    };
  }

  async getStreams(type: string, id: string): Promise<Stream[]> {
    const ref = this.parse(id);
    if (type !== 'tv' || !ref) return [];
    const lineup = await lineupOf(this.client);
    const index = indexOfStream(lineup, ref.streamId);
    if (index < 0) return [];
    if (ref.start !== undefined) {
      const now = Date.now() / 1000;
      const days = lineup.archiveDays[index];
      if (ref.start > now) return [];
      if (days && ref.start >= now - days * DAY)
        return [
          {
            url: this.client.archiveUrl(
              ref.streamId,
              ref.start,
              Math.ceil((ref.end - ref.start) / 60),
              lineup.timeZone
            ),
            name: 'Xtream',
            description: 'Catch-up',
            behaviorHints: { notWebReady: true },
          },
        ];
      // Without an archive, a programme on now plays live.
      if (ref.end <= now) return [];
    }
    const formats = lineup.formats.length ? lineup.formats : ['m3u8', 'ts'];
    return [...formats]
      .sort((a, b) => (a === 'm3u8' ? -1 : b === 'm3u8' ? 1 : 0))
      .map((format) => ({
        url: this.client.liveUrl(ref.streamId, format),
        name: 'Xtream',
        description: format === 'm3u8' ? 'HLS' : 'MPEG-TS',
        ...(format === 'ts' && { behaviorHints: { notWebReady: true } }),
      }));
  }

  /** `<prefix><stream id>` for a channel, `:<start>:<end>` after it for a programme. */
  private parse(
    id: string
  ): { streamId: number; start?: number; end: number } | undefined {
    if (!id.startsWith(this.prefix)) return undefined;
    const [streamId, start, end] = id
      .slice(this.prefix.length)
      .split(':')
      .map(Number);
    if (!Number.isFinite(streamId)) return undefined;
    if (start === undefined) return { streamId, end: Infinity };
    if (!Number.isFinite(start) || !(end > start)) return undefined;
    return { streamId, start, end };
  }

  private indexOf(lineup: Lineup, id: string): number {
    const ref = this.parse(id);
    return ref ? indexOfStream(lineup, ref.streamId) : -1;
  }

  private preview(lineup: Lineup, i: number) {
    const icon = iconOf(lineup, i) || undefined;
    const group = lineup.groupOf[i];
    const days = lineup.archiveDays[i];
    return {
      id: `${this.prefix}${lineup.streamIds[i]}`,
      type: 'tv',
      name: nameOf(lineup, i),
      poster: icon,
      posterShape: 'square' as const,
      logo: icon,
      channelNumber: String(lineup.numbers[i] || i + 1),
      genres: group >= 0 ? [lineup.groups[group]] : undefined,
      behaviorHints: days ? { catchupDays: days } : undefined,
    };
  }

  /**
   * The channels' programmes in a window, by guide id index; the past only
   * matters with catch-up.
   */
  private async schedules(
    lineup: Lineup,
    indexes: number[],
    from: number,
    to: number
  ): Promise<Map<number, Schedule>> {
    const found = new Map<number, Schedule>();
    const now = Date.now() / 1000;
    const nearNow = from < now + SOON && to > now;
    const loads: Promise<void>[] = [];
    for (const i of indexes) {
      const epg = lineup.epgOf[i];
      if (epg < 0 || found.has(epg)) continue;
      found.set(epg, EMPTY);
      const epgId = lineup.epgIds[epg];
      const streamId = lineup.streamIds[i];
      const daysBack = lineup.epgArchiveDays[epg];
      if (to <= now && to < now - daysBack * DAY) continue;
      const load = nearNow
        ? this.tableOrSoon(epgId, streamId, daysBack, (soon) =>
            found.set(epg, soon)
          )
        : tableOf(this.client, epgId, streamId, daysBack);
      loads.push(load.then((schedule) => void found.set(epg, schedule)));
    }
    if (!loads.length) return found;
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      Promise.allSettled(loads),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, appConfig.builtins.xtream.pageWait);
      }),
    ]);
    clearTimeout(timer);
    return found;
  }

  /**
   * The table, or what's on soon when the table is slow to come; that stands
   * in until the table arrives unless it leaves out the programme on now, as
   * some servers do.
   */
  private async tableOrSoon(
    epgId: string,
    streamId: number,
    daysBack: number,
    meanwhile: (soon: Schedule) => void
  ): Promise<Schedule> {
    const cached = await cachedTable(this.client, epgId, streamId, daysBack);
    if (cached) return cached;
    const table = tableOf(this.client, epgId, streamId, daysBack);
    let timer: NodeJS.Timeout | undefined;
    const early = await Promise.race([
      table,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), TABLE_HEAD_START_MS);
      }),
    ]);
    clearTimeout(timer);
    if (early?.starts.length) return early;
    const soon = await soonOf(this.client, epgId, streamId);
    if (onAt(soon, Date.now() / 1000)) return soon;
    meanwhile(soon);
    const waited = await table;
    return waited.starts.length ? waited : soon;
  }

  private programmes(
    lineup: Lineup,
    i: number,
    guides: Map<number, Schedule>,
    from: number,
    to: number
  ): Video[] {
    const schedule = guides.get(lineup.epgOf[i]);
    if (!schedule) return [];
    const channel = `${this.prefix}${lineup.streamIds[i]}`;
    const videos: Video[] = [];
    for (
      let at = firstOnAt(schedule, from);
      at < schedule.starts.length && schedule.starts[at] < to;
      at++
    ) {
      const start = schedule.starts[at];
      const end = schedule.ends[at];
      videos.push({
        id: `${channel}:${start}:${end}`,
        title: schedule.titles[at],
        startTime: isoTime(start),
        endTime: isoTime(end),
        overview: schedule.overviews[at] || undefined,
      });
    }
    return videos;
  }
}
