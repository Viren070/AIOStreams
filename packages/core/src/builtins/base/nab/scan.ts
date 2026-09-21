/**
 * Fast, zero-dependency Torznab/Newznab response scanner.
 *
 * The nab vocabulary is tiny and frozen (RSS 2.0 plus a `torznab:`/`newznab:`
 * namespace), so rather than build a DOM and walk it again with a validator,
 * this hops between known byte patterns with `Buffer.indexOf` and materialises
 * exactly the fields a caller says it will read. It replaces both the XML parse
 * and the schema pass, i.e. three walks of the body become one.
 *
 * Unlike the NZB scanner this one is deliberately LENIENT: RSS feeds carry
 * arbitrary extra elements and indexers differ wildly, so unknown elements are
 * skipped and unknown entities left alone. It is strict about one thing only: a
 * body that is not a nab document at all throws {@link NabScanError}, because
 * indexers answer some requests with bare text ("unsupported torznab function")
 * and silently returning zero results would turn an API error into "no results".
 */

/** Raised for a body that is not a Newznab/Torznab document. */
export class NabScanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NabScanError';
  }
}

const LT = 0x3c; // <
const GT = 0x3e; // >
const SLASH = 0x2f; // /
const EQ = 0x3d; // =
const QUOT = 0x22; // "
const APOS = 0x27; // '
const BANG = 0x21; // !
const QUESTION = 0x3f; // ?
const DASH = 0x2d; // -
const HASH = 0x23; // #

const ITEM_OPEN = Buffer.from('<item', 'latin1');
const ITEM_CLOSE = Buffer.from('</item', 'latin1');
const CDATA_OPEN = Buffer.from('<![CDATA[', 'latin1');
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

const RESPONSE_TAGS = [
  '<torznab:response',
  '<newznab:response',
  '<response',
] as const;

const DEFAULT_SLICE_MS = 8;
/** Items parsed between clock reads; the check itself is not free. */
const ITEMS_PER_CLOCK_CHECK = 32;
const CAPS_AVAILABLE = 'yes';

/** Element names whose text a profile can ask for. */
export type NabTextField = 'title' | 'guid' | 'pubDate' | 'size' | 'type';
/** Indexer-name elements Prowlarr and Jackett add to each item. */
export type NabIndexerField = 'prowlarrindexer' | 'jackettindexer';
export type NabAttrType = 'string' | 'number';

/**
 * What a caller wants out of each item. Everything absent from the profile is
 * stepped over without ever becoming a string, which is most of the body:
 * `extended=1` feeds carry 8-25 attributes per item and callers read ~8.
 */
export interface NabScanProfile {
  /** Namespaced attribute element, e.g. `torznab:attr`. */
  attrElement: string;
  fields: ReadonlySet<NabTextField>;
  indexers: ReadonlySet<NabIndexerField>;
  /** Whether `<enclosure length>` is kept. */
  enclosureLength: boolean;
  /** Attribute names to keep, and how to type each value. */
  attrs: ReadonlyMap<string, NabAttrType>;
}

export type NabAttrs = Record<string, string | number | undefined>;

export interface NabEnclosure {
  url: string;
  type?: string;
  length?: number;
}

export interface NabScanItem {
  title: string;
  guid?: string;
  pubDate?: string;
  size?: number;
  type?: string;
  enclosure: NabEnclosure[];
  prowlarrindexer?: { name: string };
  jackettindexer?: { name: string };
  /** The kept namespaced attributes, keyed by attribute name. */
  attrs: NabAttrs;
}

export interface NabErrorDocument {
  kind: 'error';
  code: number;
  description: string;
}

export interface NabSearchDocument {
  kind: 'search';
  offset?: number;
  total?: number;
  results: NabScanItem[];
  /** Items dropped for having no title. */
  skipped: number;
  /** Items were left unparsed, through `maxItems` or a body cut short. */
  truncated: boolean;
}

export interface NabSearchFunction {
  available: boolean;
  supportedParams: string[];
}

export interface NabCapsDocument {
  kind: 'caps';
  server: { title?: string };
  limits?: { default?: number; max?: number };
  searching: Record<string, NabSearchFunction>;
}

export interface NabScanOptions {
  /** Stop after this many items. */
  maxItems?: number;
  /** Yield to the event loop once a slice has run this long. */
  sliceMs?: number;
}

/** An element's name and the offsets around its tag. */
interface Elem {
  name: string;
  /** First byte after the element name, where attributes start. */
  nameEnd: number;
  /** Index of the tag's closing `>`. */
  gt: number;
  selfClosing: boolean;
  /** First byte of the element's content. */
  contentStart: number;
  /** End of the attribute region, excluding a self-closing slash. */
  attrsTo: number;
}

