import { Pool, Client, QueryResult } from 'pg';
import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import { URL } from 'url';
import path from 'path';
import fs from 'fs';
import { TABLES } from './schemas.js';
import { createLogger } from '../utils/index.js';
import { parseConnectionURI, adaptQuery, ConnectionURI } from './utils.js';

const logger = createLogger('database');

type QueryResultRow = Record<string, any>;

interface UnifiedQueryResult<T = QueryResultRow> {
  rows: T[];
  rowCount: number;
  command?: string;
}

type DBDialect = 'postgres' | 'sqlite';

type DSNModifier = (url: URL, query: URLSearchParams) => void;

type Transaction = {
  commit: () => Promise<void>;
  rollback: () => Promise<void>;
  execute: (query: string, params?: any[]) => Promise<UnifiedQueryResult<any>>;
};

export class DB {
  private static instance: DB;
  private db!: Pool | Database<any>;
  private static initialised: boolean = false;
  private static dialect: DBDialect;
  private uri!: ConnectionURI;
  private dsnModifiers: DSNModifier[] = [];

  private constructor() {}

  static getInstance(): DB {
    if (!this.instance) {
      this.instance = new DB();
    }
    return this.instance;
  }
  isInitialised(): boolean {
    return DB.initialised;
  }

  getDialect(): DBDialect {
    return DB.dialect;
  }

  isSQLite(): boolean {
    return this.getDialect() === 'sqlite';
  }

  getRowsAffected(result: any): number {
    if (this.isSQLite()) {
      return result.changes || 0;
    }
    return result.rowCount || 0;
  }

  async initialise(
    uri: string,
    dsnModifiers: DSNModifier[] = []
  ): Promise<void> {
    if (DB.initialised) {
      return;
    }
    try {
      this.uri = parseConnectionURI(uri);
      this.dsnModifiers = dsnModifiers;
      await this.open();
      await this.ping();

      // create tables
      for (const [name, schema] of Object.entries(TABLES)) {
        const createTableQuery = `CREATE TABLE IF NOT EXISTS ${name} (${schema})`;
        await this.execute(createTableQuery);
      }

      if (this.uri.dialect === 'sqlite') {
        await this.execute('PRAGMA busy_timeout = 5000');
        await this.execute('PRAGMA foreign_keys = ON');
        await this.execute('PRAGMA synchronous = OFF');
        await this.execute('PRAGMA journal_mode = WAL');
      }

      DB.initialised = true;
      DB.dialect = this.uri.dialect;
      logger.info('Database initialised');
    } catch (error) {
      logger.error('Failed to initialize database:', error);
      throw error;
    }
  }

  async open(): Promise<void> {
    if (this.uri.dialect === 'postgres') {
      const pool = new Pool({
        connectionString: this.uri.url.toString(),
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
      });
      this.db = pool;
      this.uri.dialect = 'postgres';
    } else if (this.uri.dialect === 'sqlite') {
      // make parent directory if it does not exist
      const parentDir = path.dirname(this.uri.filename);
      if (!parentDir) {
        throw new Error('Invalid SQLite path');
      }
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      logger.debug(`Opening SQLite database: ${this.uri.filename}`);

      this.db = await open({
        filename: this.uri.filename,
        driver: sqlite3.Database,
      });
      this.uri.dialect = 'sqlite';
    }
  }

  async close(): Promise<void> {
    if (this.uri.dialect === 'postgres') {
      await (this.db as Pool).end();
    } else if (this.uri.dialect === 'sqlite') {
      await (this.db as Database<any>).close();
    }
  }

  async ping(): Promise<void> {
    if (this.uri.dialect === 'postgres') {
      await (this.db as Pool).query('SELECT 1');
    } else if (this.uri.dialect === 'sqlite') {
      await (this.db as Database<any>).get('SELECT 1');
    }
  }

  async execute(query: string, params?: any[]): Promise<any> {
    if (this.uri.dialect === 'postgres') {
      return (this.db as Pool).query(
        adaptQuery(query, this.uri.dialect),
        params
      );
    } else if (this.uri.dialect === 'sqlite') {
      return (this.db as Database<any>).run(
        adaptQuery(query, this.uri.dialect),
        params
      );
    }
    throw new Error('Unsupported dialect');
  }

  async query(query: string, params?: any[]): Promise<any[]> {
    const adaptedQuery = adaptQuery(query, this.uri.dialect);
    if (this.uri.dialect === 'postgres') {
      const result = await (this.db as Pool).query(adaptedQuery, params);
      return result.rows;
    } else if (this.uri.dialect === 'sqlite') {
      return (this.db as Database<any>).all(adaptedQuery, params);
    }
    return [];
  }

  async begin(): Promise<Transaction> {
    if (this.uri.dialect === 'postgres') {
      const client = await (this.db as Pool).connect();
      await client.query('BEGIN');

      let finalised = false;

      const finalise = () => {
        if (!finalised) {
          finalised = true;
          client.release();
        }
      };

      return {
        commit: async () => {
          try {
            await client.query('COMMIT');
          } finally {
            finalise();
          }
        },
        rollback: async () => {
          try {
            await client.query('ROLLBACK');
          } finally {
            finalise();
          }
        },
        execute: async (
          query: string,
          params?: any[]
        ): Promise<UnifiedQueryResult> => {
          const result = await client.query(
            adaptQuery(query, 'postgres'),
            params
          );
          return {
            rows: result.rows,
            rowCount: result.rowCount || 0,
            command: result.command,
          };
        },
      };
    } else if (this.uri.dialect === 'sqlite') {
      // For sqlite, we manually manage the transaction state.
      await (this.db as Database<any>).exec('BEGIN');
      let isFinalised = false;

      return {
        commit: async () => {
          if (isFinalised) return;
          await (this.db as Database<any>).exec('COMMIT');
          isFinalised = true;
        },
        rollback: async () => {
          if (isFinalised) return;
          await (this.db as Database<any>).exec('ROLLBACK');
          isFinalised = true;
        },
        execute: async (
          query: string,
          params?: any[]
        ): Promise<UnifiedQueryResult> => {
          if (isFinalised) {
            throw new Error('Transaction has already been finalised.');
          }
          const adaptedQuery = adaptQuery(query, 'sqlite');
          const command = adaptedQuery.trim().split(' ')[0].toUpperCase();

          if (['INSERT', 'UPDATE', 'DELETE'].includes(command)) {
            const result = await (this.db as Database<any>).run(
              adaptedQuery,
              params
            );
            return {
              rows: [],
              rowCount: result.changes || 0,
              command: command,
            };
          } else {
            const rows = await (this.db as Database<any>).all(
              adaptedQuery,
              params
            );
            return {
              rows: rows,
              rowCount: rows.length,
              command: command,
            };
          }
        },
      };
    }
    throw new Error('Unsupported transaction dialect');
  }
}
