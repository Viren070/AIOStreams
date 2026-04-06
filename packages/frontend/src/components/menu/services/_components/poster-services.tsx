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
          { label: 'TOP Posters', value: 'top-poster' },
          { label: 'AIOratings', value: 'aioratings' },
          { label: 'OpenPosterDB', value: 'openposterdb' },
        ]}
        value={userData.posterService || 'rpdb'}
        onValueChange={(v) => {
          setUserData((prev) => ({
            ...prev,
            posterService: v as
              | 'rpdb'
              | 'top-poster'
              | 'aioratings'
              | 'openposterdb'
              | 'none',
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
          label="TOP Posters API Key"
          help={
            <span>
              Get your API Key from{' '}
              <a
                href="https://api.top-posters.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[--brand] hover:underline"
              >
                TOP Posters
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

      {userData.posterService === 'openposterdb' && (
        <>
          <PasswordInput
            autoComplete="off"
            label="OpenPosterDB API Key"
            help={
              <span>
                Get your API Key from{' '}
                <a
                  href="https://openposterdb.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[--brand] hover:underline"
                >
                  here
                </a>
              </span>
            }
            value={userData.openposterdbApiKey}
            onValueChange={(v) => {
              setUserData((prev) => ({ ...prev, openposterdbApiKey: v }));
            }}
          />
          <TextInput
            label="OpenPosterDB URL"
            help={
              <span>
                Custom base URL for OpenPosterDB. Leave empty to use the
                default.
              </span>
            }
            value={userData.openposterdbUrl || ''}
            placeholder="https://openposterdb.com"
            onValueChange={(v) => {
              setUserData((prev) => ({ ...prev, openposterdbUrl: v }));
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
            !userData.aioratingsApiKey &&
            !userData.openposterdbApiKey)
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
            !userData.aioratingsApiKey &&
            !userData.openposterdbApiKey)
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
