import { appConfig } from '../utils/index.js';
import { getDb } from '../db/db.js';
import { sql } from '../db/sql.js';
import {
  MediaInfoRepository,
  type MediaInfoFileFilter,
  type MediaInfoRow,
} from '../db/repositories/media-info.js';
import {
  MediaInfoProbeRepository,
  type ProbeOutcome,
  type ProbePath,
} from '../db/repositories/media-info-probes.js';
import type { PruneResult } from '../db/prune.js';
import { MEDIA_INFO_PROBE_PATHS } from '../config/schema/media-info.js';
import { lookupActivity } from './activity.js';
import { ffprobeVersion } from './ffprobe.js';
import { nzbUrlKey } from './identity.js';
import { mediaInfoProber } from './probe.js';
import { backfillUptake } from './sources/queue.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const RETENTION_DAYS = 30;
const SPARK_POINTS = 40;
// Dashboards refetch on every finished probe; a busy instance finishes many.
const FRESH_MS = 15_000;

const OUTCOMES: ProbeOutcome[] = [
  'stored',
  'applied',
  'empty',
  'failed',
  'timeout',
  'cancelled',
];

export interface MediaInfoSummary {
  /** Files with stored tracks, each probe once, by where they came from. */
  stored: {
    total: number;
    lastDay: number;
    byOrigin: { origin: string; files: number; lastDay: number }[];
  };
  backfill: {
    sources: string[];
    pending: Record<string, number>;
    dropped: Record<string, number>;
  };
  lookups: ReturnType<typeof lookupActivity>;
  day: {
    attempts: number;
    medianMs: number | null;
    p95Ms: number | null;
    /** Attempts per hour, oldest first, ending with this hour. */
    hourly: number[];
  } & Record<ProbeOutcome, number>;
  week: { attempts: number; byPath: Record<ProbePath, number> };
  /** Durations of the latest stored probes, oldest first. */
  recentMs: number[];
  ffprobe: { path: string; version: string | null; missing: boolean };
  probing: boolean;
  probeOn: ProbePath[];
  /** Shared read-only with other instances. */
  serving: boolean;
  /** The instance looked up for files with nothing stored here. */
  lookupHost: string | null;
}

// One pass over the origin index; it still reads every row, so it is kept
// for longer than the rest of the summary.
const STORED_FRESH_MS = 60_000;
let storedLatest:
  | { at: number; counts: Promise<MediaInfoSummary['stored']> }
  | undefined;

async function countStored(since: number): Promise<MediaInfoSummary['stored']> {
  const rows = await getDb().query<{
    origin: string;
    files: number | string | null;
    last_day: number | string | null;
  }>(
    sql`SELECT origin, SUM(listed) AS files,
               SUM(CASE WHEN created_at >= ${since} THEN listed ELSE 0 END)
                 AS last_day
          FROM media_info GROUP BY origin`
  );
  const byOrigin = rows
    .map((r) => ({
      origin: r.origin,
      files: Number(r.files ?? 0),
      lastDay: Number(r.last_day ?? 0),
    }))
    .filter((o) => o.files > 0);
  return {
    total: byOrigin.reduce((a, o) => a + o.files, 0),
    lastDay: byOrigin.reduce((a, o) => a + o.lastDay, 0),
    byOrigin,
  };
}

function storedCounts(now: number): Promise<MediaInfoSummary['stored']> {
  if (!storedLatest || now - storedLatest.at > STORED_FRESH_MS) {
    const counts = countStored(now - DAY_MS);
    storedLatest = { at: now, counts };
    counts.catch(() => {
      if (storedLatest?.counts === counts) storedLatest = undefined;
    });
  }
  return storedLatest.counts;
}

function readQuantile(
  from: number,
  count: number,
  q: number
): Promise<number | null> {
  if (count === 0) return Promise.resolve(null);
  return MediaInfoProbeRepository.readMsAt(
    from,
    Math.min(count - 1, Math.floor(q * count))
  );
}

const sum = (counts: Map<string, number>) =>
  [...counts.values()].reduce((a, b) => a + b, 0);

