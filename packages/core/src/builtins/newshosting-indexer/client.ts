import tls from 'node:tls';
import { randomUUID } from 'node:crypto';
import { decodeNewshostingFrame, encodeNewshostingFrame } from './protocol.js';

export const NEWSHOSTING_FINDER_CERT_FINGERPRINT =
  '81:EA:23:69:98:33:60:AD:02:D1:FC:79:B0:C1:22:3D:16:77:BC:EF:DD:A9:61:33:3B:3D:5F:2B:BA:20:60:93';
const NEWSHOSTING_FINDER_HOST = 'srv.aboutusenet.com';
const NEWSHOSTING_FINDER_IP = '81.171.93.8';
const NEWSHOSTING_FINDER_PORT = 5598;

export function isOfficialNewshostingFinderEndpoint(options: {
  host: string;
  ip: string;
  port: number;
}): boolean {
  return (
    options.host.toLowerCase() === NEWSHOSTING_FINDER_HOST &&
    options.ip === NEWSHOSTING_FINDER_IP &&
    options.port === NEWSHOSTING_FINDER_PORT
  );
}

export function validateNewshostingFinderFingerprint(
  fingerprint: string | undefined
): void {
  if (
    !fingerprint ||
    fingerprint.toUpperCase() !== NEWSHOSTING_FINDER_CERT_FINGERPRINT
  ) {
    throw new Error('newshosting_certificate_fingerprint_mismatch');
  }
}

export interface NewshostingClientOptions {
  username: string;
  password: string;
  host?: string;
  ip?: string;
  port?: number;
  timeoutMs?: number;
  maxNzbFiles?: number;
}

export interface NewshostingResult {
  name: string;
  size: number;
  date: string;
  files: number;
  category: string;
  author: string;
  index: string;
  scope: string;
  itemId: string;
}

export interface NewshostingSearchResponse {
  results: NewshostingResult[];
  totalItems: number;
  totalPages: number;
}

interface NzbFile {
  name: string;
  author: string;
  timestamp: string;
  articles: Array<{ number: number; bytes: number; messageId: string }>;
}

function xmlEscape(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function decodeNewshostingXmlText(value: string): string {
  return value.replace(
    /&(?:#x([0-9a-f]+)|#(\d+)|(amp|lt|gt|quot|apos));/gi,
    (
      entity,
      hex: string | undefined,
      decimal: string | undefined,
      named: string | undefined
    ) => {
      if (hex) {
        const codePoint = Number.parseInt(hex, 16);
        return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
      }
      if (decimal) {
        const codePoint = Number.parseInt(decimal, 10);
        return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
      }
      switch (named?.toLowerCase()) {
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
        default:
          return entity;
      }
    }
  );
}

function attrValue(xml: string, name: string): string {
  return decodeNewshostingXmlText(
    xml.match(new RegExp(`\\b${name}="([^"]*)"`, 'i'))?.[1] || ''
  );
}

function tagValue(xml: string, tag: string): string {
  return decodeNewshostingXmlText(
    xml
      .match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1]
      ?.trim() || ''
  );
}

function blocks(xml: string, tag: string): string[] {
  return [
    ...xml.matchAll(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, 'gi')),
  ].map((match) => match[0]);
}

export function parseNewshostingGroups(xml: string): NewshostingSearchResponse {
  const groups = xml.match(/<groups\b[^>]*>[\s\S]*?<\/groups>/i)?.[0] || '';
  const totalItems =
    Number.parseInt(attrValue(groups, 'items') || '0', 10) || 0;
  const totalPages =
    Number.parseInt(attrValue(groups, 'pages') || '0', 10) || 0;
  const results = blocks(groups, 'group').map((group) => {
    const id = group.match(/<id\b[^>]*\/?>/i)?.[0] || '';
    return {
      name: tagValue(group, 'title'),
      size: Number.parseInt(attrValue(group, 'size') || '0', 10) || 0,
      date: attrValue(group, 'timestamp'),
      files: Number.parseInt(attrValue(group, 'files') || '0', 10) || 0,
      category: attrValue(group, 'media-category'),
      author: tagValue(group, 'author'),
      index: attrValue(id, 'index'),
      scope: attrValue(id, 'scope'),
      itemId: attrValue(id, 'item'),
    };
  });
  return { results, totalItems, totalPages };
}

