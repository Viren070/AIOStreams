import React from 'react';
import { toast } from 'sonner';
import type { JellyfinClient } from '../client';
import { currentHost } from '../hosts';
import { playableSources } from '../playback/play';
import { requestItem, requestPlaybackInfo } from '../queries';
import { textSubtitles } from '../subtitles/tracks';
import { useSession } from '../session';
import { onSettingsChange, settings } from '../settings';
import { unavailableLabel } from '../format';
import type { BaseItemDto, BaseItemDtoQueryResult, SourceInfo } from '../types';
import { useLatest } from '../use-latest';
import { hostJob } from './files';
import {
  addDownloads,
  allDownloads,
  deleteDownloads,
  loaded,
  setFolder,
  setProgress,
  updateDownloads,
  useDownloadList,
} from './store';
import type { Download, DownloadsHost, HostEvent } from './types';

export type { Download, DownloadState, DownloadsHost } from './types';
export { useDownloadFolder, useDownloadList, useDownloadSpeeds } from './store';

/** States the host owns once it has the files. */
const HOSTED = new Set(['queued', 'downloading', 'paused', 'failed', 'done']);

export function downloadsHost(): DownloadsHost | null {
  return currentHost().downloads ?? null;
}

function newId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('');
}

function versionOf(source: SourceInfo): Download['version'] {
  return {
    id: source.Id!,
    label: source.aiostreams?.name || source.Name || 'Version',
    size: source.Size ?? source.aiostreams?.size,
  };
}

const seriesCache = new Map<string, Promise<BaseItemDto>>();

function seriesOf(
  client: JellyfinClient,
  userId: string,
  item: BaseItemDto
): Promise<BaseItemDto | undefined> {
  if (item.Type !== 'Episode' || !item.SeriesId)
    return Promise.resolve(undefined);
  const key = `${client.base}|${item.SeriesId}`;
  let pending = seriesCache.get(key);
  if (!pending) {
    pending = requestItem(client, userId, item.SeriesId);
    pending.catch(() => seriesCache.delete(key));
    seriesCache.set(key, pending);
  }
  return pending.catch(() => undefined);
}

/** Subtitles in their own format: styled ones stay ASS, the rest become SRT. */
const DOWNLOAD_PROFILE = {
  DirectPlayProfiles: [{ Type: 'Video' }],
  SubtitleProfiles: [
    { Format: 'ass', Method: 'External' },
    { Format: 'srt', Method: 'External' },
  ],
};

/** A version from the list has the player's WebVTT subtitles; asks for it again as a download. */
async function forDownload(
  client: JellyfinClient,
  download: Download,
  source: SourceInfo
): Promise<SourceInfo> {
  const converted = textSubtitles(source).some((s) =>
    /Stream\.vtt(\?|$)/.test(s.DeliveryUrl ?? '')
  );
  if (!converted || !settings.downloads.subtitles.read()) return source;
  const info = await requestPlaybackInfo(
    client,
    download.userId,
    download.item.Id!,
    {
      profile: DOWNLOAD_PROFILE,
    }
  ).catch(() => null);
  return (
    playableSources(info ?? undefined).find((s) => s.Id === source.Id) ?? source
  );
}

/** Hands a download its files once its version is known. */
async function place(
  client: JellyfinClient,
  download: Download,
  picked: SourceInfo
): Promise<void> {
  const source = await forDownload(client, download, picked);
  const series = await seriesOf(client, download.userId, download.item);
  const job = hostJob(client, download.id, download.item, series, source, {
    subtitles: settings.downloads.subtitles.read(),
  });
  updateDownloads([
    {
      id: download.id,
      patch: {
        state: 'queued',
        version: versionOf(source),
        job,
        error: undefined,
      },
    },
  ]);
  downloadsHost()?.add([job]);
}