async function buildSummary(): Promise<MediaInfoSummary> {
  const now = Date.now();
  const thisHour = Math.floor(now / HOUR_MS);
  const dayFrom = (thisHour - 23) * HOUR_MS;
  const weekFrom = now - 7 * DAY_MS;
  const path = appConfig.mediaInfo.ffprobePath;
  const [stored, dayCounts, weekCounts, perHour, recent, version] =
    await Promise.all([
      storedCounts(now),
      MediaInfoProbeRepository.countBy('outcome', dayFrom),
      MediaInfoProbeRepository.countBy('path', weekFrom),
      MediaInfoProbeRepository.countByHour(dayFrom),
      MediaInfoProbeRepository.recentReadMs(weekFrom, SPARK_POINTS),
      ffprobeVersion(path),
    ]);
  const outcomes = Object.fromEntries(
    OUTCOMES.map((o) => [o, dayCounts.get(o) ?? 0])
  ) as Record<ProbeOutcome, number>;
  const timed = outcomes.stored + outcomes.applied;
  const [medianMs, p95Ms] = await Promise.all([
    readQuantile(dayFrom, timed, 0.5),
    readQuantile(dayFrom, timed, 0.95),
  ]);
  const byPath = Object.fromEntries(
    MEDIA_INFO_PROBE_PATHS.map((p) => [p, weekCounts.get(p) ?? 0])
  ) as Record<ProbePath, number>;
  const hourly = Array.from(
    { length: 24 },
    (_, i) => perHour.get(thisHour - 23 + i) ?? 0
  );
  const { probe, probeOn, backfill, serve, lookupUrl } = appConfig.mediaInfo;
  return {
    stored,
    backfill: { sources: backfill as string[], ...backfillUptake() },
    lookups: lookupActivity(now),
    day: { attempts: sum(dayCounts), ...outcomes, medianMs, p95Ms, hourly },
    week: { attempts: sum(weekCounts), byPath },
    recentMs: recent.reverse(),
    ffprobe: {
      path,
      version,
      missing: version === null || mediaInfoProber.snapshot().ffprobe.missing,
    },
    probing: probe,
    probeOn: probeOn as ProbePath[],
    serving: serve,
    lookupHost: lookupUrl ? new URL(lookupUrl).host : null,
  };
}

let latest: { at: number; summary: Promise<MediaInfoSummary> } | undefined;

export function mediaInfoSummary(): Promise<MediaInfoSummary> {
  const now = Date.now();
  if (!latest || now - latest.at > FRESH_MS) {
    const summary = buildSummary();
    latest = { at: now, summary };
    summary.catch(() => {
      if (latest?.summary === summary) latest = undefined;
    });
  }
  return latest.summary;
}

export type MediaInfoFile = MediaInfoRow & {
  nzbName: string | null;
  updatedAt: number;
  /** Every key the probe was stored under, the listed one first. */
  keys: string[];
};

/**
 * A library post's probe is also stored under its release fingerprint and NZB
 * URL key, found here through the entry.
 */
export async function mediaInfoFiles(
  opts: { limit: number; offset: number } & MediaInfoFileFilter
): Promise<{ items: MediaInfoFile[]; total: number; capped: boolean }> {
  const page = await MediaInfoRepository.listFiles(opts);
  const candidates = page.items.map(({ entry }) =>
    [
      entry.releaseKey ?? undefined,
      nzbUrlKey(entry.nzbUrl ?? undefined),
    ].filter((k): k is string => !!k)
  );
  const stored = new Set(
    (await MediaInfoRepository.getFilesByKeys(candidates.flat())).map(
      (r) => `${r.releaseKey}\0${r.file}\0${r.origin}`
    )
  );
  return {
    ...page,
    items: page.items.map(({ entry: _entry, ...item }, i) => ({
      ...item,
      keys: [
        item.releaseKey,
        ...candidates[i].filter((k) =>
          stored.has(`${k}\0${item.file}\0${item.origin}`)
        ),
      ],
    })),
  };
}

export function pruneMediaInfoProbes(): Promise<PruneResult> {
  return MediaInfoProbeRepository.pruneOlderThan(
    Date.now() - RETENTION_DAYS * DAY_MS
  );
}
