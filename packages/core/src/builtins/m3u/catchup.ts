/**
 * Catch-up as Kodi's IPTV Simple Client defines it, which most players and
 * playlists follow: a mode and source per channel, or for the whole playlist.
 * https://github.com/kodi-pvr/pvr.iptvsimple#supported-m3u-and-xmltv-elements
 */

/** Addresses a channel or its catch-up may play from. */
export const STREAM = /^(https?|rtmps?|rtsp):\/\//i;

/** Kodi's, matched without the query: their `(\?.+=.+)?` made them backtrack. */
const FLUSSONIC = /^(https?:\/\/[^/]+)\/(.*)\/([^/]*)(mpegts|\.m3u8)$/;
const FLUSSONIC_ANY = /^(https?:\/\/[^/]+)\/(.*)\/[^/]*$/;
/** Kodi's, also taking a `.ts` stream. */
const XTREAM =
  /^(https?:\/\/[^/]+)\/(?:live\/)?([^/]+)\/([^/]+)\/([^/.]+)(\.m3u8?|\.ts)?$/;

/**
 * A query appended to an address, `?` or `&` as the address needs, though the
 * playlist's own may end in one already or start with the wrong one.
 */
function append(url: string, source: string): string {
  if (!/^[?&]/.test(source)) return url + source;
  const base = url.replace(/[?&]$/, '');
  return `${base}${base.includes('?') ? '&' : '?'}${source.slice(1)}`;
}

/**
 * The address template a channel's programmes play from, as the mode builds it
 * from the stream address; undefined where the mode can't. `vod` and
 * `{catchup-id}`, which need ids from the guide, aren't supported.
 */
export function catchupTemplate(
  mode: string,
  source: string,
  url: string
): string | undefined {
  if (source.includes('{catchup-id}')) return undefined;
  switch (mode.toLowerCase()) {
    case 'default':
      // A source that isn't a whole address is appended, as players do.
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(source))
        return STREAM.test(source) ? source : undefined;
      return source ? append(url, source) : undefined;
    case 'append':
      return source ? append(url, source) : undefined;
    case 'shift':
    case 'timeshift':
      return append(url, '?utc={utc}&lutc={lutc}');
    case 'flussonic':
    case 'flussonic-hls':
    case 'flussonic-ts':
    case 'fs': {
      const ts = /-ts$|^fs$/i.test(mode);
      const q = url.indexOf('?');
      const path = q < 0 ? url : url.slice(0, q);
      const query = q < 0 ? '' : url.slice(q);
      // As Kodi, which takes a query only with a `=`.
      if (query && !/^\?.+=./s.test(query)) return undefined;
      const m = FLUSSONIC.exec(path);
      if (m) {
        const [, host, channel, list, type] = m;
        if (type === 'mpegts')
          return `${host}/${channel}/timeshift_abs-\${start}.ts${query}`;
        return list === 'index'
          ? `${host}/${channel}/timeshift_rel-{offset:1}.m3u8${query}`
          : `${host}/${channel}/${list}-timeshift_rel-{offset:1}.m3u8${query}`;
      }
      const any = FLUSSONIC_ANY.exec(path);
      if (!any) return undefined;
      const [, host, channel] = any;
      return ts
        ? `${host}/${channel}/timeshift_abs-\${start}.ts${query}`
        : `${host}/${channel}/timeshift_rel-{offset:1}.m3u8${query}`;
    }
    case 'xc': {
      const m = XTREAM.exec(url);
      if (!m) return undefined;
      const [, host, user, pass, id, ext] = m;
      return `${host}/timeshift/${user}/${pass}/{duration:60}/{Y}-{m}-{d}:{H}-{M}/${id}${ext ?? '.ts'}`;
    }
    default:
      return undefined;
  }
}

/** A time's fields as UTC shows them, by Kodi's letters and Java's of other players. */
function fields(seconds: number): Record<string, string> {
  const [Y, m, d, H, M, S] = new Date(seconds * 1000)
    .toISOString()
    .split(/[-T:.]/);
  return { Y, m, d, H, M, S, yyyy: Y, MM: m, dd: d, HH: H, mm: M, ss: S };
}

const KODI_LETTERS = /[YmdHMS]/g;
const JAVA_LETTERS = /yyyy|MM|dd|HH|mm|ss/g;

/** Whether a template writes a date, which needs the time zone. */
export const writesDates = (template: string) =>
  /\$\{\([be]\)|\{[YmdHMS]\}|\{(?:utc|start|utcend|end|lutc|now|timestamp):/.test(
    template
  );

/** Arguments stop at a `{`, so one never closed stays linear. */
const TOKEN =
  /\$\{\(([be])\)([^{}]*)\}|\$?\{(utc|start|utcend|end|lutc|now|timestamp|duration|offset|[YmdHMS])(?::([^{}]*))?\}/g;

/**
 * The template with a programme's times in: Kodi's `{utc}`, `${start}`,
 * `{duration:60}`, `{Y}`… and the `${(b)yyyyMMddHHmmss}` / `${(e)…}` of
 * APTV and TiviMate playlists. Players write dates in the viewer's time zone,
 * which a server lacks; the guide's own `zone` (minutes) mostly matches the
 * channel's viewers, and `catchup-correction` moves it.
 */
export function fillCatchup(
  template: string,
  start: number,
  end: number,
  zone = 0,
  now = Math.floor(Date.now() / 1000)
): string {
  const local = (seconds: number) => fields(seconds + zone * 60);
  const at: Record<string, number> = {
    utc: start,
    start,
    utcend: end,
    end,
    lutc: now,
    now,
    timestamp: now,
  };
  return template.replace(
    TOKEN,
    (
      _: string,
      edge: string | undefined,
      javaFormat: string,
      name: string,
      arg: string | undefined
    ) => {
      if (edge) {
        const f = local(edge === 'b' ? start : end);
        return javaFormat.replace(JAVA_LETTERS, (k) => f[k]);
      }
      if (name === 'duration' || name === 'offset') {
        const value = name === 'duration' ? end - start : now - start;
        const by = Number(arg) || 1;
        return String(Math.max(0, Math.floor(value / by)));
      }
      if (name in at) {
        if (!arg) return String(at[name]);
        const f = local(at[name]);
        return arg.replace(KODI_LETTERS, (k) => f[k]);
      }
      return local(start)[name];
    }
  );
}

/** A live address with the current time in, as Kodi fills it there. */
export const fillNow = (url: string, now = Math.floor(Date.now() / 1000)) =>
  url.replace(/\{lutc\}|\$\{(?:now|timestamp)\}/g, String(now));
