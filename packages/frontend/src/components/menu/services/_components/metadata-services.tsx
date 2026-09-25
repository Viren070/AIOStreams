import { useStatus } from '@/context/status';
import { useUserData } from '@/context/userData';
import { SettingsCard } from '../../../shared/settings-card';
import { PasswordInput } from '../../../ui/password-input';
import { Select } from '../../../ui/select';

const INSTANCE_DEFAULT_PLACEHOLDER =
  'Provided by this instance (enter your own to override)';

const METADATA_PROVIDER_OPTIONS = [
  { label: 'Default', value: 'default' },
  { label: 'TMDB', value: 'tmdb' },
  { label: 'TVDB', value: 'tvdb' },
  { label: 'IMDb', value: 'imdb' },
];

const METADATA_PROVIDER_BUCKETS = [
  { key: 'global', label: 'Global' },
  { key: 'movies', label: 'Movies' },
  { key: 'series', label: 'Series' },
  { key: 'anime', label: 'Anime' },
] as const;

export function MetadataServices() {
  const { status } = useStatus();
  const { userData, setUserData } = useUserData();
  const provided = status?.settings.metadata;
  const tmdbAccessTokenProvided = !!provided?.tmdb.accessToken;
  const tmdbApiKeyProvided = !!provided?.tmdb.apiKey;
  const tvdbApiKeyProvided = !!provided?.tvdb.apiKey;

  return (
    <>
      <SettingsCard
        id="tmdb"
        title="TMDB"
        description={`Optionally provide your TMDB API Key and Read Access Token here. AIOStreams only needs one of them for title matching and its recommended and precaching to be able to
           determine when to move to the next season. Some addons in the marketplace will require one or the other too.`}
      >
        <PasswordInput
          autoComplete="new-password"
          label="TMDB Read Access Token"
          help={
            <>
              <p>
                You can get it from your{' '}
                <a
                  href="https://www.themoviedb.org/settings/api"
                  target="_blank"
                  className="text-[--brand] hover:underline"
                  rel="noopener noreferrer"
                >
                  TMDB Account Settings.{' '}
                </a>
                Make sure to copy the Read Access Token and not the 32 character
                API Key.
              </p>
            </>
          }
          required={!tmdbAccessTokenProvided && !tmdbApiKeyProvided}
          value={userData.tmdbAccessToken}
          placeholder={
            tmdbAccessTokenProvided
              ? INSTANCE_DEFAULT_PLACEHOLDER
              : 'Enter your TMDB access token'
          }
          onValueChange={(value) => {
            setUserData((prev) => ({ ...prev, tmdbAccessToken: value }));
          }}
        />
        <PasswordInput
          autoComplete="new-password"
          label="TMDB API Key"
          help={
            <span>
              You can get it from your{' '}
              <a
                href="https://www.themoviedb.org/settings/api"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[--brand] hover:underline"
              >
                TMDB Account Settings.{' '}
              </a>
              Make sure to copy the 32 character API Key and not the Read Access
              Token.
            </span>
          }
          placeholder={
            tmdbApiKeyProvided
              ? INSTANCE_DEFAULT_PLACEHOLDER
              : 'Enter your TMDB API Key'
          }
          value={userData.tmdbApiKey}
          onValueChange={(value) => {
            setUserData((prev) => ({ ...prev, tmdbApiKey: value }));
          }}
        />
      </SettingsCard>

      <SettingsCard
        id="tvdbApiKey"
        title="TVDB"
        description="Provide your TVDB API key to also fetch metadata from TVDB."
      >
        <PasswordInput
          autoComplete="new-password"
          label="TVDB API Key"
          value={userData.tvdbApiKey}
          placeholder={
            tvdbApiKeyProvided
              ? INSTANCE_DEFAULT_PLACEHOLDER
              : 'Enter your TVDB API Key'
          }
          help={
            <span>
              Sign up for a <b>free</b> API Key at{' '}
              <a
                href="https://www.thetvdb.com/api-information"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[--brand] hover:underline"
              >
                TVDB.{' '}
              </a>
            </span>
          }
          onValueChange={(value) => {
            setUserData((prev) => ({ ...prev, tvdbApiKey: value }));
          }}
        />
      </SettingsCard>

      <SettingsCard
        id="metadataProvider"
        title="Metadata Provider Preference"
        description="Controls which source (TMDB/TVDB/Cinemeta) wins when they disagree on a title's year, air dates, or episode numbering. Default reconciles them automatically; if your client's catalog/metadata addon numbers seasons differently (e.g. TVDB vs IMDb), matching that provider here keeps AIOStreams' search and filtering consistent with what you see. TMDB/TVDB need the matching API key above (Kitsu/MyAnimeList aren't used as metadata sources here, only for anime ID mapping)."
      >
        {METADATA_PROVIDER_BUCKETS.map(({ key, label }) => (
          <Select
            key={key}
            label={label}
            placeholder={key === 'global' ? undefined : 'Default (use Global)'}
            value={
              key === 'global'
                ? (userData.metadataProvider?.global ?? 'default')
                : (userData.metadataProvider?.[key] ?? '')
            }
            options={METADATA_PROVIDER_OPTIONS}
            onValueChange={(value) => {
              setUserData((prev) => ({
                ...prev,
                metadataProvider: {
                  ...(prev.metadataProvider ?? { global: 'default' }),
                  [key]:
                    value === ''
                      ? undefined
                      : (value as 'default' | 'tmdb' | 'tvdb' | 'imdb'),
                },
              }));
            }}
          />
        ))}
      </SettingsCard>
    </>
  );
}