function parseGroupDetail(xml: string): {
  newsgroups: string[];
  files: Array<{ num: string; name: string; timestamp: string }>;
} {
  const group = xml.match(/<group\b[^>]*>[\s\S]*?<\/group>/i)?.[0] || '';
  const newsgroups = blocks(group, 'newsgroup')
    .map((block) => block.replace(/<\/?newsgroup[^>]*>/gi, '').trim())
    .filter(Boolean);
  const filesBlock = group.match(/<files\b[^>]*>[\s\S]*?<\/files>/i)?.[0] || '';
  const files = blocks(filesBlock, 'file').map((file) => {
    const id = file.match(/<id\b[^>]*\/?>/i)?.[0] || '';
    return {
      num: attrValue(id, 'num') || '1',
      name: tagValue(file, 'name'),
      timestamp: attrValue(file, 'timestamp'),
    };
  });
  return { newsgroups, files };
}

function parseFileDetail(
  xml: string,
  fallbackAuthor: string
): { author: string; articles: NzbFile['articles'] } {
  const file = xml.match(/<file\b[^>]*>[\s\S]*?<\/file>/i)?.[0] || '';
  const author = tagValue(file, 'author') || fallbackAuthor;
  const articlesBlock =
    file.match(/<articles\b[^>]*>[\s\S]*?<\/articles>/i)?.[0] || '';
  const articles = blocks(articlesBlock, 'article')
    .map((article) => ({
      number: Number.parseInt(attrValue(article, 'number') || '0', 10) || 0,
      bytes: Number.parseInt(attrValue(article, 'bytes') || '0', 10) || 0,
      messageId: tagValue(article, 'message-id').replace(/^<|>$/g, ''),
    }))
    .filter((article) => article.messageId);
  return { author, articles };
}

