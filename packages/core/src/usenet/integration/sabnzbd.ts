import XMLBuilder from 'fast-xml-builder';
import {
  UsenetLibraryRepository,
  UsenetMetricsRepository,
  type UsenetLibraryEntry,
  type UsenetLibraryStatus,
} from '../../db/index.js';
import { DebridError } from '../../debrid/base.js';
import { formatBytes } from '../../formatters/utils.js';
import { createLogger } from '../../logging/logger.js';
import { addUsenetNzb } from './library.js';
import { baseName, stripNzbExt, stripReleaseExt } from './naming.js';
import { getUsenetProviders, getUsenetLiveStats } from './dashboard/index.js';

const logger = createLogger('usenet/sabnzbd');

/**
 * SABnzbd-compatible API over the native usenet library, so *arr-class tools
 * can use AIOStreams as a "download client". One request = one `mode` (plus an
 * optional `name` sub-command); responses are pre-wrapped payloads serialised
 * as JSON or, via {@link renderSabnzbdXml}, as SABnzbd-shaped XML. The HTTP
 * layer (auth, multipart, output negotiation) lives in the server package.
 *
 * Reference: https://sabnzbd.org/wiki/advanced/api (modes without a sensible
 * native equivalent return SABnzbd's `{status:false, error}` envelope).
 */

/** Version reported to clients */
export const SABNZBD_VERSION = '5.0.4';

const NZO_PREFIX = 'SABnzbd_nzo_';
const DAY_MS = 86_400_000;

export interface SabnzbdRequest {
  mode: string;
  /** Flat query+form params (single values win over arrays). */
  params: Record<string, string>;
  /** Uploaded NZB for `mode=addfile`. */
  upload?: { xml: Buffer; filename?: string };
  /** Authenticated AIOSTREAMS_AUTH username (library `owner`). */
  owner: string;
  /** The presented apikey, echoed back by `get_config`/`status`. */
  apikey: string;
  /** Request host/port for `get_config`'s `misc` block. */
  host?: string;
  port?: string;
  /** The API mount path clients use as their SABnzbd `url_base`. */
  urlBase?: string;
}

export interface SabnzbdResult {
  payload: unknown;
  /** Defaults to 200 (SABnzbd reports most errors in-band). */
  httpStatus?: number;
}

// ---------------------------------------------------------------------------
// Shared projection helpers
// ---------------------------------------------------------------------------

function toNzoId(hash: string): string {
  return `${NZO_PREFIX}${hash}`;
}

function fromNzoId(id: string): string {
  return id.startsWith(NZO_PREFIX) ? id.slice(NZO_PREFIX.length) : id;
}

type SabnzbdStatus = 'Queued' | 'Downloading' | 'Completed' | 'Failed';

function sabStatus(status: UsenetLibraryStatus): SabnzbdStatus {
  switch (status) {
    case 'queued':
      return 'Queued';
    case 'inspecting':
    case 'streaming':
      return 'Downloading';
    case 'failed':
      return 'Failed';
    case 'available':
    case 'degraded': // playable with zero-filled holes: complete for *arr purposes
    default:
      return 'Completed';
  }
}

const toMb = (bytes: number): string => (bytes / 1_000_000).toFixed(2);
const toUnix = (iso: string): number =>
  Math.floor(new Date(iso).getTime() / 1000);
const humanSize = (bytes: number): string => formatBytes(bytes, 1000);

