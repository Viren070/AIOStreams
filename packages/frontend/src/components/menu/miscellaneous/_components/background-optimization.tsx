'use client';
import { useUserData } from '@/context/userData';
import { useStatus } from '@/context/status';
import { SettingsCard } from '../../../shared/settings-card';
import { Switch } from '../../../ui/switch';
import { TextInput } from '../../../ui/text-input';
import { DEFAULT_PRELOAD_SELECTOR } from '../../../../../../core/src/utils/constants';

export function BackgroundOptimization() {
  const { userData, setUserData } = useUserData();
  const { status } = useStatus();
  const maxBackgroundPings = status?.settings?.limits?.maxBackgroundPings;

  return (
    <>
      <SettingsCard
        title="Pre-cache Next Episode"
        id="precacheNextEpisode"
        description={
          <>
            Fetches the next episode&apos;s streams in the background and pings
            the URLs selected by the precache selector, triggering server-side
            caching before you click.{' '}
            {maxBackgroundPings !== undefined && (
              <>
                Up to <strong>{maxBackgroundPings}</strong> stream
                {maxBackgroundPings === 1 ? '' : 's'} can be pinged per
                operation (<code>MAX_BACKGROUND_PINGS</code>).
              </>
            )}
          </>
        }
      >
        <Switch
          label="Enable"
          side="right"
          value={userData.precacheNextEpisode}
          onValueChange={(value) => {
            setUserData((prev) => ({
              ...prev,
              precacheNextEpisode: value,
            }));
          }}
        />
        <Switch
          label="First stream only"
          help={
            <>
              When on (default), only the first stream returned by the selector
              is pinged. Turn off to ping all streams the selector returns
              {maxBackgroundPings !== undefined ? (
                <>
                  {' '}
                  (up to <strong>{maxBackgroundPings}</strong>,{' '}
                  <code>MAX_BACKGROUND_PINGS</code>)
                </>
              ) : (
                <>
                  {' '}
                  (capped by <code>MAX_BACKGROUND_PINGS</code>)
                </>
              )}
              .
            </>
          }
          side="right"
          disabled={!userData.precacheNextEpisode}
          value={userData.precacheSingleStream ?? true}
          defaultValue={true}
          onValueChange={(value) => {
            setUserData((prev) => ({
              ...prev,
              precacheSingleStream: value,
            }));
          }}
        />
        <TextInput
          label="Precache Selector"
          help={
            <>
              <p>
                A SEL expression that determines which stream(s) to precache for
                the next episode. Should evaluate to a list of streams.
              </p>
              <p className="mt-2">
                <strong>Recommended pattern:</strong>{' '}
                <code>condition ? streamsToSelectFrom : []</code>
              </p>
              <ul className="mt-2 space-y-1 list-disc list-inside">
                <li>
                  <code>condition</code> - When precaching should activate
                </li>
                <li>
                  <code>streamsToSelectFrom</code> - Which streams AIOStreams
                  should choose from
                </li>
              </ul>
              <p className="mt-2">
                <strong>Examples:</strong>
              </p>
              <ul className="mt-2 space-y-1 list-disc list-inside">
                <li>
                  <strong>Default behavior</strong> (precache only when all
                  streams are uncached):
                  <br />
                  <code className="text-xs">
                    count(cached(streams)) == 0 ? uncached(streams) : []
                  </code>
                </li>
                <li>
                  <strong>Always precache first uncached stream:</strong>
                  <br />
                  <code className="text-xs">true ? uncached(streams) : []</code>
                </li>
                <li>
                  <strong>Only for anime series:</strong>
                  <br />
                  <code className="text-xs">
                    queryType == &apos;anime.series&apos; ? uncached(streams) :
                    []
                  </code>
                </li>
              </ul>
              <p className="mt-2 text-sm text-gray-600">
                Has access to the same constants as expression filters (streams,
                queryType, isAnime, etc.).
              </p>
            </>
          }
          placeholder="e.g., true ? uncached(streams) : []"
          disabled={!userData.precacheNextEpisode}
          value={userData.precacheSelector ?? ''}
          onValueChange={(value) => {
            setUserData((prev) => ({
              ...prev,
              precacheSelector: value || undefined,
            }));
          }}
        />
      </SettingsCard>

      <SettingsCard
        title="Preload Streams"
        id="preloadStreams"
        description={
          <>
            Automatically sends HTTP requests to selected streams so they start
            processing before you click — runs asynchronously without delaying
            results.{' '}
            {maxBackgroundPings !== undefined && (
              <>
                Up to <strong>{maxBackgroundPings}</strong> stream
                {maxBackgroundPings === 1 ? '' : 's'} can be pinged per
                operation (<code>MAX_BACKGROUND_PINGS</code>).
              </>
            )}
          </>
        }
      >
        <Switch
          label="Enable"
          side="right"
          value={userData.preloadStreams?.enabled}
          onValueChange={(value) => {
            setUserData((prev) => ({
              ...prev,
              preloadStreams: {
                ...prev.preloadStreams,
                enabled: value,
              },
            }));
          }}
        />
        <Switch
          label="First stream only"
          help={
            <>
              When on (default), only the first stream returned by the selector
              is pinged. Turn off to ping all streams the selector returns
              {maxBackgroundPings !== undefined ? (
                <>
                  {' '}
                  (up to <strong>{maxBackgroundPings}</strong>,{' '}
                  <code>MAX_BACKGROUND_PINGS</code>)
                </>
              ) : (
                <>
                  {' '}
                  (capped by <code>MAX_BACKGROUND_PINGS</code>)
                </>
              )}
              .
            </>
          }
          side="right"
          disabled={!userData.preloadStreams?.enabled}
          value={userData.preloadStreams?.singleStream ?? true}
          defaultValue={true}
          onValueChange={(value) => {
            setUserData((prev) => ({
              ...prev,
              preloadStreams: {
                ...prev.preloadStreams,
                singleStream: value,
              },
            }));
          }}
        />
        <TextInput
          label="Preload Selector"
          help={
            <>
              <p>
                A SEL expression that determines which streams to preload.
                Should evaluate to a list of streams — all streams in the result
                will have an HTTP request sent to their URLs.
              </p>
              <p className="mt-2">
                <strong>Examples:</strong>
              </p>
              <ul className="mt-2 space-y-1 list-disc list-inside">
                <li>
                  <strong>Top 5 streams (default):</strong>
                  <br />
                  <code className="text-xs">slice(streams, 0, 5)</code>
                </li>
                <li>
                  <strong>Top 5 usenet streams only:</strong>
                  <br />
                  <code className="text-xs">
                    slice(type(streams, &apos;usenet&apos;), 0, 5)
                  </code>
                </li>
                <li>
                  <strong>Top 3 cached streams:</strong>
                  <br />
                  <code className="text-xs">slice(cached(streams), 0, 3)</code>
                </li>
              </ul>
              <p className="mt-2 text-sm text-gray-600">
                Has access to the same constants as expression filters (streams,
                queryType, isAnime, etc.).
              </p>
            </>
          }
          defaultValue={DEFAULT_PRELOAD_SELECTOR}
          disabled={!userData.preloadStreams?.enabled}
          value={userData.preloadStreams?.selector ?? ''}
          onValueChange={(value) => {
            setUserData((prev) => ({
              ...prev,
              preloadStreams: {
                ...prev.preloadStreams,
                selector: value || undefined,
              },
            }));
          }}
        />
      </SettingsCard>
    </>
  );
}
