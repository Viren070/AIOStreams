'use client';
import { useUserData } from '@/context/userData';
import { SettingsCard } from '../../../shared/settings-card';
import { Select } from '../../../ui/select';
import { PasswordInput } from '../../../ui/password-input';
import { TextInput } from '../../../ui/text-input';
import { Switch } from '../../../ui/switch';

export function PosterServices() {
  const { userData, setUserData } = useUserData();

  return (
    <SettingsCard
      title="Poster Service"
      description="Select a poster service to use for catalogs that support it."
    >
      <Select
        label="Poster Service"
        options={[
          { label: 'None', value: 'none' },
          { label: 'RPDB', value: 'rpdb' },
          { label: 'Top Poster', value: 'top-poster' },
          { label: 'AIOratings', value: 'aioratings' },
        ]}
        value={userData.posterService || 'rpdb'}
        onValueChange={(v) => {
          setUserData((prev) => ({
            ...prev,
            posterService: v as 'rpdb' | 'top-poster' | 'aioratings' | 'none',
          }));
        }}
        defaultValue="rpdb"
      />

      {(!userData.posterService || userData.posterService === 'rpdb') && (
        <PasswordInput
          autoComplete="off"
          label="RPDB API Key"
          help={
            <span>
              Get your API Key from{' '}
              <a
                href="https://ratingposterdb.com/api-key/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[--brand] hover:underline"
              >
                here
              </a>
            </span>
          }
          value={userData.rpdbApiKey}
          onValueChange={(v) => {
            setUserData((prev) => ({ ...prev, rpdbApiKey: v }));
          }}
        />
      )}

      {userData.posterService === 'top-poster' && (
        <PasswordInput
          autoComplete="off"
          label="Top Poster API Key"
          help={
            <span>
              Get your API Key from{' '}
              <a
                href="https://api.top-streaming.stream/user/register"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[--brand] hover:underline"
              >
                here
              </a>
            </span>
          }
          value={userData.topPosterApiKey}
          onValueChange={(v) => {
            setUserData((prev) => ({ ...prev, topPosterApiKey: v }));
          }}
        />
      )}

      {userData.posterService === 'aioratings' && (
        <>
          <PasswordInput
            autoComplete="new-password"
            label="AIOratings API Key"
            help={
              <span>
                Get your API Key from{' '}
                <a
                  href="https://aioratings.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[--brand] hover:underline"
                >
                  here
                </a>
              </span>
            }
            value={userData.aioratingsApiKey}
            onValueChange={(v) => {
              setUserData((prev) => ({ ...prev, aioratingsApiKey: v }));
            }}
          />
          <TextInput
            label="AIOratings Profile ID"
            help={
              <span>
                Custom profiles are a premium feature that lets you design your
                own poster layout. Premium users can map their API key and
                default posters dynamically from the{' '}
                <a
                  href="https://aioratings.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[--brand] hover:underline"
                >
                  AIOratings website
                </a>
                . Free users can leave this as &quot;default&quot;.
              </span>
            }
            value={userData.aioratingsProfileId || 'default'}
            placeholder="default"
            onValueChange={(v) => {
              setUserData((prev) => ({ ...prev, aioratingsProfileId: v }));
            }}
          />
        </>
      )}

      <Switch
        label="Use Poster Service for Library/Continue Watching"
        side="right"
        value={userData.usePosterServiceForMeta || false}
        onValueChange={(v) => {
          setUserData((prev) => ({ ...prev, usePosterServiceForMeta: v }));
        }}
        disabled={
          userData.posterService === 'none' ||
          (!userData.rpdbApiKey &&
            !userData.topPosterApiKey &&
            !userData.aioratingsApiKey)
        }
        help={
          <span>
            If enabled, AIOStreams will use the selected poster service to fetch
            posters for single meta items — which generally means items in your
            Library and Continue Watching.
          </span>
        }
      />

      <Switch
        label="Use Poster Redirect API"
        side="right"
        disabled={
          userData.posterService === 'none' ||
          (!userData.rpdbApiKey &&
            !userData.topPosterApiKey &&
            !userData.aioratingsApiKey)
        }
        help={
          <span>
            If enabled, poster URLs will first contact AIOStreams and then be
            redirected to the selected poster service. This allows fallback
            posters to be used if the selected poster service is down or does
            not have a poster for that item. It can however cause a minimal
            slowdown due to having to contact AIOStreams first.
          </span>
        }
        value={userData.usePosterRedirectApi || false}
        onValueChange={(v) => {
          setUserData((prev) => ({ ...prev, usePosterRedirectApi: v }));
        }}
      />
    </SettingsCard>
  );
}