function isWs(c: number): boolean {
  return c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;
}

/** Decode the five XML entities plus numeric character references. */
function decodeEntities(value: string): string {
  if (!value.includes('&')) return value;
  return value.replace(
    /&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g,
    (whole: string, body: string) => {
      switch (body) {
        case 'amp':
          return '&';
        case 'lt':
          return '<';
        case 'gt':
          return '>';
        case 'quot':
          return '"';
        case 'apos':
          return "'";
      }
      if (body.charCodeAt(0) === HASH) {
        const hex = body[1] === 'x' || body[1] === 'X';
        const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
        if (Number.isFinite(code) && code >= 0 && code <= 0x10ffff) {
          try {
            return String.fromCodePoint(code);
          } catch {
            return whole;
          }
        }
      }
      // Unknown entity: leave it be. The DOM parser was lenient here too, and
      // an indexer's stray `&` is no reason to fail a whole page of results.
      return whole;
    }
  );
}

/** `''` and non-numeric text become undefined, never 0. */
function toNumber(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isNaN(n) ? undefined : n;
}

/**
 * Process-wide cache of `</name` needles. Allocating one per element per item
 * dominated an earlier draft; the cap stops a feed of arbitrary element names
 * growing the map without bound.
 */
const CLOSERS = new Map<string, Buffer>();
const MAX_CACHED_CLOSERS = 256;
function closer(name: string): Buffer {
  const cached = CLOSERS.get(name);
  if (cached !== undefined) return cached;
  const needle = Buffer.from(`</${name}`, 'latin1');
  if (CLOSERS.size < MAX_CACHED_CLOSERS) CLOSERS.set(name, needle);
  return needle;
}

/** Scans one response body. Cheap to construct; one instance per response. */
export class NabScanner {
  private readonly buf: Buffer;
  private readonly end: number;

  constructor(body: Buffer) {
    this.buf = body;
    this.end = body.length;
  }

  /**
   * Scan a search response, or the `<error>` document an indexer returns in
   * its place. Yields to the event loop between slices, so a feed of any size
   * never holds the loop for more than `sliceMs` at a time.
   */
  async scanSearch(
    profile: NabScanProfile,
    options: NabScanOptions = {}
  ): Promise<NabSearchDocument | NabErrorDocument> {
    const { buf } = this;
    const root = this.readRoot();
    if (root.name === 'error') return this.errorDocument(root);
    if (root.name !== 'rss') {
      throw new NabScanError(`unexpected root element <${root.name}>`);
    }

    const maxItems = options.maxItems ?? Number.POSITIVE_INFINITY;
    const sliceMs = options.sliceMs ?? DEFAULT_SLICE_MS;

    let pos = this.findItemOpen(root.contentStart);
    let { offset, total } = this.readResponseHeader(
      root.contentStart,
      pos === -1 ? this.end : pos
    );

    const results: NabScanItem[] = [];
    let skipped = 0;
    let truncated = false;
    let tail = root.contentStart;
    let sliceStart = performance.now();
    let sinceCheck = 0;

    while (pos !== -1) {
      const gt = this.findTagEnd(pos + ITEM_OPEN.length, this.end);
      if (gt === -1) break;
      const close = buf.indexOf(ITEM_CLOSE, gt + 1);
      // No closing tag means a body cut short mid-item: keep what is complete.
      if (close === -1) {
        truncated = true;
        break;
      }
      const item = this.scanItem(gt + 1, close, profile);
      if (item) results.push(item);
      else skipped++;
      tail = close + ITEM_CLOSE.length;
      pos = this.findItemOpen(tail);

      if (results.length >= maxItems) {
        truncated = truncated || pos !== -1;
        break;
      }
      if (++sinceCheck === ITEMS_PER_CLOCK_CHECK) {
        sinceCheck = 0;
        if (performance.now() - sliceStart >= sliceMs) {
          await this.yield();
          sliceStart = performance.now();
        }
      }
    }

    // Some indexers put the header after the items instead of before them.
    if (offset === undefined && total === undefined && !truncated) {
      ({ offset, total } = this.readResponseHeader(tail, this.end));
    }

    return { kind: 'search', offset, total, results, skipped, truncated };
  }

