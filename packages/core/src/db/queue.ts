import { DB } from './db.js';

const db = DB.getInstance();

interface QueuedOperation<T> {
  operation: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: any) => void;
}

export class TransactionQueue {
  private queue: Array<QueuedOperation<any>> = [];
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
    if (db.getDialect() === 'postgres') {
      return operation();
    }

    return new Promise<T>((resolve, reject) => {
      this.queue.push({ operation, resolve, reject });
      this.processQueue();
    });
  }

  private async processQueue() {
    if (this.processing || this.queue.length === 0) {
      return;
    }
    this.processing = true;

    const { operation, resolve, reject } = this.queue.shift()!;

    try {
      const result = await operation();
      resolve(result);
    } catch (error) {
      reject(error);
    } finally {
      this.processing = false;
      // After finishing one operation, check if there are more in the queue
      this.processQueue();
    }
  }
}
