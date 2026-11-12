import { makeRequest } from '../../utils/index.js';
import { config as appConfig } from '../../config/index.js';

export interface XtreamLogin {
  server: string;
  username: string;
  password: string;
}

export class XtreamLoginError extends Error {}

export interface XtreamAccount {
  user_info?: {
    auth?: number | string;
    status?: string;
    allowed_output_formats?: unknown;
  };
  server_info?: { timezone?: string };
}

export interface XtreamCategory {
  category_id?: unknown;
  category_name?: unknown;
}

export interface XtreamStream {
  num?: unknown;
  name?: unknown;
  stream_id?: unknown;
  stream_icon?: unknown;
  epg_channel_id?: unknown;
  category_id?: unknown;
  category_ids?: unknown;
  tv_archive?: unknown;
  tv_archive_duration?: unknown;
}

export interface XtreamListing {
  title?: unknown;
  description?: unknown;
  start_timestamp?: unknown;
  stop_timestamp?: unknown;
}

/** The server's address as entered, without a trailing slash or API path. */
export function serverBase(server: string): string {
  const trimmed = server.trim();
  const url = new URL(
    /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  );
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new XtreamLoginError(
      'The Xtream server must be an http or https address'
    );
  const path = url.pathname
    .replace(/\/(player_api|get|xmltv)\.php$/i, '')
    .replace(/\/+$/, '');
  return `${url.origin}${path}`;
}

/** A manifest's requests go first, as it has the least time, then a page's, then refreshes. */
type Lane = 0 | 1 | 2;

/**
 * Requests to one provider over the limit wait their turn by lane, so many
 * users of one provider don't flood it.
 */
class HostQueue {
  private active = 0;
  private readonly waiting: (() => void)[][] = [[], [], []];

  constructor(
    private readonly host: string,
    private readonly limit: number
  ) {}

  async run<T>(lane: Lane, task: () => Promise<T>): Promise<T> {
    if (this.active < this.limit) this.active++;
    else await new Promise<void>((resolve) => this.waiting[lane].push(resolve));
    try {
      return await task();
    } finally {
      const next =
        this.waiting[0].shift() ??
        this.waiting[1].shift() ??
        this.waiting[2].shift();
      if (next) next();
      else if (--this.active === 0) queues.delete(this.host);
    }
  }
}

const queues = new Map<string, HostQueue>();

function queueFor(base: string): HostQueue {
  const host = new URL(base).host;
  let queue = queues.get(host);
  if (!queue) {
    queue = new HostQueue(host, appConfig.builtins.xtream.hostConcurrency);
    queues.set(host, queue);
  }
  return queue;
}

const timeFormats = new Map<string, Intl.DateTimeFormat>();

/** `YYYY-MM-DD:HH-MM` in the server's time zone, as its archive takes a start. */
function archiveStart(seconds: number, timeZone: string): string {
  let format = timeFormats.get(timeZone);
  if (!format) {
    try {
      format = new Intl.DateTimeFormat('en-GB', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      });
    } catch {
      return archiveStart(seconds, 'UTC');
    }
    timeFormats.set(timeZone, format);
  }
  const part: Record<string, string> = {};
  for (const { type, value } of format.formatToParts(seconds * 1000))
    part[type] = value;
  return `${part.year}-${part.month}-${part.day}:${part.hour}-${part.minute}`;
}

export class XtreamClient {
  readonly base: string;

  constructor(private readonly login: XtreamLogin) {
    this.base = serverBase(login.server);
  }

  get cacheKey(): string {
    return `${this.base}\n${this.login.username}\n${this.login.password}`;
  }

  private async api<T>(
    params: Record<string, string>,
    lane: Lane = 1
  ): Promise<T> {
    const url = new URL(`${this.base}/player_api.php`);
    url.searchParams.set('username', this.login.username);
    url.searchParams.set('password', this.login.password);
    for (const [key, value] of Object.entries(params))
      url.searchParams.set(key, value);
    return queueFor(this.base).run(lane, async () => {
      const res = await makeRequest(url.toString(), {
        timeout: appConfig.builtins.xtream.timeout,
        headers: {
          'User-Agent':
            appConfig.builtins.xtream.userAgent ??
            appConfig.http.defaultUserAgent,
          Accept: 'application/json',
        },
      });
      if (res.status === 401 || res.status === 403)
        throw new XtreamLoginError('The Xtream server refused the login');
      if (!res.ok) throw new Error(`The Xtream server answered ${res.status}`);
      try {
        return (await res.json()) as T;
      } catch (err) {
        if (!(err instanceof SyntaxError)) throw err;
        throw new Error('The Xtream server did not answer with JSON');
      }
    });
  }

  async account(first = false): Promise<XtreamAccount> {
    const account = await this.api<XtreamAccount>({}, first ? 0 : 1);
    const info = account?.user_info;
    if (!info || Number(info.auth) !== 1)
      throw new XtreamLoginError('The Xtream server refused the login');
    if (info.status && info.status !== 'Active')
      throw new XtreamLoginError(`The Xtream account is ${info.status}`);
    return account;
  }

  categories(first = false): Promise<XtreamCategory[]> {
    return this.api({ action: 'get_live_categories' }, first ? 0 : 1);
  }

  streams(): Promise<XtreamStream[]> {
    return this.api({ action: 'get_live_streams' });
  }

  async listings(streamId: number, urgent: boolean): Promise<XtreamListing[]> {
    const table = await this.api<{ epg_listings?: unknown }>(
      { action: 'get_simple_data_table', stream_id: String(streamId) },
      urgent ? 1 : 2
    );
    return Array.isArray(table?.epg_listings) ? table.epg_listings : [];
  }

  /** What's on now and next; some servers cap how many whatever the limit. */
  async shortListings(streamId: number): Promise<XtreamListing[]> {
    const table = await this.api<{ epg_listings?: unknown }>({
      action: 'get_short_epg',
      stream_id: String(streamId),
      limit: '24',
    });
    return Array.isArray(table?.epg_listings) ? table.epg_listings : [];
  }

  private path(): string {
    return `${encodeURIComponent(this.login.username)}/${encodeURIComponent(this.login.password)}`;
  }

  liveUrl(streamId: number, format: string): string {
    return `${this.base}/live/${this.path()}/${streamId}.${format}`;
  }

  archiveUrl(
    streamId: number,
    start: number,
    minutes: number,
    timeZone: string
  ): string {
    return `${this.base}/timeshift/${this.path()}/${minutes}/${archiveStart(start, timeZone)}/${streamId}.ts`;
  }
}
