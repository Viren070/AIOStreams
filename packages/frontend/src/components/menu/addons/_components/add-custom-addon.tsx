import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@aiostreams/ui/button';
import { Modal } from '@aiostreams/ui/modal';
import { TextInput } from '@aiostreams/ui/text-input';
import { useUserData } from '@/context/userData';
import { manifestCache } from './my-addons';

interface Manifest {
  name: string;
  description?: string;
  logo?: string;
}

const standardise = (url: string) =>
  url
    .trim()
    .replace(/^stremio:\/\//, 'https://')
    .replace(/\/$/, '');

function manifestHost(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return undefined;
    return parsed.pathname.endsWith('/manifest.json') ? parsed.host : undefined;
  } catch {
    return undefined;
  }
}

async function fetchManifest(url: string): Promise<Manifest> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new Error('no response');
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const manifest = await res.json().catch(() => undefined);
  if (typeof manifest?.name !== 'string')
    throw new Error('not an addon manifest');
  manifestCache.set(url, manifest);
  return manifest;
}

export function AddCustomAddonModal({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (options: { name: string; manifestUrl: string }) => void;
}) {
  const { userData } = useUserData();
  const [input, setInput] = useState('');
  useEffect(() => {
    if (open) setInput('');
  }, [open]);

  const url = standardise(input);
  const host = manifestHost(url);
  const duplicate =
    !!host &&
    userData.presets.some(
      (p) =>
        p.type === 'custom' && standardise(p.options?.manifestUrl ?? '') === url
    );
  const manifest = useQuery({
    queryKey: ['addon-manifest', url],
    queryFn: () => fetchManifest(url),
    enabled: open && !!host && !duplicate,
    retry: false,
    staleTime: Infinity,
  });
  const name = manifest.data?.name.trim() || host;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Add addon by URL"
      description="For addons that aren't in the Marketplace. You can change its other settings after adding it."
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (host && name && !duplicate) onSubmit({ name, manifestUrl: url });
        }}
      >
        <TextInput
          label="Manifest URL"
          placeholder="https://example.com/manifest.json"
          value={input}
          onValueChange={setInput}
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          autoFocus
        />
        {input.trim() && !host ? (
          <p className="text-sm text-[--muted]">
            Paste a link that ends in /manifest.json.
          </p>
        ) : duplicate ? (
          <p className="text-sm text-[--red]">
            This addon is already installed.
          </p>
        ) : manifest.isFetching ? (
          <p className="text-sm text-[--muted]">Reading the manifest…</p>
        ) : manifest.data ? (
          <div className="flex items-center gap-3 rounded-[--radius-md] border bg-[--subtle] p-3">
            <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-md bg-[--background]">
              {manifest.data.logo ? (
                <img
                  src={manifest.data.logo}
                  alt=""
                  className="h-full w-full object-contain"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className="font-semibold">
                  {name?.[0]?.toUpperCase()}
                </span>
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{name}</p>
              {manifest.data.description && (
                <p className="line-clamp-2 text-xs text-[--muted]">
                  {manifest.data.description}
                </p>
              )}
            </div>
          </div>
        ) : manifest.error ? (
          <p className="text-sm text-[--muted]">
            Your browser couldn't read the manifest ({manifest.error.message}
            ). You can still add it, named "{host}" until you rename it.
          </p>
        ) : null}
        <Button
          type="submit"
          intent="white"
          rounded
          className="w-full"
          disabled={!host || duplicate}
          loading={manifest.isFetching}
        >
          Add addon
        </Button>
      </form>
    </Modal>
  );
}
