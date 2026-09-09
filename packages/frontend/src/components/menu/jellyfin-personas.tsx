import React, { useState } from 'react';
import { useUserData } from '@/context/userData';
import { useStatus } from '@/context/status';
import { VariantPills } from '../shared/variant-pills';
import {
  ConfirmationDialog,
  useConfirmationDialog,
} from '../shared/confirmation-dialog';
import { Button, IconButton } from '@/components/ui/button';
import { TextInput } from '@/components/ui/text-input';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Modal } from '@/components/ui/modal';
import { toast } from 'sonner';
import { FiEdit2, FiPlus, FiTrash2 } from 'react-icons/fi';
import type { UserData } from '@aiostreams/core';

type JellyfinSettings = NonNullable<UserData['jellyfin']>;
type Persona = NonNullable<JellyfinSettings['personas']>[number];
type Primary = NonNullable<JellyfinSettings['primary']>;
type VariantOptionList = React.ComponentProps<typeof VariantPills>['variants'];

const UUID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Fallback until the status call lands; the instance cap is the real bound. */
const DEFAULT_MAX_PERSONAS = 20;

/**
 * The id keys the user's history, so it is minted once from the name and never
 * edited: the same name gets the same history back.
 */
function idFor(name: string, existing: Persona[]): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 28) || 'user';
  let id = base;
  for (let i = 2; existing.some((p) => p.id === id); i++) id = `${base}-${i}`;
  return id;
}

const sameName = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

function variantsLabel(ids: string[] | undefined): string {
  return ids?.length ? `Variants ${ids.join(', ')}` : 'Base config';
}

function Avatar({ name, avatar }: { name: string; avatar?: string }) {
  if (avatar) {
    return (
      <img
        src={avatar}
        alt=""
        className="h-8 w-8 shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[--subtle] text-xs font-semibold uppercase text-[--muted]">
      {name.trim().charAt(0) || '?'}
    </span>
  );
}

function UserRow({
  name,
  avatar,
  summary,
  onEdit,
  onDelete,
}: {
  name: string;
  avatar?: string;
  summary: string;
  onEdit: () => void;
  onDelete?: () => void;
}) {
  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <Avatar name={name} avatar={avatar} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-white">{name}</p>
        <p className="truncate text-xs text-[--muted]">{summary}</p>
      </div>
      <IconButton
        size="sm"
        intent="gray-subtle"
        icon={<FiEdit2 />}
        aria-label={`Edit ${name}`}
        onClick={onEdit}
      />
      {onDelete && (
        <IconButton
          size="sm"
          intent="alert-subtle"
          icon={<FiTrash2 />}
          aria-label={`Remove ${name}`}
          onClick={onDelete}
        />
      )}
    </li>
  );
}

function VariantsField({
  variants,
  value,
  onChange,
}: {
  variants: VariantOptionList;
  value: string[];
  onChange: (value: string[]) => void;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">Variants</p>
      <p className="text-xs text-[--muted]">
        Applied while this user is signed in, in the order picked.
      </p>
      <VariantPills variants={variants} value={value} onChange={onChange} />
    </div>
  );
}