  /**
   * Scan a capabilities response. Synchronous: caps documents are a few
   * hundred bytes and are cached for days.
   */
  scanCaps(): NabCapsDocument | NabErrorDocument {
    const { buf, end } = this;
    const root = this.readRoot();
    if (root.name === 'error') return this.errorDocument(root);
    if (root.name !== 'caps') {
      throw new NabScanError(`unexpected root element <${root.name}>`);
    }

    const caps: NabCapsDocument = { kind: 'caps', server: {}, searching: {} };
    let pos = root.contentStart;

    while (pos < end) {
      const elem = this.nextElement(pos, end);
      if (!elem) break;
      const { name, contentStart } = elem;

      if (name === 'server') {
        const attrs = this.parseAttrs(elem.nameEnd, elem.attrsTo);
        if (attrs.title) caps.server.title = attrs.title;
      } else if (name === 'limits') {
        const attrs = this.parseAttrs(elem.nameEnd, elem.attrsTo);
        caps.limits = {
          default: toNumber(attrs.default),
          max: toNumber(attrs.max),
        };
      } else if (name === 'searching' && !elem.selfClosing) {
        const close = buf.indexOf(closer(name), contentStart);
        const limit = close === -1 ? end : close;
        let inner = contentStart;
        while (inner < limit) {
          const fn = this.nextElement(inner, limit);
          if (!fn) break;
          const attrs = this.parseAttrs(fn.nameEnd, fn.attrsTo);
          caps.searching[fn.name] = {
            available: attrs.available === CAPS_AVAILABLE,
            supportedParams: (attrs.supportedParams ?? '')
              .split(',')
              .map((param) => param.trim())
              .filter(Boolean),
          };
          inner = fn.selfClosing
            ? fn.contentStart
            : this.skipElement(fn.contentStart, fn.name, limit);
        }
      }
      // Everything else (categories, groups, genres, tags) is stepped over.
      pos = elem.selfClosing
        ? contentStart
        : this.skipElement(contentStart, name, end);
    }

    // Callers fall back to the generic `search` function by name, so it has to
    // exist even when an indexer does not advertise it.
    caps.searching.search ??= { available: false, supportedParams: [] };
    return caps;
  }

  private yield(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
  }

  /**
   * The document's root element. Throws for anything that is not XML, which is
   * how a bare-text error body surfaces as a failure rather than zero results.
   */
  private readRoot(): Elem {
    const { buf, end } = this;
    let pos = end >= 3 && buf.compare(UTF8_BOM, 0, 3, 0, 3) === 0 ? 3 : 0;
    for (;;) {
      while (pos < end && isWs(buf[pos])) pos++;
      if (pos >= end) throw new NabScanError('empty response');
      if (buf[pos] !== LT) throw new NabScanError('response is not XML');
      const c = buf[pos + 1];
      if (c === BANG || c === QUESTION) {
        const next = this.skipMarkup(pos, end);
        if (next <= pos) throw new NabScanError('unterminated XML prolog');
        pos = next;
        continue;
      }
      const elem = this.nextElement(pos, end);
      if (!elem) throw new NabScanError('unterminated root element');
      return elem;
    }
  }

  private errorDocument(root: Elem): NabErrorDocument {
    const attrs = this.parseAttrs(root.nameEnd, root.attrsTo);
    return {
      kind: 'error',
      code: Number.parseInt(attrs.code ?? '', 10),
      description: attrs.description ?? '',
    };
  }

  /**
   * The next element at or after `pos`, stepping over comments, PIs, CDATA
   * sections and closing tags. Returns null at `limit`.
   */
  private nextElement(pos: number, limit: number): Elem | null {
    const { buf } = this;
    let i = pos;
    for (;;) {
      const lt = buf.indexOf(LT, i);
      if (lt === -1 || lt >= limit) return null;
      const c = buf[lt + 1];
      if (c === SLASH || c === BANG || c === QUESTION) {
        const next = this.skipMarkup(lt, limit);
        if (next <= lt) return null;
        i = next;
        continue;
      }
      let nameEnd = lt + 1;
      while (
        nameEnd < limit &&
        !isWs(buf[nameEnd]) &&
        buf[nameEnd] !== GT &&
        buf[nameEnd] !== SLASH
      ) {
        nameEnd++;
      }
      const gt = this.findTagEnd(nameEnd, limit);
      if (gt === -1) return null;
      const selfClosing = buf[gt - 1] === SLASH;
      return {
        name: buf.toString('latin1', lt + 1, nameEnd),
        nameEnd,
        gt,
        selfClosing,
        contentStart: gt + 1,
        attrsTo: selfClosing ? gt - 1 : gt,
      };
    }
  }

