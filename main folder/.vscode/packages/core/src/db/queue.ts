import { createLogger } from '../utils';
import { DB } from './db';
const logger = createLogger('db');
const db = DB.getInstance();

// Queue for SQLite transactions

export class TransactionQueue {
  private queue: Array<() => Promise<any>> = [];
  private processing = false;
  private static instance: TransactionQueue;

  private constructor() {}

  static getInstance(): TransactionQueue {
    if (!this.instance) {
      this.instance = new TransactionQueue();
    }
    return this.instance;
  }

  async enqueue<T>(operation: () => Promise<T>): Promise<T> {
    // If using PostgreSQL, execute directly without queuing
    if (db['uri']?.dialect === 'postgres') {
      return operation();
    }

    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await operation();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
      this.processQueue();
    });
  }

  private async processQueue() {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const operation = this.queue.shift();
      if (operation) {
        try {
          await operation();
        } catch (error) {
          logger.error('Error processing queued operation:', error);
        }
      }
    }

    this.processing = false;
  }
}
