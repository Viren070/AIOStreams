/**
 * Reads XMLTV (https://github.com/XMLTV/xmltv/blob/master/xmltv.dtd) as it
 * downloads, holding only the element being read. Lenient as guides in the
 * wild need: an unknown entity or a stray `&` stays as written.
 */

export interface XmltvChannel {
  id: string;
  names: string[];
}

export interface XmltvProgramme {
  channel: string;
  start: number;
  /** NaN without one; the next programme's start ends it. */
  stop: number;
  /** The guide's UTC offset at its start, in minutes. */
  zone: number;
  title: string;
  desc: string;
  icon: string;
  categories: string[];
  season: number;
  episode: number;
}

export interface XmltvHandler {
  channel(channel: XmltvChannel): void;
  /** Whether a channel's programmes are read at all. */
  wants(channel: string): boolean;
  programme(programme: XmltvProgramme): void;
}

const ENTITY = /&(?:#x([0-9a-f]+)|#(\d+)|(amp|lt|gt|quot|apos));/gi;
const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function decode(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(
    ENTITY,
    (whole, hex?: string, dec?: string, name?: string) => {
      if (name) return NAMED[name.toLowerCase()];
      const code = hex ? parseInt(hex, 16) : Number(dec);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
  );
}

/**
 * A copy of a string read from the download. V8 keeps a slice as a view of the
 * chunk it came from, so a stored title would hold its whole chunk.
 */
const own = (text: string) => Buffer.from(text, 'utf8').toString('utf8');

/** Matched only from a name's start, so a long run of name characters stays linear. */
const ATTRIBUTE = /(?<![^\s=/"'])([^\s=/"']+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function attributes(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of text.matchAll(ATTRIBUTE)) out[m[1]] = decode(m[2] ?? m[3]);
  return out;
}

const TIME =
  /^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?\s*(?:([+-])(\d{2}):?(\d{2}))?/;

/** `YYYYMMDDhhmmss +zzzz` in seconds, and its offset in minutes; without one, UTC. */
export function parseTime(text: string | undefined): [number, number] {
  const m = text && TIME.exec(text.trim());
  if (!m) return [NaN, 0];
  const [, y, mo, d, h = '0', mi = '0', s = '0', sign, zh, zm] = m;
  const utc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s) / 1000;
  const zone = sign ? (+zh * 60 + +zm) * (sign === '-' ? -1 : 1) : 0;
  return [utc - zone * 60, zone];
}

/** `xmltv_ns` numbers from 0, as `season.episode.part`, each maybe `n/total`. */
function episodeOf(system: string, text: string): [number, number] {
  let numbers: number[] = [];
  if (system === 'xmltv_ns')
    numbers = text
      .split('.')
      .slice(0, 2)
      .map((p) => parseInt(p, 10) + 1);
  else if (system === 'onscreen')
    numbers = /S(\d+)\s*E(\d+)/i.exec(text)?.slice(1).map(Number) ?? [];
  // 0 for none, or one too large to store.
  const [season = 0, episode = 0] = numbers.map((n) =>
    Number.isInteger(n) && n > 0 && n < 65_536 ? n : 0
  );
  return [season, episode];
}

/** What an element keeps at most. */
const MAX_TEXT = 500;
const MAX_CATEGORIES = 8;
export const MAX_NAMES = 8;
const MAX_URL = 2048;
/** Channel ids past this are skipped, with their programmes. */
const MAX_ID = 256;
/** A tag, comment or CDATA section longer than this fails the guide. */
const MAX_PENDING = 256 * 1024;

/** Elements whose text is read, within a channel or programme. */
const TEXT = new Set([
  'display-name',
  'title',
  'desc',
  'category',
  'episode-num',
]);

export async function readXmltv(
  chunks: AsyncIterable<string>,
  handler: XmltvHandler
): Promise<void> {
  let buf = '';
  let channel: XmltvChannel | undefined;
  let programme: XmltvProgramme | undefined;
  let skipping = false;
  /** The element whose text is being read, its text and attributes. */
  let reading: string | undefined;
  let text = '';
  let attrs: Record<string, string> = {};
  /** Where an unfinished construct's search goes on, and its open quote. */
  let resume = 0;
  let quote = '';
  let ended = false;

  const open = (name: string, raw: string, empty: boolean) => {
    if (name === 'channel') {
      const id = attributes(raw).id ?? '';
      channel = { id: id.length <= MAX_ID ? own(id) : '', names: [] };
    } else if (name === 'programme') {
      const a = attributes(raw);
      skipping =
        !a.channel || a.channel.length > MAX_ID || !handler.wants(a.channel);
      if (!skipping) {
        const [start, zone] = parseTime(a.start);
        programme = {
          channel: own(a.channel),
          start,
          stop: parseTime(a.stop)[0],
          zone,
          title: '',
          desc: '',
          icon: '',
          categories: [],
          season: 0,
          episode: 0,
        };
      }
    } else if (skipping) {
      return;
    } else if (name === 'icon') {
      const src = attributes(raw).src ?? '';
      if (programme && !programme.icon && src.length <= MAX_URL)
        programme.icon = own(src);
    } else if (!empty && TEXT.has(name) && (channel || programme)) {
      reading = name;
      text = '';
      attrs = name === 'episode-num' ? attributes(raw) : {};
    }
    if (empty) close(name);
  };

  const close = (name: string) => {
    if (name === reading) {
      const value = own(decode(text).trim().slice(0, MAX_TEXT));
      reading = undefined;
      if (channel && name === 'display-name') {
        if (value && channel.names.length < MAX_NAMES)
          channel.names.push(value);
      } else if (programme && value) {
        if (name === 'title') programme.title ||= value;
        else if (name === 'desc') programme.desc ||= value;
        else if (
          name === 'category' &&
          programme.categories.length < MAX_CATEGORIES
        )
          programme.categories.push(value);
        else if (
          name === 'episode-num' &&
          !programme.season &&
          !programme.episode
        )
          [programme.season, programme.episode] = episodeOf(
            attrs.system,
            value
          );
      }
    } else if (name === 'tv') {
      ended = true;
    } else if (name === 'channel' && channel) {
      if (channel.id) handler.channel(channel);
      channel = undefined;
    } else if (name === 'programme') {
      if (programme && Number.isFinite(programme.start))
        handler.programme(programme);
      programme = undefined;
      skipping = false;
    }
  };

  /** Text read into an element, capped; entities may make it longer than kept. */
  const append = (part: string) => {
    if (reading && text.length < 4 * MAX_TEXT) text += part;
  };

  for await (const chunk of chunks) {
    buf += chunk;
    let at = 0;
    for (;;) {
      const lt = buf.indexOf('<', at);
      if (lt < 0) {
        append(buf.slice(at));
        at = buf.length;
        break;
      }
      append(buf.slice(at, lt));
      // An unfinished construct is read again with the next chunk, from here.
      at = lt;
      if (lt + 1 === buf.length) break;
      if (/[\s\d=]/.test(buf[lt + 1])) {
        // A stray `<` in text, which no tag starts with.
        append('&lt;');
        at = lt + 1;
        continue;
      }
      const from = Math.max(lt, resume);
      let end: number;
      // A terminator may straddle chunks, so its search backs off by its length.
      let back = 0;
      if (buf.startsWith('<!--', lt)) {
        end = buf.indexOf('-->', Math.max(from, lt + 4));
        if (end >= 0) at = end + 3;
        back = 2;
      } else if (buf.startsWith('<![CDATA[', lt)) {
        end = buf.indexOf(']]>', Math.max(from, lt + 9));
        back = 2;
        // Escaped so the element's text decodes it back unchanged.
        if (end >= 0) {
          append(buf.slice(lt + 9, end).replace(/&/g, '&amp;'));
          at = end + 3;
        }
      } else if (buf[lt + 1] === '!' || buf[lt + 1] === '?') {
        end = buf.indexOf('>', from);
        if (end >= 0) at = end + 1;
      } else {
        [end, quote] = tagEnd(buf, Math.max(from, lt + 1), quote);
        if (end >= 0) {
          const tag = buf.slice(lt + 1, end);
          at = end + 1;
          if (tag[0] === '/') {
            close(tag.slice(1).trim());
          } else {
            const empty = tag.endsWith('/');
            const space = tag.search(/[\s/]/);
            const name = space < 0 ? tag : tag.slice(0, space);
            open(name, space < 0 ? '' : tag.slice(space), empty);
          }
        }
      }
      if (end < 0) {
        if (buf.length - lt > MAX_PENDING)
          throw new Error('The guide has a tag that never ends');
        resume = buf.length - back;
        break;
      }
      resume = 0;
      quote = '';
    }
    buf = buf.slice(at);
    resume = Math.max(0, resume - at);
  }
  // A cut-short guide mustn't replace a whole one on refresh.
  if (!ended) throw new Error('The guide ends early');
}

/**
 * The `>` ending a tag, past any in its quoted attributes, searched from `from`
 * with `quote` still open; -1 and the quote open at the end if not yet read.
 */
function tagEnd(buf: string, from: number, quote: string): [number, string] {
  for (let i = from; i < buf.length; i++) {
    const c = buf[i];
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '>') {
      return [i, ''];
    }
  }
  return [-1, quote];
}