/** Jellyfin clients show these as users of the server. */
export function JellyfinPersonas() {
  const { userData, setUserData } = useUserData();
  const { status } = useStatus();
  const maxPersonas =
    status?.settings?.jellyfin?.maxPersonas ?? DEFAULT_MAX_PERSONAS;
  const personas = userData.jellyfin?.personas ?? [];
  const primary = userData.jellyfin?.primary;
  const primaryName = primary?.name || userData.addonName || 'Primary user';
  const variants: VariantOptionList = (userData.variants ?? [])
    .filter((v) => v.enabled !== false)
    .map((v) => ({
      id: v.id,
      name: v.name,
      enabled: v.enabled,
      when: v.when ? String(v.when) : undefined,
    }));
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<Persona | null>(null);
  const [primaryDraft, setPrimaryDraft] = useState<Primary | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<number | null>(null);

  const patch = (values: Partial<JellyfinSettings>) =>
    setUserData((prev) => ({
      ...prev,
      jellyfin: { ...prev.jellyfin, ...values },
    }));

  const close = () => {
    setEditing(null);
    setDraft(null);
  };

  const openAdd = () => {
    if (personas.length >= maxPersonas) {
      toast.error(`At most ${maxPersonas} users.`);
      return;
    }
    setDraft({ id: '', name: '', history: 'own' });
    setEditing(personas.length);
  };

  const commit = () => {
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) {
      toast.error('A user needs a name.');
      return;
    }
    if (UUID_SHAPE.test(name)) {
      toast.error('A name cannot look like a configuration id.');
      return;
    }
    if (
      sameName(name, primaryName) ||
      personas.some((p, i) => sameName(p.name, name) && i !== editing)
    ) {
      toast.error('Another user already has this name.');
      return;
    }
    const known = new Set(variants.map((v) => v.id));
    if ((draft.variants ?? []).some((id) => !known.has(id))) {
      toast.error('A linked variant no longer exists or is disabled.');
      return;
    }
    const next = [...personas];
    const value: Persona = {
      ...draft,
      id: draft.id || idFor(name, personas),
      name,
      avatar: draft.avatar?.trim() || undefined,
      variants: draft.variants?.length ? draft.variants : undefined,
      hidden: draft.hidden || undefined,
    };
    if (editing !== null && editing < personas.length) next[editing] = value;
    else next.push(value);
    patch({ personas: next });
    close();
  };

  const commitPrimary = () => {
    if (!primaryDraft) return;
    const name = primaryDraft.name?.trim() || '';
    if (name && personas.some((p) => sameName(p.name, name))) {
      toast.error('Another user already has this name.');
      return;
    }
    const value: Primary = {
      name: name || undefined,
      avatar: primaryDraft.avatar?.trim() || undefined,
      variants: primaryDraft.variants?.length
        ? primaryDraft.variants
        : undefined,
    };
    patch({ primary: Object.values(value).some(Boolean) ? value : undefined });
    setPrimaryDraft(null);
  };

  const remove = (index: number) => {
    patch({
      personas:
        personas.length > 1
          ? personas.filter((_, i) => i !== index)
          : undefined,
    });
    toast.info('Removed. A user with the same name gets its history back.');
  };

  const removalTarget =
    pendingRemoval !== null ? personas[pendingRemoval] : undefined;
  const removeDialog = useConfirmationDialog({
    title: 'Remove user',
    description: removalTarget
      ? `${removalTarget.name} will stop appearing on the sign-in picker once you save. ${
          removalTarget.history === 'shared'
            ? 'It shares the primary user’s history, so nothing is lost.'
            : 'Its watch history is kept, and a user added again under the same name gets it back.'
        }`
      : undefined,
    actionText: 'Remove',
    onConfirm: () => {
      if (pendingRemoval !== null) remove(pendingRemoval);
      setPendingRemoval(null);
    },
  });

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400">
        Shown as users of the server. Everyone signs in with this
        configuration&apos;s password. The primary user is this configuration
        itself, and the history your trackers sync with.
      </p>

      <ul className="divide-y divide-gray-800 rounded-md border border-gray-800">
        <UserRow
          name={primaryName}
          avatar={primary?.avatar}
          summary={`Primary user · ${variantsLabel(primary?.variants)} · syncs with your trackers`}
          onEdit={() => setPrimaryDraft({ ...primary })}
        />
        {personas.map((persona, index) => (
          <UserRow
            key={persona.id}
            name={persona.name}
            avatar={persona.avatar}
            summary={[
              variantsLabel(persona.variants),
              persona.history === 'shared'
                ? "shares the primary user's history"
                : 'own history',
              persona.hidden ? 'hidden from the picker' : null,
            ]
              .filter(Boolean)
              .join(' · ')}
            onEdit={() => {
              setDraft({ ...persona });
              setEditing(index);
            }}
            onDelete={() => {
              setPendingRemoval(index);
              removeDialog.open();
            }}
          />
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-3">
        {maxPersonas > 0 ? (
          <Button
            size="sm"
            intent="white"
            rounded
            leftIcon={<FiPlus />}
            onClick={openAdd}
            disabled={personas.length >= maxPersonas}
          >
            Add user
          </Button>
        ) : (
          <span className="text-xs text-[--muted]">
            This instance does not allow extra users.
          </span>
        )}
        {personas.length > 0 && (
          <span className="text-xs text-[--muted]">
            {personas.length} of {maxPersonas}
          </span>
        )}
      </div>

      {primaryDraft && (
        <Modal
          open
          onOpenChange={() => setPrimaryDraft(null)}
          title="Primary user"
        >
          <div className="space-y-4">
            <TextInput
              label="Name"
              help="Shown by clients. Defaults to your addon name."
              placeholder={userData.addonName || 'Primary user'}
              value={primaryDraft.name ?? ''}
              onValueChange={(value) =>
                setPrimaryDraft({ ...primaryDraft, name: value || undefined })
              }
            />
            <VariantsField
              variants={variants}
              value={primaryDraft.variants ?? []}
              onChange={(value) =>
                setPrimaryDraft({
                  ...primaryDraft,
                  variants: value.length ? value : undefined,
                })
              }
            />
            <TextInput
              label="Avatar URL"
              help="Optional. Shown on the sign-in picker."
              placeholder="https://"
              value={primaryDraft.avatar ?? ''}
              onValueChange={(value) =>
                setPrimaryDraft({ ...primaryDraft, avatar: value || undefined })
              }
            />
            <div className="flex items-center justify-end gap-2">
              <Button
                size="sm"
                intent="primary-subtle"
                onClick={() => setPrimaryDraft(null)}
              >
                Cancel
              </Button>
              <Button size="sm" intent="primary" onClick={commitPrimary}>
                Save
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {draft && (
        <Modal open onOpenChange={close} title="Jellyfin user">
          <div className="space-y-4">
            <TextInput
              label="Name"
              help="Shown by clients, and typed to sign in."
              value={draft.name}
              onValueChange={(value) => setDraft({ ...draft, name: value })}
            />

            <Select
              label="History"
              help="Own: a separate Continue Watching. Shared: the primary user's."
              moreHelp="With its own history, a user reports to a tracker only if its variants swap in a different tracker addon. Sharing the primary user's history means sharing its trackers too."
              value={draft.history}
              onValueChange={(value) =>
                setDraft({ ...draft, history: value as Persona['history'] })
              }
              options={[
                { label: 'Own', value: 'own' },
                { label: 'Shared with the primary user', value: 'shared' },
              ]}
            />

            <VariantsField
              variants={variants}
              value={draft.variants ?? []}
              onChange={(value) =>
                setDraft({
                  ...draft,
                  variants: value.length ? value : undefined,
                })
              }
            />

            <TextInput
              label="Avatar URL"
              help="Optional. Shown on the sign-in picker."
              placeholder="https://"
              value={draft.avatar ?? ''}
              onValueChange={(value) =>
                setDraft({ ...draft, avatar: value || undefined })
              }
            />

            <Switch
              label="Hide from the sign-in picker"
              help="Still signs in by name."
              side="right"
              value={draft.hidden ?? false}
              onValueChange={(value) =>
                setDraft({ ...draft, hidden: value || undefined })
              }
            />

            <div className="flex items-center justify-end gap-2">
              <Button size="sm" intent="primary-subtle" onClick={close}>
                Cancel
              </Button>
              <Button size="sm" intent="primary" onClick={commit}>
                Save
              </Button>
            </div>
          </div>
        </Modal>
      )}

      <ConfirmationDialog {...removeDialog} />
    </div>
  );
}