function csv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function intParam(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

function entryName(entry: UsenetLibraryEntry): string {
  return stripNzbExt(entry.name ?? entry.nzbHash);
}

/** A `mode=queue` slot (active imports projected as in-flight downloads). */
function queueSlot(entry: UsenetLibraryEntry, index: number) {
  const mb = entry.bytesTotal;
  const mbLeft = Math.max(0, entry.bytesTotal - entry.bytesDone);
  const ageDays = Math.max(
    0,
    Math.floor((Date.now() - new Date(entry.addedAt).getTime()) / DAY_MS)
  );
  return {
    status: sabStatus(entry.status),
    index,
    nzo_id: toNzoId(entry.nzbHash),
    filename: entryName(entry),
    password: entry.password ?? '',
    cat: entry.category ?? '*',
    priority: 'Normal',
    percentage: String(Math.round(entry.progress * 100)),
    mb: toMb(mb),
    mbleft: toMb(mbLeft),
    mbmissing: '0.00',
    size: humanSize(mb),
    sizeleft: humanSize(mbLeft),
    timeleft: '0:00:00',
    avg_age: `${ageDays}d`,
    time_added: toUnix(entry.addedAt),
    labels: [] as string[],
    script: 'None',
    unpackopts: '3',
    direct_unpack: null,
  };
}

/** A `mode=history` slot (available/failed imports). */
function historySlot(entry: UsenetLibraryEntry) {
  const name = entryName(entry);
  const bytes = entry.size ?? entry.bytesTotal;
  return {
    nzo_id: toNzoId(entry.nzbHash),
    name,
    nzb_name: `${name}.nzb`,
    status: sabStatus(entry.status),
    bytes,
    size: humanSize(bytes),
    category: entry.category ?? '*',
    fail_message: entry.status === 'failed' ? (entry.failReason ?? '') : '',
    url: entry.nzbUrl ?? '',
    password: entry.password ?? '',
    completed: toUnix(entry.lastUsedAt),
    time_added: toUnix(entry.addedAt),
    download_time: Math.round((entry.importMs ?? 0) / 1000),
    postproc_time: 0,
    storage: '',
    path: '',
    stage_log: [] as unknown[],
    loaded: false,
    archive: false,
    retry: 0,
    pp: 'D',
    script: 'None',
    script_line: '',
    report: '',
    md5sum: '',
    duplicate_key: '',
    meta: null,
    action_line: '',
    url_info: '',
    has_rating: false,
  };
}

/**
 * Shared queue/history listing: repo-level pagination + search, then the
 * SABnzbd-side filters (`cat`, `nzo_ids`, mapped `status`) applied in-process;
 * the active/history sets are small and the filters compose freely.
 */
async function listEntries(
  group: 'active' | 'history',
  params: Record<string, string>
): Promise<{ entries: UsenetLibraryEntry[]; total: number; start: number }> {
  const start = intParam(params.start, 0);
  const limit = intParam(params.limit, 0);
  const failedOnly = group === 'history' && params.failed_only === '1';
  const { entries, total } = await UsenetLibraryRepository.list({
    group,
    statuses: failedOnly ? ['failed'] : undefined,
    search: params.search || undefined,
    limit: limit > 0 ? limit : 500,
    offset: start,
    sort: group === 'active' ? 'added' : 'activity',
    dir: group === 'active' ? 'asc' : 'desc',
  });
  const cats = csv(params.cat ?? params.category);
  const nzoIds = csv(params.nzo_ids).map(fromNzoId);
  const statuses = csv(params.status);
  const filtered = entries.filter(
    (e) =>
      (cats.length === 0 || cats.includes(e.category ?? '*')) &&
      (nzoIds.length === 0 || nzoIds.includes(e.nzbHash)) &&
      (statuses.length === 0 || statuses.includes(sabStatus(e.status)))
  );
  return { entries: filtered, total, start };
}

/** Bytes downloaded per stats window (history sizes + `server_stats`). */
async function windowRollups() {
  const now = Date.now();
  const windows = {
    day: now - DAY_MS,
    week: now - 7 * DAY_MS,
    month: now - 30 * DAY_MS,
    total: 0,
  } as const;
  const entries = await Promise.all(
    Object.entries(windows).map(async ([key, sinceMs]) => {
      const rollups = await UsenetMetricsRepository.summaryByProvider(sinceMs);
      return [key, rollups] as const;
    })
  );
  return Object.fromEntries(entries) as Record<
    keyof typeof windows,
    Awaited<ReturnType<typeof UsenetMetricsRepository.summaryByProvider>>
  >;
}

const sumBytes = (
  rollups: { bytes: number }[] // per-provider rollups for one window
): number => rollups.reduce((n, r) => n + r.bytes, 0);

// ---------------------------------------------------------------------------
// Mode payloads
// ---------------------------------------------------------------------------

function ok(extra: Record<string, unknown> = {}): SabnzbdResult {
  return { payload: { status: true, ...extra } };
}

function sabError(message: string, httpStatus = 200): SabnzbdResult {
  return { payload: { status: false, error: message }, httpStatus };
}

async function buildQueue(
  params: Record<string, string>
): Promise<SabnzbdResult> {
  const { entries, total, start } = await listEntries('active', params);
  const slots = entries.map((e, i) => queueSlot(e, start + i));
  const mb = entries.reduce((n, e) => n + e.bytesTotal, 0);
  const mbLeft = entries.reduce(
    (n, e) => n + Math.max(0, e.bytesTotal - e.bytesDone),
    0
  );
  const bps = getUsenetLiveStats().live.currentBytesPerSec;
  return {
    payload: {
      queue: {
        status: slots.some((s) => s.status === 'Downloading')
          ? 'Downloading'
          : 'Idle',
        paused: false,
        paused_all: false,
        noofslots_total: total,
        noofslots: slots.length,
        start,
        limit: intParam(params.limit, 0),
        mb: toMb(mb),
        mbleft: toMb(mbLeft),
        size: humanSize(mb),
        sizeleft: humanSize(mbLeft),
        kbpersec: (bps / 1000).toFixed(2),
        speed: humanSize(bps),
        timeleft: '0:00:00',
        slots,
        version: SABNZBD_VERSION,
      },
    },
  };
}

async function buildHistory(
  params: Record<string, string>
): Promise<SabnzbdResult> {
  const { entries, total, start } = await listEntries('history', params);
  const rollups = await windowRollups();
  return {
    payload: {
      history: {
        noofslots: total,
        start,
        limit: intParam(params.limit, 0),
        ppslots: 0,
        day_size: humanSize(sumBytes(rollups.day)),
        week_size: humanSize(sumBytes(rollups.week)),
        month_size: humanSize(sumBytes(rollups.month)),
        total_size: humanSize(sumBytes(rollups.total)),
        last_history_update: Math.floor(Date.now() / 1000),
        slots: entries.map(historySlot),
        version: SABNZBD_VERSION,
      },
    },
  };
}

/** Resolve an add request's outcome to SABnzbd's `{status, nzo_ids}` shape. */
async function addNzb(opts: {
  url?: string;
  xml?: Buffer;
  params: Record<string, string>;
  fallbackName?: string;
  owner: string;
}): Promise<SabnzbdResult> {
  const { params } = opts;
  const category = params.cat && params.cat !== '*' ? params.cat : undefined;
  const entry = await addUsenetNzb({
    url: opts.url,
    xml: opts.xml,
    name: params.nzbname || opts.fallbackName || undefined,
    category,
    password: params.password || undefined,
    owner: opts.owner,
  });
  return ok({ nzo_ids: [toNzoId(entry.nzbHash)] });
}

/**
 * Delete queue/history items. `value` is a CSV of nzo_ids, `all`, or (history)
 * `failed`; `search` narrows `all` the same way SABnzbd's purge does.
 */
async function deleteEntries(
  group: 'active' | 'history',
  params: Record<string, string>,
  value: string
): Promise<SabnzbdResult> {
  let hashes: string[];
  if (value === 'all' || value === 'failed') {
    const { entries } = await UsenetLibraryRepository.list({
      group,
      statuses: value === 'failed' ? ['failed'] : undefined,
      search: params.search || undefined,
      limit: 500,
    });
    hashes = entries.map((e) => e.nzbHash);
  } else {
    const known = await UsenetLibraryRepository.getMany(
      csv(value).map(fromNzoId)
    );
    hashes = [...known.keys()];
  }
  for (const hash of hashes) {
    await UsenetLibraryRepository.delete(hash);
  }
  logger.info({ group, count: hashes.length }, 'sabnzbd delete');
  return ok({ nzo_ids: hashes.map(toNzoId) });
}

/** Re-queue failed entries that still have a source URL (`retry`/`retry_all`). */
async function retryEntries(
  entries: UsenetLibraryEntry[],
  owner: string
): Promise<SabnzbdResult> {
  const retried: string[] = [];
  for (const entry of entries) {
    if (!entry.nzbUrl) continue;
    await addUsenetNzb({
      url: entry.nzbUrl,
      name: entry.name,
      category: entry.category,
      password: entry.password,
      owner,
    });
    retried.push(toNzoId(entry.nzbHash));
  }
  if (retried.length === 0) {
    return sabError('nothing to retry (no source NZB available)');
  }
  return ok({ nzo_ids: retried });
}

async function buildGetFiles(value: string): Promise<SabnzbdResult> {
  const entry = await UsenetLibraryRepository.get(fromNzoId(value));
  if (!entry) return sabError('not found');
  return {
    payload: {
      files: entry.files.map((f, i) => ({
        status: 'finished',
        mbleft: '0.00',
        mb: toMb(f.size),
        age: '0d',
        bytes: f.size.toFixed(2),
        filename:
          f.name ?? (f.path ? baseName(f.path) : undefined) ?? `file-${i}`,
        set: '',
        nzf_id: `SABnzbd_nzf_${entry.nzbHash}_${f.index ?? i}`,
      })),
    },
  };
}

/** Static base categories ∪ everything ever assigned, so *arr category checks pass. */
async function allCategories(): Promise<string[]> {
  const base = [
    '*',
    'movies',
    'tv',
    'audio',
    'software',
    'sonarr',
    'radarr',
    'lidarr',
    'prowlarr',
  ];
  const assigned = await UsenetLibraryRepository.distinctCategories();
  return [...new Set([...base, ...assigned])];
}

function buildGetConfig(req: SabnzbdRequest, cats: string[]): SabnzbdResult {
  const providers = getUsenetProviders();
  return {
    payload: {
      config: {
        misc: {
          host: req.host ?? '',
          port: req.port ?? '',
          url_base: req.urlBase ?? '/sabnzbd',
          username: '',
          password: '',
          api_key: req.apikey,
          nzb_key: req.apikey,
          complete_dir: '',
          pre_check: 0,
          history_retention: '',
          history_retention_option: 'all',
          enable_tv_sorting: 0,
          enable_movie_sorting: 0,
          enable_date_sorting: 0,
        },
        logging: {
          log_level: 1,
        },
        categories: cats.map((name, order) => ({
          name,
          order,
          pp: name === '*' ? '3' : '',
          script: name === '*' ? 'None' : 'Default',
          dir: '',
          newzbin: '',
          priority: name === '*' ? 0 : -100,
        })),
        servers: providers.map((p) => ({
          name: p.name ?? p.host,
          displayname: p.name ?? p.host,
          host: p.host,
          port: p.port,
          connections: p.maxConnections,
          ssl: p.tls ? 1 : 0,
          enable: p.enabled !== false ? 1 : 0,
          optional: p.isBackup ? 1 : 0,
          priority: p.priority,
          username: p.username ?? '',
          password: p.hasPassword ? '**********' : '',
          retention: 0,
          timeout: 60,
        })),
      },
    },
  };
}

function formatUptime(): string {
  const totalMinutes = Math.floor(process.uptime() / 60);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

function buildStatus(): SabnzbdResult {
  const providers = getUsenetProviders();
  const { live, pool } = getUsenetLiveStats();
  const poolById = new Map(pool.providers.map((p) => [p.id, p]));
  return {
    payload: {
      status: {
        version: SABNZBD_VERSION,
        uptime: formatUptime(),
        color_scheme: 'Default',
        nt: process.platform === 'win32',
        darwin: process.platform === 'darwin',
        pid: process.pid,
        loadavg: '',
        speed: humanSize(live.currentBytesPerSec),
        kbpersec: (live.currentBytesPerSec / 1000).toFixed(2),
        have_warnings: '0',
        warnings: [] as unknown[],
        folders: [] as string[],
        servers: providers.map((p) => {
          const poolInfo = poolById.get(p.id);
          return {
            servername: p.name ?? p.host,
            serveractiveconn: poolInfo?.acquired ?? 0,
            servertotalconn: p.maxConnections,
            serverssl: p.tls ? 1 : 0,
            serveractive: p.enabled !== false,
            servererror: poolInfo?.tripped ? 'circuit breaker tripped' : '',
            serverpriority: p.priority,
            serveroptional: p.isBackup ? 1 : 0,
            serverbps: humanSize(0),
            serverconnections: [] as unknown[],
          };
        }),
      },
    },
  };
}

async function buildServerStats(): Promise<SabnzbdResult> {
  const rollups = await windowRollups();
  const providers = getUsenetProviders();
  const nameById = new Map(providers.map((p) => [p.id, p.name ?? p.host]));
  const servers: Record<string, Record<string, unknown>> = {};
  for (const [window, windowRollup] of Object.entries(rollups)) {
    for (const r of windowRollup) {
      const key = nameById.get(r.providerId) ?? r.providerId;
      const server = (servers[key] ??= { daily: {} });
      server[window] = r.bytes;
      if (window === 'total') {
        server.articles_tried = r.articles + r.errors + r.missing;
        server.articles_success = r.articles;
      }
    }
  }
  return {
    payload: {
      day: sumBytes(rollups.day),
      week: sumBytes(rollups.week),
      month: sumBytes(rollups.month),
      total: sumBytes(rollups.total),
      servers,
    },
  };
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/**
 * Execute one SABnzbd API call. Expected failures (bad input, missing entry,
 * DebridError) come back as SABnzbd's in-band `{status:false, error}` payload;
 * only truly unexpected errors surface as HTTP 500.
 */
export async function handleSabnzbdRequest(
  req: SabnzbdRequest
): Promise<SabnzbdResult> {
  const { mode, params } = req;
  const name = params.name ?? '';
  if (!mode) {
    return sabError('mode parameter is required');
  }
  try {
    switch (mode) {
      case 'version':
        return { payload: { version: SABNZBD_VERSION } };
      case 'auth':
        return { payload: { auth: 'apikey' } };

      case 'addurl':
        if (!name) return sabError('expects one parameter');
        return await addNzb({ url: name, params, owner: req.owner });
      case 'addfile':
        if (!req.upload) return sabError('expects an nzb file upload');
        return await addNzb({
          xml: req.upload.xml,
          params,
          fallbackName: req.upload.filename
            ? stripReleaseExt(req.upload.filename)
            : undefined,
          owner: req.owner,
        });

      case 'queue':
        switch (name) {
          case '':
            return await buildQueue(params);
          case 'delete':
            if (!params.value) return sabError('expects a value');
            return await deleteEntries('active', params, params.value);
          case 'purge':
            return await deleteEntries('active', params, 'all');
          case 'pause':
          case 'resume':
            return ok({
              nzo_ids: csv(params.value).map(fromNzoId).map(toNzoId),
            });
          default:
            return sabError('not implemented');
        }

      case 'history':
        switch (name) {
          case '':
            return await buildHistory(params);
          case 'delete':
            if (!params.value) return sabError('expects a value');
            return await deleteEntries('history', params, params.value);
          default:
            return sabError('not implemented');
        }

      case 'retry': {
        if (!params.value) return sabError('expects a value');
        const known = await UsenetLibraryRepository.getMany(
          csv(params.value).map(fromNzoId)
        );
        return await retryEntries([...known.values()], req.owner);
      }
      case 'retry_all': {
        const { entries } = await UsenetLibraryRepository.list({
          statuses: ['failed'],
          limit: 500,
        });
        return await retryEntries(entries, req.owner);
      }

      case 'pause':
      case 'resume':
        return ok();

      case 'get_files':
        if (!params.value) return sabError('expects a value');
        return await buildGetFiles(params.value);
      case 'get_cats':
        return { payload: { categories: await allCategories() } };
      case 'get_scripts':
        return { payload: { scripts: ['None'] } };
      case 'get_config':
        return buildGetConfig(req, await allCategories());
      case 'status':
      case 'fullstatus':
        return buildStatus();
      case 'server_stats':
        return await buildServerStats();
      case 'warnings':
        return name === 'clear' ? ok() : { payload: { warnings: [] } };
      case 'translate':
        return { payload: { value: params.value ?? '' } };

      default:
        return sabError('not implemented');
    }
  } catch (err) {
    if (err instanceof DebridError) {
      logger.warn({ mode, error: err.message }, 'sabnzbd request failed');
      return sabError(err.message);
    }
    logger.error({ mode, err }, 'sabnzbd request errored unexpectedly');
    return sabError('internal server error', 500);
  }
}

// ---------------------------------------------------------------------------
// XML output (mirrors SABnzbd's xml_factory)
// ---------------------------------------------------------------------------

/**
 * SABnzbd's XML output drops list keys and emits repeated singularised
 * elements instead (`slots` → `<slot>...</slot><slot/>`); unknown list keys fall
 * back to `<slot>` for objects and `<item>` for scalars, booleans render as
 * `True`/`False`, and `null` becomes an empty element.
 */
const XML_SINGULAR: Record<string, string> = {
  slots: 'slot',
  categories: 'category',
  servers: 'server',
  scripts: 'script',
  warnings: 'warning',
  files: 'file',
  labels: 'label',
  folders: 'folder',
};

function xmlScalar(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  return String(value);
}

function xmlShape(value: unknown): unknown {
  if (Array.isArray(value) || typeof value !== 'object' || value === null) {
    return xmlScalar(value);
  }
  const shaped: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      const singular =
        XML_SINGULAR[key] ??
        (v.some((item) => typeof item === 'object' && item !== null)
          ? 'slot'
          : 'item');
      if (v.length > 0) shaped[singular] = v.map(xmlShape);
    } else if (typeof v === 'object' && v !== null) {
      shaped[key] = xmlShape(v);
    } else {
      shaped[key] = xmlScalar(v);
    }
  }
  return shaped;
}

const xmlBuilder = new XMLBuilder({ format: true, indentBy: ' ' });

/**
 * Serialise a mode payload the way SABnzbd's XML output would: a single-key
 * payload uses that key as the root element (`{queue:{...}}` → `<queue>`), bare
 * envelopes wrap in `<result>`, and a root-level list keeps its plural root
 * around the singularised children (`{categories:[...]}` →
 * `<categories><category>...</category></categories>`).
 */
export function renderSabnzbdXml(payload: unknown): string {
  let root = 'result';
  let body: unknown = payload;
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const keys = Object.keys(payload);
    if (keys.length === 1) {
      root = keys[0];
      body = (payload as Record<string, unknown>)[root];
    }
  }
  const shaped = Array.isArray(body)
    ? xmlShape({ [root]: body })
    : body && typeof body === 'object'
      ? xmlShape(body)
      : xmlScalar(body);
  const xml = xmlBuilder.build({ [root]: shaped });
  return `<?xml version="1.0" encoding="UTF-8" ?>\n${xml}`;
}
