import { log } from './logger';
import { ResultsPanel } from './results-panel';
import { Context, DownloadRecord } from './types';

const MAX_VISIBLE_RECORDS = 8;

function sanitiseFilename(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '_');
}

function deriveFilename(
  url: string,
  fallbackName: string | null,
  hint: string | null
): string {
  let filename =
    hint ?? url.split('/').pop()?.split('?')[0]?.split('#')[0] ?? '';
  if (!filename || !filename.includes('.')) {
    filename = sanitiseFilename(fallbackName ?? 'download') + '.mp4';
  }
  return filename;
}

export class DownloadManager {
  readonly records: DownloadRecord[] = [];
  private readonly active = new Set<number>();
  private onChange: () => void = () => {};
  readonly clearFinishedHandlerId: string;

  constructor(
    private readonly ctx: Context,
    private readonly panel: ResultsPanel,
    private getSessionId: () => string
  ) {
    this.clearFinishedHandlerId = ctx.eventHandler('aio-clear-finished', () => {
      const remaining = this.records.filter((r) => r.status === 'downloading');
      this.records.length = 0;
      this.records.push(...remaining);
      this.onChange();
    });
  }

  setOnChange(cb: () => void): void {
    this.onChange = cb;
  }

  resetSession(): void {
    this.active.clear();
  }

  hasFinished(): boolean {
    return this.records.some((r) => r.status !== 'downloading');
  }

  start(index: number): void {
    if (this.active.has(index)) return;

    const sessionId = this.getSessionId();
    const result = this.panel.wvState.get().results[index];
    const url = result?.url ?? result?.externalUrl;
    if (!url || !result) return;

    const filename = deriveFilename(url, result.name, result.filename);
    const baseDir = result.folderName
      ? $filepath.join(
          this.ctx.preferences.downloadLocation,
          sanitiseFilename(result.folderName)
        )
      : this.ctx.preferences.downloadLocation;
    const filePath = $filepath.join(baseDir, filename);
    this.active.add(index);

    log.info('starting download', { url, filePath });
    const downloadId = this.ctx.downloader.download(url, filePath);

    const dismissHandlerId = this.ctx.eventHandler(
      `aio-dismiss-${downloadId}`,
      () => {
        const idx = this.records.findIndex((r) => r.downloadId === downloadId);
        if (idx !== -1) this.records.splice(idx, 1);
        this.onChange();
      }
    );
    const cancelHandlerId = this.ctx.eventHandler(
      `aio-cancel-${downloadId}`,
      () => {
        this.ctx.downloader.cancel(downloadId);
      }
    );

    const record: DownloadRecord = {
      index,
      filename,
      filePath,
      status: 'downloading',
      startedAt: Date.now(),
      percentage: 0,
      downloadId,
      dismissHandlerId,
      cancelHandlerId,
    };
    this.records.unshift(record);
    if (this.records.length > MAX_VISIBLE_RECORDS) {
      this.records.splice(MAX_VISIBLE_RECORDS);
    }

    // Initial state to webview so the button updates immediately
    this.panel.channel.send('download-progress', {
      index,
      sessionId,
      status: 'downloading',
      percentage: 0,
      filename,
      filePath,
    });
    this.onChange();

    this.ctx.downloader.watch(downloadId, (progress) => {
      if (!progress) return;
      const { percentage, speed, error } = progress;
      const status = progress.status;
      record.percentage = percentage ?? 0;

      this.panel.channel.send('download-progress', {
        index,
        sessionId,
        status,
        percentage,
        speed,
        filename,
        filePath,
        error,
      });

      if (
        status === 'completed' ||
        status === 'error' ||
        status === 'cancelled'
      ) {
        this.active.delete(index);
        record.status = status as DownloadRecord['status'];
        record.completedAt = Date.now();
        if (error) record.error = error;
        this.onChange();

        if (status === 'completed') {
          log.info('download completed', filePath);
          this.ctx.toast.success(`Downloaded to: ${filePath}`);
        } else if (status === 'error') {
          log.error('download failed', { error, filePath });
          this.ctx.toast.error(`Download failed: ${error ?? 'Unknown error'}`);
        }
      }
    });
  }
}
