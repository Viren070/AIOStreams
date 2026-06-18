/**
 * Fast, zero-dependency NZB document scanner.
 *
 * NZB is a tiny, frozen vocabulary (DTD 1.1, unchanged since ~2007):
 * `<nzb><head><meta>...</head><file ...><groups><group>...<segments><segment ...>...`.
 * Rather than build a DOM, this scanner hops between known byte patterns with
 * `Buffer.indexOf`, parses attributes only inside tag slices, and materialises
 * exactly the strings the model needs.
 *
 * It is the ONLY parser, and deliberately STRICT: anything it does not
 * recognise (unknown elements, CDATA, exotic encodings, malformed quoting,
 * unknown entities, segments without a message-id) throws
 * {@link NzbScanError}, so a malformed NZB fails loudly at parse time instead
 * of half-working and surfacing as missing articles mid-stream.
 */

/** Raised for any input this scanner is not certain it handles correctly. */
export class NzbScanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NzbScanError';
  }
}

/** Raw scanned segment. */
export interface ScannedSegment {
  messageId: string;
  /** 0 when the attribute is absent (backfilled by the model builder). */
  number: number;
  bytes: number;
}

export interface ScannedFile {
  subject: string;
  poster?: string;
  date?: number;
  groups: string[];
  segments: ScannedSegment[];
}

/** Parsed NZB document, before model building (filenames/sizes/hash). */
export interface ScannedNzbDocument {
  meta: Record<string, string>;
  files: ScannedFile[];
}

const LT = 0x3c; // <
const GT = 0x3e; // >
const AMP = 0x26; // &
const SLASH = 0x2f; // /
const EQ = 0x3d; // =
const QUOT = 0x22; // "
const APOS = 0x27; // '
const BANG = 0x21; // !
const QUESTION = 0x3f; // ?

function isWs(c: number): boolean {
  return c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;
}

function isNameChar(c: number): boolean {
  return (
    (c >= 0x61 && c <= 0x7a) || // a-z
    (c >= 0x41 && c <= 0x5a) || // A-Z
    (c >= 0x30 && c <= 0x39) || // 0-9
    c === 0x2d || // -
    c === 0x5f || // _
    c === 0x3a || // : (namespace prefixes, e.g. xmlns declarations)
    c === 0x2e // .
  );
}

/** Decode the five XML entities + numeric character references. */
function decodeEntities(value: string): string {
  if (!value.includes('&')) return value;
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body) => {
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
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      if (Number.isFinite(code) && code >= 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code);
        } catch {
          throw new NzbScanError(`invalid character reference: ${whole}`);
        }
      }
    }
    throw new NzbScanError(`unknown entity: ${whole}`);
  });
}

/** Lenient integer attribute for non-critical fields (NaN becomes undefined). */
function parseIntAttr(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}

class Scanner {
  private pos = 0;
  private readonly len: number;

  constructor(private buf: Buffer) {
    this.len = buf.length;
  }

  // ---- low-level helpers ----------------------------------------------------

  private fail(why: string): never {
    throw new NzbScanError(`${why} (at byte ${this.pos})`);
  }

  /** Decode a byte range to string. Always UTF-8, regardless of the document's
   *  declared prolog encoding. */
  private text(start: number, end: number): string {
    return this.buf.toString('utf8', start, end);
  }

  /** Advance to the next '<', ensuring anything skipped is whitespace-only. */
  private nextTag(allowText: false): number;
  private nextTag(allowText: true): number;
  private nextTag(allowText: boolean): number {
    const lt = this.buf.indexOf(LT, this.pos);
    if (lt === -1) {
      if (allowText) return -1;
      // Trailing whitespace after the root close is fine.
      for (let i = this.pos; i < this.len; i++) {
        if (!isWs(this.buf[i])) this.fail('unexpected trailing content');
      }
      return -1;
    }
    if (!allowText) {
      for (let i = this.pos; i < lt; i++) {
        if (!isWs(this.buf[i])) this.fail('unexpected text content');
      }
    }
    this.pos = lt;
    return lt;
  }

  /** Read the element name after '<' (pos at '<'). Leaves pos after the name. */
  private readName(): string {
    let i = this.pos + 1;
    const start = i;
    while (i < this.len && isNameChar(this.buf[i])) i++;
    if (i === start) this.fail('expected element name');
    const name = this.text(start, i).toLowerCase();
    this.pos = i;
    return name;
  }

