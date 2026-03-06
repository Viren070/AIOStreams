import fs from 'fs/promises';
import { createWriteStream, WriteStream } from 'fs';
import path from 'path';
import { createLogger, getTimeTakenSincePoint } from '../../utils/logger.js';
import { getDataFolder, makeRequest } from '../../utils/index.js';
import { Env } from '../../utils/env.js';
import { BaseDataset } from '../base/dataset.js';

const logger = createLogger('seadex');

export interface SeaDexTorrent {
  infoHash: string;
  releaseGroup?: string;
  tracker?: string;
  dualAudio?: boolean;
  created?: string;
  isBest: boolean;
  files: Array<{ length: number; name: string }>;
}

interface SeaDexData {
  torrentsByAnilistId: Record<string, SeaDexTorrent[]>;
  lastUpdated: number;
}

export class SeaDexDataset extends BaseDataset {
  private static instance: SeaDexDataset;
  private data: SeaDexData = {
    torrentsByAnilistId: {},
    lastUpdated: 0,
  };
  protected logger = logger;

  private constructor() {
    super({
      dataPath: path.join(getDataFolder(), 'seadex', 'trs.json'),
      refreshIntervalSeconds: Env.BUILTIN_SEADEX_DATASET_REFRESH_INTERVAL,
      logger,
    });
  }

  public static getInstance(): SeaDexDataset {
    if (!SeaDexDataset.instance) {
      SeaDexDataset.instance = new SeaDexDataset();
    }
    return SeaDexDataset.instance;
  }

  protected async reloadDataFromFile(): Promise<void> {
    try {
      const fileContent = await fs.readFile(this.DATA_PATH, 'utf-8');
      this.data = JSON.parse(fileContent);
      logger.info(
        `Loaded SeaDex dataset with ${
          Object.keys(this.data.torrentsByAnilistId).length
        } entries`
      );
    } catch (error) {
      logger.error('Failed to reload SeaDex dataset from file:', error);
    }
  }

  protected async performSync(): Promise<void> {
    const startTime = Date.now();
    const tempPath = `${this.DATA_PATH}.tmp`;
    let writeStream: WriteStream | null = null;

    try {
      // Ensure temp directory exists
      await fs.mkdir(path.dirname(tempPath), { recursive: true });

      writeStream = createWriteStream(tempPath, { flags: 'w' });
      writeStream.on('error', (err: Error) => {
        logger.error('WriteStream error:', err);
      });

      writeStream.write('{"torrentsByAnilistId":{');

      let page = 1;
      let totalPages = 1;
      let totalEntries = 0;
      let firstEntry = true;
      do {
        const response = await makeRequest(
          `https://releases.moe/api/collections/entries/records?expand=trs&perPage=500&page=${page}`,
          {
            method: 'GET',
            timeout: 15000,
            headers: {
              'User-Agent': Env.DEFAULT_USER_AGENT,
              Accept: 'application/json',
            },
          }
        );

        if (!response.ok) {
          throw new Error(
            `Failed to fetch page ${page}: ${response.status} ${response.statusText}`
          );
        }

        const text = await response.text();
        let json: any;
        try {
          json = JSON.parse(text);
        } catch (e) {
          throw new Error(`Failed to parse JSON for page ${page}`);
        }

        if (
          typeof json.page !== 'number' ||
          typeof json.totalPages !== 'number'
        ) {
          throw new Error('Invalid SeaDex API response format');
        }

        totalPages = json.totalPages;

        // Process items and stream to file
        if (Array.isArray(json.items)) {
          for (const item of json.items) {
            if (!item?.expand?.trs || !Array.isArray(item.expand.trs)) continue;
            if (typeof item.alID !== 'number') continue;

            const torrents: SeaDexTorrent[] = [];
            for (const tr of item.expand.trs) {
              if (
                typeof tr.infoHash !== 'string' ||
                typeof tr.isBest !== 'boolean' ||
                tr.infoHash === '' ||
                tr.infoHash.includes('<redacted>')
              ) {
                continue;
              }

              torrents.push({
                infoHash: tr.infoHash.toLowerCase(),
                releaseGroup: tr.releaseGroup,
                isBest: tr.isBest,
                files: Array.isArray(tr.files) ? tr.files : [],
                tracker: tr.tracker,
                dualAudio: tr.dualAudio,
                created: tr.created,
              });
            }

            if (torrents.length > 0) {
              const alIDStr = item.alID.toString();

              if (!firstEntry) {
                writeStream.write(',');
              }
              writeStream.write(`"${alIDStr}":${JSON.stringify(torrents)}`);
              firstEntry = false;
              totalEntries++;
            }
          }
        }

        logger.debug(`Synced SeaDex page ${page}/${totalPages}`);
        page++;

        await new Promise((resolve) => setTimeout(resolve, 500));
      } while (page <= totalPages);

      writeStream.write(`},"lastUpdated":${Date.now()}}`);
      writeStream.end();

      await new Promise<void>((resolve, reject) => {
        if (!writeStream) {
          return reject(new Error('WriteStream is null'));
        }
        writeStream.on('finish', () => resolve());
        writeStream.on('error', reject);
      });

      await fs.rename(tempPath, this.DATA_PATH);

      logger.info(
        `SeaDex sync completed in ${getTimeTakenSincePoint(startTime)}. Total entries: ${totalEntries}`
      );
    } catch (error) {
      try {
        if (writeStream) {
          writeStream.destroy();
        }
        await fs.unlink(tempPath);
      } catch {}
      throw error;
    }
  }

  public getTorrents(anilistId: number): SeaDexTorrent[] {
    return this.data.torrentsByAnilistId[anilistId.toString()] || [];
  }
}
