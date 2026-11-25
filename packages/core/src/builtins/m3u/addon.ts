import { z } from 'zod';
import type { Manifest, Meta, MetaPreview, Stream } from '../../db/index.js';
import { config as appConfig } from '../../config/index.js';
import { getSimpleTextHash } from '../../utils/index.js';
import {
  EMPTY,
  type Schedule,
  parseExtras,
  programmesOf,
  startsFrom,
} from '../livetv/index.js';
import { fillCatchup, fillNow, writesDates } from './catchup.js';
import { type GuideMeta, channelIn, guideOf, schedulesIn } from './guide.js';
import {
  type Lineup,
  catchupDays,
  lineupOf,
  numberOf,
  searchLineup,
} from './lineup.js';

export const M3uConfigSchema = z.object({
  url: z.string().min(1),
  /** Guide addresses in place of the playlist's own. */
  guides: z.array(z.string()).optional(),
});
export type M3uConfig = z.infer<typeof M3uConfigSchema>;

const CATALOG_ID = 'm3u';
const PAGE_SIZE = 100;
const MAX_IDS = 200;
const DAY = 86_400;

const FORMATS: [RegExp, string][] = [
  [/\.m3u8$/i, 'HLS'],
  [/\.mpd$/i, 'DASH'],
  [/\.ts$/i, 'MPEG-TS'],
];

/** By the path alone, as a query may name other files. */
const formatOf = (url: string) => {
  const path = URL.parse(url)?.pathname ?? '';
  return FORMATS.find(([pattern]) => pattern.test(path))?.[1];
};

/** Each address once, numbered when there are several. */
function numbered(streams: Stream[]): Stream[] {
  const unique = streams.filter(
    (s, i) => streams.findIndex((o) => o.url === s.url) === i
  );
  if (unique.length < 2) return unique;
  return unique.map((s, i) => ({
    ...s,
    description: [s.description, `${i + 1} of ${unique.length}`]
      .filter(Boolean)
      .join(' · '),
  }));
}

export class M3uAddon {
  private readonly url: string;
  private readonly guides?: string[];
  /** Per playlist, so two playlists in one config keep their channels apart. */
  private readonly prefix: string;

  constructor(config: unknown) {
    const { url, guides } = M3uConfigSchema.parse(config);
    this.url = url;
    this.guides = guides?.length ? guides : undefined;
    this.prefix = `m3u.${getSimpleTextHash(url).slice(0, 8)}:`;
  }

  private guideUrls(lineup: Lineup): string[] {
    return (this.guides ?? lineup.guideUrls).slice(
      0,
      appConfig.builtins.m3u.guideUrls
    );
  }

  async getManifest(): Promise<Manifest> {
    const lineup = await lineupOf(this.url);
    const guided = this.guideUrls(lineup).length > 0;
    const days = lineup.channels.reduce(
      (most, c) => Math.max(most, catchupDays(c)),
      0
    );
    return {
      id: `aiostreams.${this.prefix.slice(0, -1)}`,
      version: '1.0.0',
      name: 'M3U',
      description: 'Live TV from an M3U playlist',
      types: ['tv'],
      catalogs: [
        {
          type: 'tv',
          id: CATALOG_ID,
          name: 'Channels',
          extra: [
            { name: 'genre', options: lineup.groups, isRequired: false },
            { name: 'skip' },
            ...(guided ? [{ name: 'date' }, { name: 'ids' }] : []),
            { name: 'search' },
          ],
        },
      ],
      resources: [
        { name: 'catalog', types: ['tv'], idPrefixes: [this.prefix] },
        { name: 'meta', types: ['tv'], idPrefixes: [this.prefix] },
        { name: 'stream', types: ['tv'], idPrefixes: [this.prefix] },
      ],
      behaviorHints: {
        configurable: false,
        ...(guided && { epgProvider: true }),
        ...(guided && days && { catchupDays: days }),
      },
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
    const lineup = await lineupOf(this.url);
    const start = Math.max(0, Math.floor(Number(skip)) || 0);
    let indexes: number[];
    if (ids) {
      indexes = ids
        .split(',')
        .slice(0, MAX_IDS)
        .map((id) => this.indexOf(lineup, id))
        .filter((i) => i >= 0);
    } else if (search) {
      indexes = searchLineup(lineup, search, start + PAGE_SIZE).slice(start);
    } else if (genre) {
      const members = lineup.members[lineup.groups.indexOf(genre)];
      indexes = members?.slice(start, start + PAGE_SIZE) ?? [];
    } else {
      indexes = [];
      const end = Math.min(lineup.channels.length, start + PAGE_SIZE);
      for (let i = start; i < end; i++) indexes.push(i);
    }

    const from = date ? Date.parse(`${date}T00:00:00Z`) / 1000 : NaN;
    if (Number.isNaN(from))
      return { metas: indexes.map((i) => this.preview(lineup, i)) };
    const guides = indexes.length ? await this.schedules(lineup, indexes) : [];
    return {
      metasDetailed: indexes.map((i, at) => ({
        ...this.preview(lineup, i),
        videos: this.programmes(lineup, i, guides[at], from, from + DAY),
      })),
    };
  }

  async getMeta(type: string, id: string): Promise<Meta> {
    const lineup = await lineupOf(this.url);
    const index = this.indexOf(lineup, id);
    if (type !== 'tv' || index < 0) throw new Error(`Unknown channel ${id}`);
    const [schedule] = await this.schedules(lineup, [index]);
    return {
      ...this.preview(lineup, index),
      videos: this.programmes(lineup, index, schedule, 0, Infinity),
    };
  }

  async getStreams(type: string, id: string): Promise<Stream[]> {
    const ref = this.parse(id);
    if (type !== 'tv' || !ref) return [];
    const lineup = await lineupOf(this.url);
    const index = lineup.byKey.get(ref.key);
    if (index === undefined) return [];
    const channel = lineup.channels[index];
    const { sources } = channel;
    const proxied = (request?: Record<string, string>) =>
      request && { notWebReady: true, proxyHeaders: { request } };
    if (ref.start !== undefined) {
      const { start, end } = ref;
      const now = Date.now() / 1000;
      if (start > now) return [];
      // Back to the guide's own times, then corrected as the playlist asks.
      const shift = channel.shift ?? 0;
      const catchups = sources.map(({ catchup }) =>
        catchup &&
        start - shift - catchup.correction >= now - catchup.days * DAY
          ? catchup
          : undefined
      );
      if (catchups.some(Boolean)) {
        const dated = catchups.some(
          (catchup) => catchup && writesDates(catchup.template)
        );
        const zone = dated
          ? await this.zoneAt(lineup, index, start - shift)
          : undefined;
        const streams = catchups.flatMap((catchup, i) =>
          // Dates in an unknown zone would ask for another programme.
          catchup && (zone !== undefined || !writesDates(catchup.template))
            ? [
                {
                  url: fillCatchup(
                    catchup.template,
                    start - shift - catchup.correction,
                    end - shift - catchup.correction,
                    zone
                  ),
                  name: 'M3U',
                  description: 'Catch-up',
                  behaviorHints: {
                    notWebReady: true,
                    ...proxied(catchup.headers ?? sources[i].headers),
                  },
                },
              ]
            : []
        );
        if (streams.length) return numbered(streams);
      }
      // Without catch-up, a programme on now plays live.
      if (end <= now) return [];
    }
    return numbered(
      sources.map((source) => {
        const format = formatOf(source.url);
        const headers = proxied(source.headers);
        return {
          url: fillNow(source.url),
          name: 'M3U',
          description: format,
          behaviorHints:
            format === 'HLS' ? headers : { notWebReady: true, ...headers },
        };
      })
    );
  }

  /** `<prefix><key>` for a channel, `:<start>:<end>` after it for a programme. */
  private parse(
    id: string
  ): { key: string; start?: number; end: number } | undefined {
    if (!id.startsWith(this.prefix)) return undefined;
    const [key, start, end] = id.slice(this.prefix.length).split(':');
    if (!key) return undefined;
    if (start === undefined) return { key, end: Infinity };
    const from = Number(start);
    const to = Number(end);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from)
      return undefined;
    return { key, start: from, end: to };
  }