  /**
   * Parse attributes up to the closing '>' of the current tag. Returns the
   * attribute map (lower-cased names, entity-decoded values) and whether the
   * tag was self-closing. pos ends just after '>'.
   */
  private readAttributes(): {
    attrs: Map<string, string>;
    selfClosed: boolean;
  } {
    const attrs = new Map<string, string>();
    for (;;) {
      while (this.pos < this.len && isWs(this.buf[this.pos])) this.pos++;
      if (this.pos >= this.len) this.fail('unterminated tag');
      const c = this.buf[this.pos];
      if (c === GT) {
        this.pos++;
        return { attrs, selfClosed: false };
      }
      if (c === SLASH) {
        if (this.buf[this.pos + 1] !== GT) this.fail('malformed self-close');
        this.pos += 2;
        return { attrs, selfClosed: true };
      }
      // Attribute name.
      const nameStart = this.pos;
      while (this.pos < this.len && isNameChar(this.buf[this.pos])) this.pos++;
      if (this.pos === nameStart) this.fail('expected attribute name');
      const name = this.text(nameStart, this.pos).toLowerCase();
      while (this.pos < this.len && isWs(this.buf[this.pos])) this.pos++;
      if (this.buf[this.pos] !== EQ) this.fail('expected = after attribute');
      this.pos++;
      while (this.pos < this.len && isWs(this.buf[this.pos])) this.pos++;
      const quote = this.buf[this.pos];
      if (quote !== QUOT && quote !== APOS) this.fail('unquoted attribute');
      this.pos++;
      const valueStart = this.pos;
      const close = this.buf.indexOf(quote, valueStart);
      if (close === -1) this.fail('unterminated attribute value');
      attrs.set(name, decodeEntities(this.text(valueStart, close)));
      this.pos = close + 1;
    }
  }

  /**
   * Read leaf-element text content up to `</name>`; entity-decoded + trimmed.
   * pos starts after the opening tag's '>' and ends after the close tag.
   */
  private readLeafText(name: string): string {
    const start = this.pos;
    const lt = this.buf.indexOf(LT, start);
    if (lt === -1) this.fail(`unterminated <${name}>`);
    const value = decodeEntities(this.text(start, lt)).trim();
    this.pos = lt;
    this.expectClose(name);
    return value;
  }

  /** Consume `</name>` at pos (pos at '<'). */
  private expectClose(name: string): void {
    if (this.buf[this.pos + 1] !== SLASH) this.fail(`expected </${name}>`);
    this.pos += 1; // at '/'
    this.pos += 1; // after '/'
    const start = this.pos;
    while (this.pos < this.len && isNameChar(this.buf[this.pos])) this.pos++;
    const got = this.text(start, this.pos).toLowerCase();
    if (got !== name) this.fail(`expected </${name}>, got </${got}>`);
    while (this.pos < this.len && isWs(this.buf[this.pos])) this.pos++;
    if (this.buf[this.pos] !== GT) this.fail(`malformed </${name}>`);
    this.pos++;
  }

  /** Skip `<?...?>`, `<!--...-->`, `<!DOCTYPE ...>`; throws on CDATA. pos at '<'. */
  private skipProlog(): boolean {
    const c1 = this.buf[this.pos + 1];
    if (c1 === QUESTION) {
      const end = this.buf.indexOf('?>', this.pos + 2);
      if (end === -1) this.fail('unterminated processing instruction');
      this.pos = end + 2;
      return true;
    }
    if (c1 === BANG) {
      if (
        this.buf[this.pos + 2] === 0x2d && // -
        this.buf[this.pos + 3] === 0x2d
      ) {
        const end = this.buf.indexOf('-->', this.pos + 4);
        if (end === -1) this.fail('unterminated comment');
        this.pos = end + 3;
        return true;
      }
      if (this.text(this.pos + 2, this.pos + 9).toUpperCase() === '[CDATA[') {
        this.fail('CDATA not supported');
      }
      // DOCTYPE: may contain an internal subset in [ ... ].
      const bracket = this.buf.indexOf('[', this.pos);
      const gt = this.buf.indexOf(GT, this.pos);
      if (gt === -1) this.fail('unterminated DOCTYPE');
      if (bracket !== -1 && bracket < gt) {
        const endSubset = this.buf.indexOf(']', bracket);
        if (endSubset === -1) this.fail('unterminated DOCTYPE subset');
        const close = this.buf.indexOf(GT, endSubset);
        if (close === -1) this.fail('unterminated DOCTYPE');
        this.pos = close + 1;
      } else {
        this.pos = gt + 1;
      }
      return true;
    }
    return false;
  }

  // ---- grammar ---------------------------------------------------------------

  scan(): ScannedNzbDocument {
    // BOM. UTF-16 documents are not supported (everything is decoded as UTF-8).
    if (this.buf[0] === 0xef && this.buf[1] === 0xbb && this.buf[2] === 0xbf) {
      this.pos = 3;
    } else if (
      (this.buf[0] === 0xff && this.buf[1] === 0xfe) ||
      (this.buf[0] === 0xfe && this.buf[1] === 0xff)
    ) {
      this.fail('UTF-16 document');
    }

    // Prolog / comments / doctype until the root element.
    for (;;) {
      if (this.nextTag(false) === -1) this.fail('missing <nzb> root');
      if (this.skipProlog()) continue;
      break;
    }
    const root = this.readName();
    if (root !== 'nzb') this.fail(`unexpected root <${root}>`);
    const rootTag = this.readAttributes();
    const doc: ScannedNzbDocument = { meta: {}, files: [] };
    if (rootTag.selfClosed) return doc;

    // Children of <nzb>: <head> | <file>, until </nzb>.
    for (;;) {
      if (this.nextTag(false) === -1) this.fail('unterminated <nzb>');
      if (this.skipProlog()) continue; // comments between elements
      if (this.buf[this.pos + 1] === SLASH) {
        this.expectClose('nzb');
        return doc;
      }
      const name = this.readName();
      if (name === 'head') this.readHead(doc);
      else if (name === 'file') this.readFile(doc);
      else this.fail(`unexpected <${name}> in <nzb>`);
    }
  }