  /**
   * Index of the `>` closing the tag that starts at `from`, ignoring any `>`
   * inside a quoted attribute value (legal, and real feeds do it).
   */
  private findTagEnd(from: number, limit: number): number {
    const { buf } = this;
    let quote = 0;
    for (let i = from; i < limit; i++) {
      const c = buf[i];
      if (quote !== 0) {
        if (c === quote) quote = 0;
      } else if (c === QUOT || c === APOS) {
        quote = c;
      } else if (c === GT) {
        return i;
      }
    }
    return -1;
  }

  /** Parse attributes out of a tag slice `[from, to)`, after the element name. */
  private parseAttrs(from: number, to: number): Record<string, string> {
    const { buf } = this;
    const out: Record<string, string> = {};
    let i = from;
    while (i < to) {
      while (i < to && (isWs(buf[i]) || buf[i] === SLASH)) i++;
      if (i >= to) break;
      const nameStart = i;
      while (i < to && buf[i] !== EQ && !isWs(buf[i])) i++;
      const name = buf.toString('latin1', nameStart, i);
      while (i < to && isWs(buf[i])) i++;
      if (buf[i] !== EQ) {
        if (name) out[name] = '';
        continue;
      }
      i++;
      while (i < to && isWs(buf[i])) i++;
      const quote = buf[i];
      if (quote !== QUOT && quote !== APOS) {
        const start = i;
        while (i < to && !isWs(buf[i]) && buf[i] !== SLASH) i++;
        if (name) out[name] = decodeEntities(buf.toString('utf8', start, i));
        continue;
      }
      i++;
      const start = i;
      const valueEnd = buf.indexOf(quote, i);
      if (valueEnd === -1 || valueEnd > to) break;
      // Attribute values are trimmed to match what the DOM parser produced:
      // real feeds carry stray whitespace, e.g. `value=" | 5.1"`.
      if (name) {
        out[name] = decodeEntities(
          buf.toString('utf8', start, valueEnd).trim()
        );
      }
      i = valueEnd + 1;
    }
    return out;
  }

  /**
   * Text content of an element that opened at `from`, given its name. CDATA
   * can only open at the start of the content, so that test is O(1) —
   * searching for it unbounded rescans the rest of the document per field.
   */
  private readText(
    from: number,
    name: string,
    limit: number
  ): { text: string; next: number } {
    const { buf } = this;
    const end = buf.indexOf(closer(name), from);
    if (end === -1 || end > limit) return { text: '', next: from };
    let p = from;
    while (p < end && isWs(buf[p])) p++;
    let text: string;
    if (
      buf[p] === LT &&
      buf[p + 1] === BANG &&
      buf.compare(CDATA_OPEN, 0, 9, p, Math.min(p + 9, this.end)) === 0
    ) {
      const cdEnd = buf.indexOf(']]>', p + 9, 'latin1');
      text =
        cdEnd !== -1 && cdEnd < end ? buf.toString('utf8', p + 9, cdEnd) : '';
    } else {
      text = decodeEntities(buf.toString('utf8', from, end)).trim();
    }
    const gt = buf.indexOf(GT, end);
    return { text, next: gt === -1 ? end : gt + 1 };
  }

  /** Advance past an element we do not want, without decoding its content. */
  private skipElement(
    contentStart: number,
    name: string,
    limit: number
  ): number {
    const { buf } = this;
    const end = buf.indexOf(closer(name), contentStart);
    if (end === -1 || end > limit) return contentStart;
    const gt = buf.indexOf(GT, end);
    return gt === -1 ? end : gt + 1;
  }

  /** Skip a comment, CDATA section, PI, doctype or closing tag at `lt`. */
  private skipMarkup(lt: number, limit: number): number {
    const { buf } = this;
    const c = buf[lt + 1];
    if (c === BANG) {
      if (buf[lt + 2] === DASH && buf[lt + 3] === DASH) {
        const end = buf.indexOf('-->', lt + 4, 'latin1');
        return end === -1 ? limit : end + 3;
      }
      if (buf.compare(CDATA_OPEN, 0, 9, lt, Math.min(lt + 9, this.end)) === 0) {
        const end = buf.indexOf(']]>', lt + 9, 'latin1');
        return end === -1 ? limit : end + 3;
      }
    } else if (c === QUESTION) {
      const end = buf.indexOf('?>', lt + 2, 'latin1');
      return end === -1 ? limit : end + 2;
    }
    const gt = this.findTagEnd(lt + 1, limit);
    return gt === -1 ? limit : gt + 1;
  }

  /** Index of the next `<item>` tag, ignoring lookalikes such as `<items>`. */
  private findItemOpen(from: number): number {
    const { buf } = this;
    let pos = from;
    for (;;) {
      const at = buf.indexOf(ITEM_OPEN, pos);
      if (at === -1) return -1;
      const after = buf[at + ITEM_OPEN.length];
      if (isWs(after) || after === GT || after === SLASH) return at;
      pos = at + ITEM_OPEN.length;
    }
  }