/** The rest of a batch follows its leader's binge group, or none if it has none. */
function release(download: Download, group: string | null) {
  if (!download.leader || !download.batch) return;
  updateDownloads(
    allDownloads()
      .filter((d) => d.batch === download.batch && d.id !== download.id)
      .map((d) => ({ id: d.id, patch: { group } }))
  );
}

/**
 * Adds downloads for items not already saved or on the way. `version` is the
 * first item's pick, whose binge group the rest follow; without one, each
 * takes the first version, then the first item's group.
 */
export function useAddDownloads() {
  const { client, user } = useSession();
  return React.useCallback(
    async (items: BaseItemDto[], version?: SourceInfo) => {
      const taken = new Set(
        allDownloads()
          .filter((d) => d.base === client.base && d.userId === user.Id)
          .map((d) => d.item.Id)
      );
      const fresh = items.filter((item) => !taken.has(item.Id));
      if (!fresh.length) {
        toast('Already downloaded or on the way');
        return;
      }
      const batch = fresh.length > 1 ? newId() : undefined;
      const group = version
        ? (version.aiostreams?.bingeGroup ?? null)
        : undefined;
      const added: Download[] = fresh.map((item, i) => ({
        id: newId(),
        base: client.base,
        userId: user.Id!,
        item,
        batch,
        leader: i === 0 || undefined,
        group: i === 0 ? null : group,
        version: i === 0 && version ? versionOf(version) : undefined,
        state: 'finding',
        bytes: 0,
        addedAt: Date.now() + i,
      }));
      addDownloads(added);
      toast.success(
        added.length === 1
          ? 'Download added'
          : `${added.length} downloads added`
      );
      if (version) await place(client, added[0], version);
    },
    [client, user.Id]
  );
}

export function pauseDownload(download: Download): void {
  downloadsHost()?.control(download.id, 'pause');
}

export function resumeDownload(download: Download): void {
  downloadsHost()?.control(download.id, 'resume');
}

/** Searches again where no version was found, else asks the host to try again. */
export function retryDownload(download: Download): void {
  if (download.job) downloadsHost()?.control(download.id, 'retry');
  else
    updateDownloads([
      {
        id: download.id,
        patch: { state: 'finding', error: undefined, version: undefined },
      },
    ]);
}

/** `files` also deletes what it saved. */
export function removeDownloads(downloads: Download[], files: boolean): void {
  for (const d of downloads) if (d.job) downloadsHost()?.remove(d.id, files);
  deleteDownloads(downloads.map((d) => d.id));
}

/** Uses another version for a download that has not finished. */
export function useReplaceVersion() {
  const { client } = useSession();
  return React.useCallback(
    (download: Download, source: SourceInfo) => {
      if (download.job) downloadsHost()?.remove(download.id, true);
      const fresh: Download = {
        ...download,
        id: newId(),
        leader: undefined,
        batch: undefined,
        version: versionOf(source),
        job: undefined,
        bytes: 0,
        total: undefined,
        error: undefined,
        state: 'finding',
        addedAt: download.addedAt,
      };
      deleteDownloads([download.id]);
      addDownloads([fresh]);
      void place(client, fresh, source);
    },
    [client]
  );
}

/** The episodes of a show or season that can be downloaded now. */
export function useEpisodesToDownload() {
  const { client, user } = useSession();
  return React.useCallback(
    async (
      seriesId: string,
      opts: { seasonId?: string; unwatched?: boolean } = {}
    ): Promise<BaseItemDto[]> => {
      const { Items = [] } = await client.get<BaseItemDtoQueryResult>(
        `/Shows/${seriesId}/Episodes`,
        { userId: user.Id, SeasonId: opts.seasonId }
      );
      return Items.filter(
        (e) => !unavailableLabel(e) && (!opts.unwatched || !e.UserData?.Played)
      );
    },
    [client, user.Id]
  );
}

/** The download of an item, if there is one for this server and user. */
export function useDownloadOf(
  itemId: string | undefined
): Download | undefined {
  const { client, user } = useSession();
  const list = useDownloadList();
  return React.useMemo(
    () =>
      itemId
        ? list.find(
            (d) =>
              d.item.Id === itemId &&
              d.base === client.base &&
              d.userId === user.Id
          )
        : undefined,
    [list, itemId, client.base, user.Id]
  );
}