  private readHead(doc: ScannedNzbDocument): void {
    const tag = this.readAttributes();
    if (tag.selfClosed) return;
    for (;;) {
      if (this.nextTag(false) === -1) this.fail('unterminated <head>');
      if (this.skipProlog()) continue;
      if (this.buf[this.pos + 1] === SLASH) {
        this.expectClose('head');
        return;
      }
      const name = this.readName();
      if (name !== 'meta') this.fail(`unexpected <${name}> in <head>`);
      const meta = this.readAttributes();
      const type = meta.attrs.get('type');
      const value = meta.selfClosed ? '' : this.readLeafText('meta');
      if (type) doc.meta[type] = value.trim();
    }
  }

  private readFile(doc: ScannedNzbDocument): void {
    const tag = this.readAttributes();
    const file: ScannedFile = {
      subject: tag.attrs.get('subject') ?? '',
      // Empty poster attribute maps to undefined.
      poster: tag.attrs.get('poster') || undefined,
      date: parseIntAttr(tag.attrs.get('date')),
      groups: [],
      segments: [],
    };
    if (!tag.selfClosed) {
      for (;;) {
        if (this.nextTag(false) === -1) this.fail('unterminated <file>');
        if (this.skipProlog()) continue;
        if (this.buf[this.pos + 1] === SLASH) {
          this.expectClose('file');
          break;
        }
        const name = this.readName();
        if (name === 'groups') this.readGroups(file);
        else if (name === 'segments') this.readSegments(file);
        // Some NZBs nest <segment> directly under <file>.
        else if (name === 'segment') this.readSegment(file);
        else this.fail(`unexpected <${name}> in <file>`);
      }
    }
    doc.files.push(file);
  }

  private readGroups(file: ScannedFile): void {
    const tag = this.readAttributes();
    if (tag.selfClosed) return;
    for (;;) {
      if (this.nextTag(false) === -1) this.fail('unterminated <groups>');
      if (this.skipProlog()) continue;
      if (this.buf[this.pos + 1] === SLASH) {
        this.expectClose('groups');
        return;
      }
      const name = this.readName();
      if (name !== 'group') this.fail(`unexpected <${name}> in <groups>`);
      const g = this.readAttributes();
      const value = g.selfClosed ? '' : this.readLeafText('group');
      if (value) file.groups.push(value);
    }
  }

  private readSegments(file: ScannedFile): void {
    const tag = this.readAttributes();
    if (tag.selfClosed) return;
    for (;;) {
      if (this.nextTag(false) === -1) this.fail('unterminated <segments>');
      if (this.skipProlog()) continue;
      if (this.buf[this.pos + 1] === SLASH) {
        this.expectClose('segments');
        return;
      }
      const name = this.readName();
      if (name !== 'segment') this.fail(`unexpected <${name}> in <segments>`);
      this.readSegment(file);
    }
  }

  /**
   * Strict integer attribute on <segment>: absent → 0 (the model builder
   * backfills `number` by document order), present-but-unparseable → throw
   * (a garbage `bytes`/`number` means the NZB is broken, not just sloppy).
   */
  private segmentIntAttr(attrs: Map<string, string>, name: string): number {
    const raw = attrs.get(name);
    if (raw === undefined) return 0;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n)) {
      this.fail(`invalid ${name} attribute "${raw}" on <segment>`);
    }
    return n;
  }

  /** Parse one <segment ...>msgid</segment> (opening tag already consumed). */
  private readSegment(file: ScannedFile): void {
    const tag = this.readAttributes();
    const messageId = (
      tag.selfClosed ? '' : this.readLeafText('segment')
    ).replace(/^<|>$/g, '');
    if (!messageId) this.fail('segment missing message-id');
    file.segments.push({
      messageId,
      number: this.segmentIntAttr(tag.attrs, 'number'),
      bytes: this.segmentIntAttr(tag.attrs, 'bytes'),
    });
  }
}

/**
 * Scan an NZB document into its raw structure. Throws {@link NzbScanError}
 * for anything outside the known NZB grammar.
 */
export function scanNzb(xml: string | Buffer): ScannedNzbDocument {
  const buf = Buffer.isBuffer(xml) ? xml : Buffer.from(xml, 'utf8');
  if (buf.length === 0) throw new NzbScanError('empty document');
  return new Scanner(buf).scan();
}