  private indexOf(lineup: Lineup, id: string): number {
    const ref = this.parse(id);
    return (ref && lineup.byKey.get(ref.key)) ?? -1;
  }

  private preview(lineup: Lineup, i: number) {
    const c = lineup.channels[i];
    const days = this.guideUrls(lineup).length ? catchupDays(c) : 0;
    return {
      id: `${this.prefix}${c.key}`,
      type: 'tv',
      name: c.name,
      poster: c.logo,
      posterShape: 'square' as const,
      logo: c.logo,
      channelNumber: numberOf(lineup, i),
      genres: c.groups?.map((g) => lineup.groups[g]),
      behaviorHints: days ? { catchupDays: days } : undefined,
    };
  }

  /**
   * Each channel's programmes from the first guide holding it. Guides still
   * being read are waited for up to the page wait, then left to finish.
   */
  private async schedules(
    lineup: Lineup,
    indexes: number[]
  ): Promise<Schedule[]> {
    const urls = this.guideUrls(lineup);
    if (!urls.length) return indexes.map(() => EMPTY);
    const reads = await this.withinPageWait(
      urls.map((url) => guideOf(url, lineup.wants).catch(() => undefined))
    );
    // Looked up per guide, so each of its rows is read once.
    const found: Schedule[] = indexes.map(() => EMPTY);
    const byGuide = new Map<GuideMeta, { ats: number[]; ids: string[] }>();
    indexes.forEach((i, at) => {
      const c = lineup.channels[i];
      const names = c.tvgName ? [c.tvgName, c.name] : [c.name];
      const match = channelIn(reads, c.tvgId ?? '', names);
      if (!match) return;
      const [meta, id] = match;
      let group = byGuide.get(meta);
      if (!group) byGuide.set(meta, (group = { ats: [], ids: [] }));
      group.ats.push(at);
      group.ids.push(id);
    });
    await Promise.all(
      [...byGuide].map(async ([meta, { ats, ids }]) => {
        const schedules = await schedulesIn(meta, ids);
        ats.forEach((at, n) => (found[at] = schedules[n]));
      })
    );
    return found;
  }

  /** The guide's UTC offset for the programme starting at `start`, if any. */
  private async zoneAt(
    lineup: Lineup,
    index: number,
    start: number
  ): Promise<number | undefined> {
    const [schedule] = await this.schedules(lineup, [index]);
    const at = startsFrom(schedule, start);
    if (schedule.starts[at] === start) return schedule.zones?.[at] ?? 0;
    return undefined;
  }

  private async withinPageWait(
    loads: Promise<GuideMeta | undefined>[]
  ): Promise<(GuideMeta | undefined)[]> {
    const found: (GuideMeta | undefined)[] = loads.map(() => undefined);
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      Promise.all(loads.map((load, at) => load.then((m) => (found[at] = m)))),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, appConfig.builtins.m3u.pageWait);
      }),
    ]);
    clearTimeout(timer);
    return found;
  }

  private programmes(
    lineup: Lineup,
    i: number,
    schedule: Schedule,
    from: number,
    to: number
  ) {
    const c = lineup.channels[i];
    return programmesOf(schedule, `${this.prefix}${c.key}`, from, to, c.shift);
  }
}