  /**
   * The `offset`/`total` header, searched only within the given region so the
   * whole document is not rescanned once per candidate tag name.
   */
  private readResponseHeader(
    from: number,
    to: number
  ): { offset?: number; total?: number } {
    const { buf } = this;
    for (const tag of RESPONSE_TAGS) {
      const at = buf.indexOf(tag, from, 'latin1');
      if (at === -1 || at >= to) continue;
      const after = buf[at + tag.length];
      if (!isWs(after) && after !== GT && after !== SLASH) continue;
      const gt = this.findTagEnd(at + tag.length, to);
      if (gt === -1) continue;
      const attrs = this.parseAttrs(
        at + tag.length,
        buf[gt - 1] === SLASH ? gt - 1 : gt
      );
      return { offset: toNumber(attrs.offset), total: toNumber(attrs.total) };
    }
    return {};
  }

  /** Scan one `<item>` body. Returns null for an item with no title. */
  private scanItem(
    from: number,
    to: number,
    profile: NabScanProfile
  ): NabScanItem | null {
    const enclosure: NabEnclosure[] = [];
    let attrs: NabAttrs | undefined;
    let title: string | undefined;
    let guid: string | undefined;
    let pubDate: string | undefined;
    let sizeText: string | undefined;
    let type: string | undefined;
    let prowlarrindexer: { name: string } | undefined;
    let jackettindexer: { name: string } | undefined;

    let pos = from;
    while (pos < to) {
      const elem = this.nextElement(pos, to);
      if (!elem) break;
      const { name, contentStart, selfClosing } = elem;

      if (name === 'enclosure') {
        const a = this.parseAttrs(elem.nameEnd, elem.attrsTo);
        if (a.url) {
          const entry: NabEnclosure = { url: a.url };
          if (a.type !== undefined) entry.type = a.type;
          if (profile.enclosureLength) entry.length = toNumber(a.length);
          enclosure.push(entry);
        }
        pos = contentStart;
        continue;
      }

      if (name === profile.attrElement) {
        const a = this.parseAttrs(elem.nameEnd, elem.attrsTo);
        const kind = a.name ? profile.attrs.get(a.name) : undefined;
        if (kind !== undefined && a.value) {
          attrs ??= {};
          if (kind === 'number') {
            attrs[a.name] = toNumber(a.value);
          } else {
            // Repeated attributes (several `language`, say) join, as the
            // collapsed attribute bag did.
            const previous = attrs[a.name];
            attrs[a.name] =
              typeof previous === 'string' && previous
                ? `${previous},${a.value}`
                : a.value;
          }
        }
        pos = contentStart;
        continue;
      }

      if (
        (name === 'prowlarrindexer' || name === 'jackettindexer') &&
        profile.indexers.has(name)
      ) {
        if (selfClosing) {
          pos = contentStart;
          continue;
        }
        const read = this.readText(contentStart, name, to);
        if (read.text) {
          if (name === 'prowlarrindexer') prowlarrindexer = { name: read.text };
          else jackettindexer = { name: read.text };
        }
        pos = read.next;
        continue;
      }

      if (profile.fields.has(name as NabTextField)) {
        if (selfClosing) {
          pos = contentStart;
          continue;
        }
        const read = this.readText(contentStart, name, to);
        if (read.text) {
          switch (name) {
            case 'title':
              title = read.text;
              break;
            case 'guid':
              guid = read.text;
              break;
            case 'pubDate':
              pubDate = read.text;
              break;
            case 'size':
              sizeText = read.text;
              break;
            case 'type':
              type = read.text;
              break;
          }
        }
        pos = read.next;
        continue;
      }

      // Anything else (description, category, comments, link, ...) is stepped
      // over without ever being decoded.
      pos = selfClosing
        ? contentStart
        : this.skipElement(contentStart, name, to);
    }

    if (title === undefined) return null;

    const item: NabScanItem = { title, enclosure, attrs: attrs ?? {} };
    if (guid !== undefined) item.guid = guid;
    if (pubDate !== undefined) item.pubDate = pubDate;
    if (sizeText !== undefined) item.size = toNumber(sizeText);
    if (type !== undefined) item.type = type;
    if (prowlarrindexer !== undefined) item.prowlarrindexer = prowlarrindexer;
    if (jackettindexer !== undefined) item.jackettindexer = jackettindexer;
    return item;
  }
}
