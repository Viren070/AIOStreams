import path from 'path';
import fs from 'fs';
import { URL } from 'url';
import type { DbDriver, Dialect } from './driver/types.js';
import { SqliteDriver } from './driver/sqlite.js';
import { PostgresDriver } from './driver/postgres.js';

type ParsedUri =
  | { dialect: 'sqlite'; filename: string }
  | { dialect: 'postgres'; connectionString: string };

function parseUri(uri: string): ParsedUri {
  const url = new URL(uri);
  switch (url.protocol) {
    case 'sqlite:': {
      if (url.hostname && url.hostname !== '.') {
        throw new Error("Invalid SQLite path, must start with '/' or './'");
      }
      if (!url.pathname) {
        throw new Error('Invalid SQLite path, must be absolute');
      }
      let filename = url.pathname;
      if (url.hostname === '.') {
        filename = path.join(process.cwd(), url.pathname.replace(/^\//, ''));
      }
      return { dialect: 'sqlite', filename };
    }
    case 'postgresql:':
    case 'postgres:':
      return { dialect: 'postgres', connectionString: uri };
    default:
      throw new Error(`Unsupported database scheme: ${url.protocol}`);
  }
}

export function createDriver(uri: string): DbDriver {
  const parsed = parseUri(uri);
  if (parsed.dialect === 'sqlite') {
    const parentDir = path.dirname(parsed.filename);
    if (parentDir && !fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    return new SqliteDriver(parsed.filename);
  }
  return new PostgresDriver(parsed.connectionString);
}

export function dialectFromUri(uri: string): Dialect {
  return parseUri(uri).dialect;
}