function onHostEvent(event: HostEvent, readded: Set<string>) {
  if (event.type === 'progress') {
    setProgress(event.id, event.bytes, event.total ?? undefined, event.speed);
    return;
  }
  setFolder(event.folder);
  const reported = new Map(event.jobs.map((j) => [j.id, j]));
  const changes: { id: string; patch: Partial<Download> }[] = [];
  const missing: Download[] = [];
  for (const d of allDownloads()) {
    const job = reported.get(d.id);
    if (job) {
      const patch = {
        state: job.state,
        bytes: job.bytes,
        total: job.total ?? undefined,
        error: job.error ?? undefined,
      };
      if (
        patch.state !== d.state ||
        patch.error !== d.error ||
        (patch.state !== 'downloading' && patch.bytes !== d.bytes)
      )
        changes.push({ id: d.id, patch });
    } else if (HOSTED.has(d.state) && d.job && !readded.has(d.id)) {
      missing.push(d);
    }
  }
  updateDownloads(changes);
  // The app lost them, as after its queue file was deleted.
  if (missing.length) {
    missing.forEach((d) => readded.add(d.id));
    downloadsHost()?.add(missing.map((d) => d.job!));
  }
}

/**
 * Keeps the page's downloads and the app's in step, and finds versions for
 * this server's downloads, a few at a time.
 */
export function useDownloadRunner(): void {
  const { client, user } = useSession();
  const list = useDownloadList();
  const host = downloadsHost();
  const active = React.useRef(new Set<string>());
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    if (!host) return;
    const readded = new Set<string>();
    let unsubscribe = () => {};
    let live = true;
    void loaded.then(() => {
      if (!live) return;
      unsubscribe = host.subscribe((e) => onHostEvent(e, readded));
      host.list();
      setReady(true);
    });
    const configure = () =>
      host.configure({ concurrent: settings.downloads.concurrent.read() });
    configure();
    const unsubscribeSettings = onSettingsChange(configure);
    return () => {
      live = false;
      unsubscribe();
      unsubscribeSettings();
    };
  }, [host]);

  const resolve = useLatest(async (download: Download) => {
    try {
      const info = await requestPlaybackInfo(
        client,
        user.Id!,
        download.item.Id!,
        {
          profile: DOWNLOAD_PROFILE,
        }
      );
      const sources = playableSources(info);
      const pick =
        (download.group
          ? sources.find((s) => s.aiostreams?.bingeGroup === download.group)
          : undefined) ?? sources[0];
      if (!pick) {
        updateDownloads([
          { id: download.id, patch: { state: 'needs-version' } },
        ]);
        release(download, null);
        return;
      }
      release(download, pick.aiostreams?.bingeGroup ?? null);
      await place(client, download, pick);
    } catch (e) {
      updateDownloads([
        {
          id: download.id,
          patch: {
            state: 'failed',
            error: `Could not find versions: ${(e as Error).message}`,
          },
        },
      ]);
      release(download, null);
    }
  });

  React.useEffect(() => {
    if (!host || !ready) return;
    const cap = settings.downloads.searches.read();
    const waiting = list.filter(
      (d) =>
        d.state === 'finding' &&
        // A picked version is placed where it was picked.
        !d.version &&
        d.base === client.base &&
        d.userId === user.Id &&
        !active.current.has(d.id) &&
        (d.leader || !d.batch || d.group !== undefined)
    );
    for (const d of waiting.slice(0, Math.max(0, cap - active.current.size))) {
      active.current.add(d.id);
      void resolve.current(d).finally(() => {
        active.current.delete(d.id);
        // Wakes this effect for the next one.
        updateDownloads([{ id: d.id, patch: {} }], false);
      });
    }
  }, [host, ready, list, client.base, user.Id, resolve]);
}