export function buildNewshostingNzb(
  files: NzbFile[],
  newsgroups: string[]
): string {
  const fileXml = files
    .map((file, fileIndex) => {
      const date = Number.isFinite(Date.parse(file.timestamp))
        ? Math.floor(Date.parse(file.timestamp) / 1000)
        : 0;
      const subject = `[${fileIndex + 1}/${files.length}] "${file.name}" yEnc (1/${file.articles.length})`;
      const groupsXml = newsgroups
        .map((group) => `<group>${xmlEscape(group)}</group>`)
        .join('');
      const segmentsXml = file.articles
        .map(
          (article) =>
            `<segment bytes="${article.bytes}" number="${article.number}">${xmlEscape(article.messageId)}</segment>`
        )
        .join('');
      return `<file poster="${xmlEscape(file.author)}" date="${date}" subject="${xmlEscape(subject)}"><groups>${groupsXml}</groups><segments>${segmentsXml}</segments></file>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE nzb PUBLIC "-//newzBin//DTD NZB 1.1//EN" "http://www.newzbin.com/DTD/nzb/nzb-1.1.dtd">\n<nzb xmlns="http://www.newzbin.com/DTD/2003/nzb">${fileXml}</nzb>`;
}

export class NewshostingClient {
  private socket?: tls.TLSSocket;
  private socketErrorHandler?: (error: Error) => void;
  private requestId = 0;
  private readonly sessionId = randomUUID().replace(/-/g, '');
  private readonly options: Required<NewshostingClientOptions>;

  constructor(options: NewshostingClientOptions) {
    this.options = {
      host: options.host || 'srv.aboutusenet.com',
      ip: options.ip || '81.171.93.8',
      port: options.port || 5598,
      timeoutMs: options.timeoutMs || 25_000,
      maxNzbFiles: options.maxNzbFiles || 160,
      username: options.username,
      password: options.password,
    };
  }

  async connect(): Promise<void> {
    const pinnedOfficialEndpoint = isOfficialNewshostingFinderEndpoint(
      this.options
    );
    this.socket = tls.connect({
      host: this.options.ip,
      port: this.options.port,
      servername: this.options.host,
      timeout: this.options.timeoutMs,
      // The official proprietary Finder endpoint uses a long-lived self-signed
      // certificate. Trust only its exact SHA-256 fingerprint; custom endpoints
      // continue to use the normal platform CA and hostname validation.
      rejectUnauthorized: !pinnedOfficialEndpoint,
    });
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const onSecure = () => {
        if (pinnedOfficialEndpoint) {
          try {
            validateNewshostingFinderFingerprint(
              this.socket?.getPeerCertificate().fingerprint256
            );
          } catch (error) {
            cleanup(() => reject(error));
            this.socket?.destroy();
            return;
          }
        }
        cleanup(resolve);
      };
      const onError = (error: Error) => {
        if (!settled) cleanup(() => reject(error));
      };
      const onTimeout = () =>
        cleanup(() => reject(new Error('newshosting_connect_timeout')));
      const cleanup = (done: () => void) => {
        settled = true;
        this.socket?.off('secureConnect', onSecure);
        this.socket?.off('timeout', onTimeout);
        done();
      };
      this.socket?.once('secureConnect', onSecure);
      this.socketErrorHandler = onError;
      this.socket?.on('error', onError);
      this.socket?.once('timeout', onTimeout);
    });
    await this.send('<login/>');
    const xml = await decodeNewshostingFrame(
      this.socket,
      this.options.timeoutMs
    );
    if (!/<login\b[^>]*\bvalid="true"/i.test(xml)) {
      throw new Error('newshosting_login_failed');
    }
  }

  close(): void {
    if (this.socket && this.socketErrorHandler) {
      this.socket.off('error', this.socketErrorHandler);
      this.socketErrorHandler = undefined;
    }
    this.socket?.destroy();
  }

  async search(
    query: string,
    page = 1,
    perPage = 100
  ): Promise<NewshostingSearchResponse> {
    const body = `<groups hits="true" page="${page}" per-page="${perPage}"><restrictions/><searchterm>${xmlEscape(query)}</searchterm><quality-index password-protected="false"/></groups>`;
    await this.send(body);
    return parseNewshostingGroups(
      await decodeNewshostingFrame(this.socket!, this.options.timeoutMs)
    );
  }

  async createNzb(
    index: string,
    scope: string,
    itemId: string
  ): Promise<string> {
    await this.send(
      `<group><id index="${xmlEscape(index)}" scope="${xmlEscape(scope)}" item="${xmlEscape(itemId)}"/></group>`
    );
    const groupXml = await decodeNewshostingFrame(
      this.socket!,
      this.options.timeoutMs
    ).catch((error) => {
      throw new Error(
        `newshosting_group_detail_failed:${error instanceof Error ? error.message : String(error)}`
      );
    });
    const group = parseGroupDetail(groupXml);
    if (group.files.length > this.options.maxNzbFiles) {
      throw new Error('newshosting_nzb_too_many_files');
    }
    const fallbackAuthor = tagValue(groupXml, 'author');
    const nzbFiles: NzbFile[] = [];

    for (const file of group.files) {
      await this.send(
        `<file><id index="${xmlEscape(index)}" scope="${xmlEscape(scope)}" item="${xmlEscape(itemId)}" num="${xmlEscape(file.num)}"/></file>`
      );
    }

    for (const file of group.files) {
      const fileXml = await decodeNewshostingFrame(
        this.socket!,
        this.options.timeoutMs
      ).catch((error) => {
        throw new Error(
          `newshosting_file_detail_failed:${file.num}:${error instanceof Error ? error.message : String(error)}`
        );
      });
      const detail = parseFileDetail(fileXml, fallbackAuthor);
      nzbFiles.push({
        name: file.name,
        timestamp: file.timestamp,
        author: detail.author,
        articles: detail.articles,
      });
    }

    return buildNewshostingNzb(nzbFiles, group.newsgroups);
  }

  private async send(bodyXml: string): Promise<void> {
    if (!this.socket) throw new Error('newshosting_not_connected');
    const xml = this.buildRequest(bodyXml);
    await new Promise<void>((resolve, reject) => {
      this.socket!.write(encodeNewshostingFrame(xml), (error) =>
        error ? reject(error) : resolve()
      );
    });
  }

  private buildRequest(bodyXml: string): string {
    const id = ++this.requestId;
    return `<?xml version="1.0" encoding="UTF-8"?>\n<request id="${id}" session-id="${this.sessionId}" install-id="" api-version="19"><header language="en" fixed-dpr="1" dpr="1" timezone="America/New_York" utc="true" platform="win32" arch="x64" version="3.8.9"><key>NH</key><platform version="10.0.26200">Windows 11 Pro x64</platform><network peer-addr="127.0.0.1" peer-port="5598" bearer="lan"/><features svg="true" web-engine="false"/><cpu>Intel(R) Core(TM) i7-8700K CPU @ 3.70GHz</cpu><memory size="51492188160"/><login username="${xmlEscape(this.options.username)}" password="${xmlEscape(this.options.password)}"/></header><body>${bodyXml}</body></request>`;
  }
}
