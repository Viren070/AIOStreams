import { URL } from 'url';
import { createLogger } from '../utils/logger.js';
import path from 'path';

type BaseConnectionURI = {
  url: URL;
  driverName: string;
};

type PostgresConnectionURI = BaseConnectionURI & {
  dialect: 'postgres';
};

type SQLiteConnectionURI = BaseConnectionURI & {
  filename: string;
  dialect: 'sqlite';
};

export type ConnectionURI = PostgresConnectionURI | SQLiteConnectionURI;

type DBDialect = 'postgres' | 'sqlite';

type DSNModifier = (url: URL, query: URLSearchParams) => void;
const logger = createLogger('database');

function parseConnectionURI(uri: string): ConnectionURI {
  const url = new URL(uri);
  let driverName: string;
  let dialect: DBDialect;

  switch (url.protocol) {
    case 'sqlite:': {
      driverName = 'sqlite3';
      dialect = 'sqlite';
      let filename = url.pathname;
      if (url.hostname && url.hostname !== '.') {
        throw new Error("Invalid path, must start with '/' or './'");
      }
      if (!url.pathname) {
        throw new Error('Invalid path, must be absolute');
      }
      if (url.hostname === '.') {
        // resolve relative path using process.cwd()
        filename = path.join(process.cwd(), url.pathname.replace(/^\//, ''));
      }
      return {
        url,
        driverName,
        filename: filename,
        dialect,
      };
    }
    case 'postgresql:':
    case 'postgres:': {
      driverName = 'pg';
      dialect = 'postgres';
      return {
        url,
        driverName,
        dialect,
      };
    }
    default:
      throw new Error('Unsupported scheme: ' + url.protocol);
  }
}

function adaptQuery(query: string, dialect: DBDialect): string {
  if (dialect === 'sqlite') {
    return query;
  }

  let position = 1;
  return query.replace(/\?/g, () => `$${position++}`);
}

export { parseConnectionURI, adaptQuery };
