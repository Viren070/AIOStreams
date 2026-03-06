'use client';
import { useStatus } from '@/context/status';
import { useUserData } from '@/context/userData';
import { SettingsCard } from '../../../shared/settings-card';
import { PasswordInput } from '../../../ui/password-input';

export function MetadataServices() {
  const { status } = useStatus();
  const { userData, setUserData } = useUserData();

  return (
    <>
      <SettingsCard
        title="TMDB"
        description={`Optionally provide your TMDB API Key and Read Access Token here. AIOStreams only needs one of them for title matching and its recommended and precaching to be able to
           determine when to move to the next season. Some addons in the marketplace will require one or the other too.`}
      >
        <PasswordInput
          autoComplete="off"
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
          required={!status?.settings.tmdbApiAvailable}
          value={userData.tmdbAccessToken}
          placeholder="Enter your TMDB access token"
          onValueChange={(value) => {
            setUserData((prev) => ({ ...prev, tmdbAccessToken: value }));
          }}
        />
        <PasswordInput
          autoComplete="off"
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
          placeholder="Enter your TMDB API Key"
          value={userData.tmdbApiKey}
          onValueChange={(value) => {
            setUserData((prev) => ({ ...prev, tmdbApiKey: value }));
          }}
        />
      </SettingsCard>

      <SettingsCard
        title="TVDB"
        description="Provide your TVDB API key to also fetch metadata from TVDB."
      >
        <PasswordInput
          autoComplete="off"
          label="TVDB API Key"
          value={userData.tvdbApiKey}
          placeholder="Enter your TVDB API Key"
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
    </>
  );
}
