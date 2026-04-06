'use client';
import { useStatus } from '@/context/status';
import { PageWrapper } from '../shared/page-wrapper';
import { useState, useEffect } from 'react';
import * as constants from '../../../../core/src/utils/constants';
import { useUserData } from '@/context/userData';
import { Switch } from '../ui/switch';
import { Select } from '../ui/select';
import { Combobox } from '../ui/combobox';
import { SettingsCard } from '../shared/settings-card';
import { TextInput } from '../ui/text-input';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import MarkdownLite from '../shared/markdown-lite';
import { PageControls } from '../shared/page-controls';
import { PasswordInput } from '../ui/password-input';
import { useMode } from '@/context/mode';
type ProxyServiceId = keyof typeof constants.PROXY_SERVICE_DETAILS;

type ProxyConfig = {
  enabled: boolean;
  id: ProxyServiceId;
  url: string;
  credentials: string;
  publicIp?: string;
  proxiedAddons?: string[];
  proxiedServices?: string[];
};

export function ProxyMenu() {
  return (
    <>
      <PageWrapper className="space-y-4 p-4 sm:p-8">
        <Content />
      </PageWrapper>
    </>
  );
}

function Content() {
  const { status } = useStatus();
  const { userData, setUserData } = useUserData();
  const { mode } = useMode();
  const details = constants.PROXY_SERVICE_DETAILS;

  // Effect to initialize values from userData/defaults/forced

  // Generate options for proxy service select
  const proxyOptions = Object.entries(details).map(([id, detail]) => ({
    label: detail.name,
    value: id,
  }));

  // Generate options for services multi-select
  const serviceOptions = [
    ...Object.values(constants.SERVICE_DETAILS).map((service) => ({
      label: service.name,
      value: service.id,
      textValue: service.name,
    })),
    {
      label: 'None',
      value: 'none',
      textValue: 'None',
    },
  ];

  const addonOptions = userData.presets.map((preset) => {
    return {
      label: preset.options.name || preset.type,
      value: preset.instanceId,
      textValue: preset.options.name,
    };
  });

  // lues are forced
  const isForced = status?.settings.forced.proxy;
  const isProxyForced = isForced?.enabled !== null;
  const isUrlForced = isForced?.url !== null;
  const isPublicUrlForced = isForced?.publicUrl !== null;
  const isIdForced = isForced?.id !== null;
  const isPublicIpForced = isForced?.publicIp !== null;
  const isCredentialsForced = isForced?.credentials !== null;
  const isServicesForced = isForced?.proxiedServices !== null;
  const isProxiedAddonsDisabled = isForced?.disableProxiedAddons;

  const selectedProxyDetails = userData.proxy?.id
    ? details[userData.proxy.id]
    : undefined;

  return (
    <>
      <div className="flex items-center w-full">
        <div>
          <h2>Proxy</h2>
          <p className="text-[--muted]">
            Configure a proxy for your streams to bypass IP restrictions or
            improve compatibility
          </p>
        </div>
        <div className="hidden lg:block lg:ml-auto">
          <PageControls />
        </div>
      </div>

      <div className="space-y-2">
        <SettingsCard>
          <Switch
            side="right"
            label="Enable"
            value={userData.proxy?.enabled ?? false}
            onValueChange={(v) => {
              setUserData((prev) => ({
                ...prev,
                proxy: { ...prev.proxy, enabled: v },
              }));
            }}
            disabled={isProxyForced}
          />
        </SettingsCard>

        <SettingsCard>
          <div className="space-y-2">
            <Select
              label="Proxy Service"
              value={userData.proxy?.id}
              onValueChange={(v) => {
                setUserData((prev) => ({
                  ...prev,
                  proxy: { ...prev.proxy, id: v as ProxyServiceId },
                }));
              }}
              options={proxyOptions}
              disabled={isIdForced || !userData.proxy?.enabled}
            />
            {selectedProxyDetails && (
              <p className="text-[--muted] text-sm">
                <MarkdownLite>{selectedProxyDetails.description}</MarkdownLite>
              </p>
            )}
          </div>

          {userData.proxy?.id !== 'builtin' && (
            <div className="space-y-2">
              <PasswordInput
                label="URL"
                value={userData.proxy?.url ?? ''}
                onValueChange={(v) => {
                  setUserData((prev) => ({
                    ...prev,
                    proxy: { ...prev.proxy, url: v },
                  }));
                }}
                placeholder="Enter proxy URL"
                disabled={isUrlForced || !userData.proxy?.enabled}
              />
              <p className="text-[--muted] text-sm">
                The URL of your hosted proxy service.
              </p>
            </div>
          )}

          {userData.proxy?.id !== 'builtin' && (
            <div className="space-y-2">
              <PasswordInput
                label="Public URL (optional)"
                value={userData.proxy?.publicUrl ?? ''}
                onValueChange={(v) => {
                  setUserData((prev) => ({
                    ...prev,
                    proxy: { ...prev.proxy, publicUrl: v },
                  }));
                }}
                placeholder="Enter proxy public URL"
                disabled={isPublicUrlForced || !userData.proxy?.enabled}
              />
              <p className="text-[--muted] text-sm">
                The public URL of your hosted proxy service. Provide this only
                if you want to use a local URL for requests but a publicly
                accessible URL is needed for streams. e.g. setting http://
                {userData.proxy?.id
                  ? userData.proxy.id === 'stremthru'
                    ? 'stremthru:8080'
                    : 'mediaflow-proxy:8888'
                  : 'mediaflow-proxy:8888'}
                as the URL above but then using https://
                {userData.proxy?.id
                  ? userData.proxy.id === 'stremthru'
                    ? 'stremthru.yourdomain.com'
                    : 'mediaflow-proxy.yourdomain.com'
                  : 'mediaflow-proxy.yourdomain.com'}
                as the public URL.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <PasswordInput
              label="Credentials"
              value={userData.proxy?.credentials ?? ''}
              onValueChange={(v) => {
                setUserData((prev) => ({
                  ...prev,
                  proxy: { ...prev.proxy, credentials: v },
                }));
              }}
              placeholder="Enter proxy credentials"
              disabled={isCredentialsForced || !userData.proxy?.enabled}
            />
            {selectedProxyDetails && (
              <p className="text-[--muted] text-sm">
                <MarkdownLite>
                  {selectedProxyDetails.credentialDescription}
                </MarkdownLite>
              </p>
            )}
          </div>

          {mode === 'pro' && (
            <div className="space-y-2">
              <TextInput
                label="Public IP"
                value={userData.proxy?.publicIp ?? ''}
                onValueChange={(v) => {
                  setUserData((prev) => ({
                    ...prev,
                    proxy: { ...prev.proxy, publicIp: v || undefined },
                  }));
                }}
                placeholder="Enter public IP"
                disabled={isPublicIpForced || !userData.proxy?.enabled}
              />
              <p className="text-[--muted] text-sm">
                Configure this only when running {selectedProxyDetails?.name}{' '}
                locally with a proxy service. Leave empty if{' '}
                {selectedProxyDetails?.name} is configured locally without a
                proxy server or if it's hosted on a remote server.
              </p>
            </div>
          )}
        </SettingsCard>

        {mode === 'pro' && (
          <SettingsCard
            title="Proxy Controls"
            description="Optionally, specify services and addons that should be proxied. These options are applied conjunctively."
          >
            <div className="space-y-2">
              <Combobox
                label="Proxied Services"
                value={userData.proxy?.proxiedServices ?? []}
                onValueChange={(v) => {
                  setUserData((prev) => ({
                    ...prev,
                    proxy: { ...prev.proxy, proxiedServices: v },
                  }));
                }}
                options={serviceOptions}
                placeholder="Select services to proxy"
                multiple={true}
                disabled={isServicesForced || !userData.proxy?.enabled}
                emptyMessage="No services available"
              />
              <p className="text-[--muted] text-sm">
                Only streams (that are detected to be) from these services will
                be proxied. Select None to enable proxying of streams that are
                not detected to be from a service.
              </p>
            </div>

            <div className="space-y-2">
              <Combobox
                label="Proxied Addons"
                value={userData.proxy?.proxiedAddons ?? []}
                onValueChange={(v) => {
                  setUserData((prev) => ({
                    ...prev,
                    proxy: { ...prev.proxy, proxiedAddons: v },
                  }));
                }}
                options={addonOptions}
                placeholder="Select addons to proxy"
                multiple={true}
                disabled={isProxiedAddonsDisabled || !userData.proxy?.enabled}
                emptyMessage="No addons available"
              />
              <p className="text-[--muted] text-sm">
                Only streams from these addons will be proxied
              </p>
            </div>
          </SettingsCard>
        )}
      </div>
    </>
  );
}
