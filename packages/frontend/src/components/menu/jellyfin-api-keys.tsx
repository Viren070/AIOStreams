import React, { useState } from 'react';
import { toast } from 'sonner';
import { FiCopy, FiKey, FiTrash2 } from 'react-icons/fi';
import type { UserData } from '@aiostreams/core';
import { useUserData } from '@/context/userData';
import { APIError, getJellyfinApiKeyToken } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { copyToClipboard } from '@/utils/clipboard';
import { Button, IconButton } from '@/components/ui/button';
import { TextInput } from '@/components/ui/text-input';
import {
  ConfirmationDialog,
  useConfirmationDialog,
} from '../shared/confirmation-dialog';

type ApiKey = NonNullable<NonNullable<UserData['jellyfin']>['apiKeys']>[number];

const MAX_KEYS = 10;

function newKeyId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function JellyfinApiKeys({ serverUrl }: { serverUrl: string }) {
  const { userData, setUserData, uuid, password, encryptedPassword } =
    useUserData();
  const keys = userData.jellyfin?.apiKeys ?? [];
  const [name, setName] = useState('');
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<string | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<ApiKey | null>(null);

  const setKeys = (next: ApiKey[]) =>
    setUserData((prev) => ({
      ...prev,
      jellyfin: { ...prev.jellyfin, apiKeys: next.length ? next : undefined },
    }));

  const add = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('A key needs a name.');
      return;
    }
    if (keys.length >= MAX_KEYS) {
      toast.error(`At most ${MAX_KEYS} keys.`);
      return;
    }
    setKeys([
      ...keys,
      { id: newKeyId(), name: trimmed, createdAt: new Date().toISOString() },
    ]);
    setName('');
    toast.info('Save your configuration, then copy the key.');
  };

  const copy = async (key: ApiKey) => {
    let token = tokens[key.id];
    if (!token) {
      if (!uuid) {
        toast.error('Save your configuration to activate this key.');
        return;
      }
      setLoading(key.id);
      try {
        ({ token } = await getJellyfinApiKeyToken(
          { uuid, password: password || encryptedPassword || null },
          key.id
        ));
        setTokens((prev) => ({ ...prev, [key.id]: token }));
      } catch (error) {
        toast.error(
          error instanceof APIError && error.detail
            ? error.detail
            : error instanceof Error
              ? error.message
              : 'Failed to get the key'
        );
        return;
      } finally {
        setLoading(null);
      }
    }
    await copyToClipboard(token, {
      onSuccess: () => toast.success(`Copied ${key.name}`),
      onError: () => toast.error('Copy failed; select the key and copy it.'),
    });
  };

  const revokeDialog = useConfirmationDialog({
    title: 'Revoke key',
    description: pendingRevoke
      ? `Tools using ${pendingRevoke.name} lose access once you save.`
      : undefined,
    actionText: 'Revoke',
    onConfirm: () => {
      if (pendingRevoke) {
        setKeys(keys.filter((k) => k.id !== pendingRevoke.id));
      }
      setPendingRevoke(null);
    },
  });

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400">
        Give a tool a key and the server address{' '}
        <span className="font-mono text-gray-300">{serverUrl}</span> instead of
        your password. A key acts as the administrator, so it sees every
        user&apos;s activity and history. Changing your password stops every
        key; copy them again afterwards.
      </p>

      {keys.length > 0 && (
        <ul className="divide-y divide-gray-800 rounded-md border border-gray-800">
          {keys.map((key) => (
            <li key={key.id} className="space-y-2 px-3 py-2">
              <div className="flex items-center gap-3">
                <FiKey className="shrink-0 text-[--muted]" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-white">{key.name}</p>
                  <p className="truncate text-xs text-[--muted]">
                    Created {formatDateTime(key.createdAt)}
                  </p>
                </div>
                <IconButton
                  size="sm"
                  intent="primary-subtle"
                  icon={<FiCopy />}
                  aria-label={`Copy ${key.name}`}
                  loading={loading === key.id}
                  onClick={() => copy(key)}
                />
                <IconButton
                  size="sm"
                  intent="alert-subtle"
                  icon={<FiTrash2 />}
                  aria-label={`Revoke ${key.name}`}
                  onClick={() => {
                    setPendingRevoke(key);
                    revokeDialog.open();
                  }}
                />
              </div>
              {tokens[key.id] && (
                <TextInput
                  type="text"
                  readOnly
                  value={tokens[key.id]}
                  className="font-mono text-sm"
                  onClick={(e) => e.currentTarget.select()}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2">
        <TextInput
          placeholder="Key name"
          value={name}
          maxLength={64}
          onValueChange={setName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add();
          }}
          className="flex-1"
        />
        <Button
          intent="white"
          rounded
          onClick={add}
          disabled={keys.length >= MAX_KEYS}
          className="shrink-0"
        >
          Create
        </Button>
      </div>

      <ConfirmationDialog {...revokeDialog} />
    </div>
  );
}
