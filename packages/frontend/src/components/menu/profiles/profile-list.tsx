import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DndContext } from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useUserData } from '@/context/userData';
import { useStatus } from '@/context/status';
import { watchStateTrackersQuery } from '@/lib/queries';
import type { WatchStateTrackerOption } from '@/lib/api';
import { cn } from '@aiostreams/ui/core/styling';
import { pill, VariantPills } from '../../shared/variant-pills';
import { UserAvatar } from '../../shared/user-avatar';
import { profileLabel, releaseOwnVariant } from '@/lib/audiences';
import { useSortableRows } from '../../shared/sortable-rows';
import {
  ConfirmationDialog,
  useConfirmationDialog,
} from '@aiostreams/ui/shared/confirmation-dialog';
import { Button, IconButton } from '@aiostreams/ui/button';
import { TextInput } from '@aiostreams/ui/text-input';
import { Select } from '@aiostreams/ui/select';
import { Switch } from '@aiostreams/ui/switch';
import { Modal } from '@aiostreams/ui/modal';
import { copyToClipboard } from '@aiostreams/ui/utils/clipboard';
import { toast } from 'sonner';
import { FiEdit2, FiPlus, FiTrash2 } from 'react-icons/fi';
import type { Profile, UserData } from '@aiostreams/core';
import { isOwner, profilesOf } from '../../../../../core/src/utils/profiles';

type VariantOptionList = React.ComponentProps<typeof VariantPills>['variants'];

const UUID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Fallback until the status call lands; the instance cap is the real bound. */
const DEFAULT_MAX_PROFILES = 20;
const NO_TRACKER_OPTIONS: WatchStateTrackerOption[] = [];

const ADDRESS_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
const ADDRESS_LENGTH = 10;

/** Random, so an address gives away neither the configuration nor the profile. */
function newAddress(): string {
  let code = '';
  while (code.length < ADDRESS_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
      // 252 is the largest multiple of 36 under 256, so every character is as likely.
      if (byte < 252 && code.length < ADDRESS_LENGTH)
        code += ADDRESS_CHARS[byte % ADDRESS_CHARS.length];
    }
  }
  return code;
}

function stored(profiles: Profile[]): UserData['profiles'] {
  const [owner, ...others] = profiles;
  const ownerSet = Object.entries(owner).some(
    ([key, value]) => key !== 'id' && value !== undefined
  );
  return others.length || ownerSet ? profiles : undefined;
}

function PersonalAddress({
  url,
  pinSignIn,
  onRenew,
}: {
  url: string;
  pinSignIn: boolean;
  onRenew: () => void;
}) {
  const copy = () =>
    copyToClipboard(url, {
      onSuccess: () => toast.success('Address copied to clipboard'),
      onError: () => toast.error('Failed to copy address'),
    });
  return (
    <div className="space-y-2">
      <TextInput
        label="Their address"
        value={url}
        readOnly
        onFocus={(e) => e.currentTarget.select()}
        help={
          pinSignIn
            ? 'Signs in this profile alone, with its PIN. Works once you save, and a new address turns this one off.'
            : 'Signs in this profile alone. This instance asks for your password there, so approve their devices with Quick Connect instead. Works once you save, and a new address turns this one off.'
        }
      />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" intent="white" rounded onClick={() => void copy()}>
          Copy
        </Button>
        <Button size="sm" intent="gray-subtle" rounded onClick={onRenew}>
          New address
        </Button>
      </div>
    </div>
  );
}

/** Tracker addons repeat this rule to match a name to its id, so it must not change. */
function slugOf(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 28) || 'user'
  );
}

/**
 * The id keys the profile's history, so it is minted once from the name and
 * never edited: the same name gets the same history back.
 */
function idFor(name: string, existing: Profile[]): string {
  const base = slugOf(name);
  let id = base;
  for (let i = 2; existing.some((p) => p.id === id); i++) id = `${base}-${i}`;
  return id;
}

const sameName = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

function variantsLabel(ids: string[] | undefined): string {
  return ids?.length ? `Variants ${ids.join(', ')}` : 'Base config';
}

function trackersLabel(ids: string[]): string {
  if (!ids.length) return 'no trackers';
  return ids.length === 1 ? '1 tracker' : `${ids.length} trackers`;
}

interface UserRowProps {
  name: string;
  avatar?: string;
  summary: string;
  dragHandleProps?: { attributes: any; listeners: any } | null;
  onEdit: () => void;
  onDelete?: () => void;
  extra?: React.ReactNode;
}

function UserRow({
  name,
  avatar,
  summary,
  dragHandleProps,
  onEdit,
  onDelete,
  extra,
}: UserRowProps) {
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      {dragHandleProps ? (
        <div
          className="w-6 shrink-0 touch-manipulation cursor-move self-stretch rounded-full bg-[--muted] md:bg-[--subtle] md:hover:bg-[--subtle-highlight]"
          aria-label={`Move ${name}`}
          {...dragHandleProps.attributes}
          {...dragHandleProps.listeners}
        />
      ) : (
        <div className="w-6 shrink-0" />
      )}
      <UserAvatar name={name} avatar={avatar} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-white">{name}</p>
        <p className="truncate text-xs text-[--muted]">{summary}</p>
      </div>
      {extra}
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
    </div>
  );
}

function SortableUserRow({
  id,
  ...row
}: Omit<UserRowProps, 'dragHandleProps'> & { id: string }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
    >
      <UserRow {...row} dragHandleProps={{ attributes, listeners }} />
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
        Applied while this profile is signed in, in the order picked.
      </p>
      <VariantPills variants={variants} value={value} onChange={onChange} />
    </div>
  );
}

interface TrackerChoice extends WatchStateTrackerOption {
  takenBy?: string;
}

/** `undefined` is Automatic; an empty list syncs with no trackers. */
function TrackersField({
  choices,
  value,
  onChange,
  automatic,
  note,
  loading,
  maxTrackers,
}: {
  choices: TrackerChoice[];
  value: string[] | undefined;
  onChange: (value: string[] | undefined) => void;
  automatic: string;
  note?: string;
  loading: boolean;
  maxTrackers?: number;
}) {
  const toggle = (id: string) => {
    const current = value ?? [];
    onChange(
      current.includes(id) ? current.filter((v) => v !== id) : [...current, id]
    );
  };
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">Trackers</p>
      <p className="text-xs text-[--muted]">
        {!value
          ? automatic
          : value.length
            ? 'Syncs only with the tracker addons picked.'
            : 'Syncs with no trackers.'}
      </p>
      {loading ? (
        <p className="text-xs text-[--muted]">Loading tracker addons…</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className={pill(value === undefined)}
          >
            Automatic
          </button>
          <button
            type="button"
            onClick={() => onChange([])}
            className={pill(!!value && !value.length)}
          >
            None
          </button>
          {choices.map((choice) => {
            const selected = !!value?.includes(choice.presetId);
            return (
              <button
                key={choice.presetId}
                type="button"
                disabled={!selected && !!choice.takenBy}
                onClick={() => toggle(choice.presetId)}
                className={cn(
                  pill(selected),
                  'disabled:cursor-not-allowed disabled:opacity-50'
                )}
                title={
                  choice.takenBy
                    ? `${choice.takenBy} syncs with this tracker`
                    : undefined
                }
              >
                {choice.addon}
                {choice.takenBy && (
                  <span className="ml-1 opacity-60">{choice.takenBy}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
      {note && <p className="text-xs text-[--muted]">{note}</p>}
      {maxTrackers !== undefined && value && value.length > maxTrackers && (
        <p className="text-xs text-[--orange]">
          This instance syncs each profile with at most {maxTrackers} trackers,
          so only {maxTrackers} of these are used.
        </p>
      )}
      <p className="text-xs text-[--muted]">
        A tracker syncs with one history at a time, unless it keeps each profile
        apart, and moving it to another profile brings along what it already
        recorded.{' '}
        {!loading && !choices.length
          ? 'No tracker addons in your saved configuration yet; add one and save.'
          : 'Added a tracker addon? Save, and it shows here.'}
      </p>
    </div>
  );
}

const PIN_SHAPE = /^\d{4,12}$/;
/** Must match the server's floor for signing in with a PIN alone. */
const PIN_ONLY_LENGTH = 6;
const PIN_ONLY_SHAPE = new RegExp(`^\\d{${PIN_ONLY_LENGTH},12}$`);

/** A saved PIN comes back as its hash, never as the digits. */
function isSavedPin(lock: string | undefined): lock is string {
  return !!lock && lock.startsWith('$2');
}

function PinField({
  value,
  onChange,
  help,
}: {
  value: string | undefined;
  onChange(value: string | undefined): void;
  help: string;
}) {
  const [saved] = useState(isSavedPin(value) ? value : undefined);
  const [mode, setMode] = useState<'saved' | 'edit' | 'removed'>(
    saved ? 'saved' : 'edit'
  );

  if (mode !== 'edit') {
    return (
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">PIN</p>
          <p className="text-xs text-[--muted]">
            {mode === 'saved' ? 'Set. ' + help : 'Removed when you save.'}
          </p>
        </div>
        <div className="flex flex-none gap-2">
          {mode === 'saved' ? (
            <>
              <Button
                size="sm"
                intent="gray-outline"
                rounded
                onClick={() => setMode('edit')}
              >
                Change
              </Button>
              <Button
                size="sm"
                intent="alert-subtle"
                rounded
                onClick={() => {
                  setMode('removed');
                  onChange(undefined);
                }}
              >
                Remove
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              intent="gray-outline"
              rounded
              onClick={() => {
                setMode('saved');
                onChange(saved);
              }}
            >
              Undo
            </Button>
          )}
        </div>
      </div>
    );
  }
  return (
    <TextInput
      label="PIN"
      type="password"
      inputMode="numeric"
      autoComplete="new-password"
      placeholder={saved ? 'Unchanged' : 'None'}
      help={`Optional, 4 to 12 digits. ${help}`}
      value={isSavedPin(value) ? '' : (value ?? '')}
      onValueChange={(typed) => {
        const digits = typed.replace(/\D/g, '').slice(0, 12);
        onChange(digits || saved);
      }}
    />
  );
}

export function ProfileList({
  rowExtra,
}: {
  rowExtra?: (profile: Profile) => React.ReactNode;
} = {}) {
  const { userData, setUserData, uuid, password } = useUserData();
  const credentials = React.useMemo(
    () => (uuid ? { uuid, password } : null),
    [uuid, password]
  );
  const trackerQuery = useQuery(watchStateTrackersQuery(credentials));
  const trackerSync =
    !trackerQuery.data || trackerQuery.data.push || trackerQuery.data.pull;
  const trackerOptions = trackerQuery.data?.available ?? NO_TRACKER_OPTIONS;
  const trackersLoading = !!credentials && trackerQuery.isPending;
  const { status } = useStatus();
  const maxProfiles =
    status?.settings?.jellyfin?.maxProfiles ?? DEFAULT_MAX_PROFILES;
  const maxTrackers = status?.settings?.jellyfin?.maxTrackers;
  const pinSignIn = status?.settings?.jellyfin?.pinSignIn ?? false;
  const baseUrl = status?.settings?.baseUrl || window.location.origin;
  const [owner, ...others] = profilesOf(userData);
  const variants: VariantOptionList = (userData.variants ?? [])
    .filter((v) => v.enabled !== false)
    .map((v) => ({
      id: v.id,
      name: v.name,
      enabled: v.enabled,
      when: v.when ? String(v.when) : undefined,
    }));
  // Its id is '' for the owner and null for a profile not added yet.
  const [draft, setDraft] = useState<{
    id: string | null;
    value: Profile;
  } | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<number | null>(null);
  const label = (profile: Profile) => profileLabel(userData, profile);

  const shared = new Set(
    trackerOptions.filter((o) => o.viewers).map((o) => o.presetId)
  );

  // Presets inherited from a parent config are only known from the server's list.
  const knownTrackers = trackersLoading
    ? null
    : new Set([
        ...userData.presets.map((p) => p.instanceId),
        ...trackerOptions.map((o) => o.presetId),
      ]);
  /** Picks of removed addons sync with nothing; a save drops them. */
  const live = (ids: string[]) =>
    knownTrackers ? ids.filter((id) => knownTrackers.has(id)) : ids;

  /** Other profiles' trackers; `automatic` adds an automatic owner's. */
  const takenFor = (id: string | null, automatic: boolean) => {
    const taken = new Map<string, string>();
    if (id !== '') {
      const held = owner.trackers
        ? owner.trackers
        : automatic
          ? trackerOptions.filter((o) => o.user === '').map((o) => o.presetId)
          : [];
      for (const preset of held)
        if (!shared.has(preset)) taken.set(preset, label(owner));
    }
    for (const profile of others) {
      if (profile.id === id || profile.history === 'shared') continue;
      for (const preset of profile.trackers ?? [])
        if (!shared.has(preset) && !taken.has(preset))
          taken.set(preset, label(profile));
    }
    return taken;
  };

  const choicesFor = (user: string, taken: Map<string, string>) => {
    const own = trackerOptions.filter((o) => o.user === user);
    // A profile not saved yet can pick what the owner can.
    const options = own.length
      ? own
      : trackerOptions.filter((o) => o.user === '');
    return options.map((o) => ({ ...o, takenBy: taken.get(o.presetId) }));
  };

  const addonName = (presetId: string) =>
    trackerOptions.find((o) => o.presetId === presetId)?.addon ?? presetId;

  const write = (next: Profile[]) =>
    setUserData((prev) => ({ ...prev, profiles: stored(next) }));

  const rows = useSortableRows(others, (next) => write([owner, ...next]));

  const openAdd = () => {
    if (others.length >= maxProfiles) {
      toast.error(`At most ${maxProfiles} profiles besides the owner.`);
      return;
    }
    setDraft({ id: null, value: { id: '', name: '' } });
  };

  const openEdit = (profile: Profile) =>
    setDraft({
      id: profile.id,
      value: {
        ...profile,
        address: isOwner(profile)
          ? undefined
          : profile.hidden
            ? (profile.address ?? newAddress())
            : undefined,
      },
    });

  const commit = () => {
    if (!draft) return;
    const editingOwner = draft.id === '';
    const value = draft.value;
    const name = value.name?.trim() ?? '';
    if (!editingOwner && !name) {
      toast.error('A profile needs a name.');
      return;
    }
    if (UUID_SHAPE.test(name)) {
      toast.error('A name cannot look like a configuration id.');
      return;
    }
    if (
      name &&
      [owner, ...others].some(
        (p) => p.id !== draft.id && sameName(label(p), name)
      )
    ) {
      toast.error('Another profile already has this name.');
      return;
    }
    const known = new Set(variants.map((v) => v.id));
    if ((value.variants ?? []).some((id) => !known.has(id))) {
      toast.error('A linked variant no longer exists or is disabled.');
      return;
    }
    if (value.lock && !isSavedPin(value.lock) && !PIN_SHAPE.test(value.lock)) {
      toast.error('A PIN is 4 to 12 digits.');
      return;
    }
    if (
      pinSignIn &&
      !editingOwner &&
      value.lock &&
      !isSavedPin(value.lock) &&
      !PIN_ONLY_SHAPE.test(value.lock)
    ) {
      toast.warning(
        `A PIN under ${PIN_ONLY_LENGTH} digits cannot sign in without your password.`
      );
    }
    const trackers = value.history === 'shared' ? undefined : value.trackers;
    const taken = takenFor(draft.id, false);
    const clash = trackers?.find((id) => taken.has(id));
    if (clash) {
      toast.error(
        `${taken.get(clash)} already syncs with ${addonName(clash)}.`
      );
      return;
    }
    if (
      editingOwner &&
      !trackers &&
      others.some(
        (p) =>
          p.history !== 'shared' && p.trackers?.some((id) => !shared.has(id))
      )
    ) {
      toast.warning(
        'Trackers picked for other profiles stay unused while the owner syncs with every tracker.'
      );
    }
    const next: Profile = {
      id: editingOwner ? '' : draft.id || idFor(name, others),
      name: name || undefined,
      avatar: value.avatar?.trim() || undefined,
      variants: value.variants?.length ? value.variants : undefined,
      trackers,
      hidden: value.hidden || undefined,
      lock: value.lock || undefined,
      ...(editingOwner
        ? {}
        : {
            history: value.history === 'shared' ? 'shared' : undefined,
            address: value.hidden ? (value.address ?? newAddress()) : undefined,
          }),
    };
    if (editingOwner) write([next, ...others]);
    else if (draft.id === null) write([owner, ...others, next]);
    else write([owner, ...others.map((p) => (p.id === draft.id ? next : p))]);
    setDraft(null);
  };

  const remove = (index: number) => {
    const { id } = others[index];
    setUserData((prev) => releaseOwnVariant(prev, id));
    rows.removeAt(index);
    toast.info('Removed. A profile with the same name gets its history back.');
  };

  const removalTarget =
    pendingRemoval !== null ? others[pendingRemoval] : undefined;
  const removesVariant =
    !!removalTarget?.variants?.includes(removalTarget.id) &&
    !!userData.variants?.some((v) => v.id === removalTarget.id);
  const removeDialog = useConfirmationDialog({
    title: 'Remove profile',
    description: removalTarget
      ? `${label(removalTarget)} will stop appearing on the sign-in picker once you save. ${
          removalTarget.history === 'shared'
            ? 'It shares the owner’s history, so nothing is lost.'
            : 'Its watch history is kept, and a profile added again under the same name gets it back.'
        }${removesVariant ? ' The variant holding its own choices is removed too, unless another profile or variant uses it.' : ''}`
      : undefined,
    actionText: 'Remove',
    onConfirm: () => {
      if (pendingRemoval !== null) remove(pendingRemoval);
      setPendingRemoval(null);
    },
  });

  const summaryOf = (profile: Profile) =>
    (isOwner(profile)
      ? [
          'Owner',
          variantsLabel(profile.variants),
          profile.trackers
            ? trackersLabel(live(profile.trackers))
            : 'all trackers',
          profile.hidden ? 'hidden from the picker' : null,
          profile.lock ? 'PIN' : null,
        ]
      : [
          variantsLabel(profile.variants),
          profile.history === 'shared'
            ? "shares the owner's history"
            : 'own history',
          profile.history !== 'shared' && profile.trackers
            ? trackersLabel(live(profile.trackers))
            : null,
          profile.history !== 'shared' &&
          profile.id !== slugOf(profile.name ?? '')
            ? `tracker id ${profile.id}`
            : null,
          profile.hidden ? 'kept separate' : null,
          profile.lock ? 'PIN' : null,
        ]
    )
      .filter(Boolean)
      .join(' · ');

  const editingOwner = draft?.id === '';
  const value = draft?.value;
  const set = (patch: Partial<Profile>) =>
    setDraft((d) => d && { ...d, value: { ...d.value, ...patch } });

  return (
    <div className="space-y-3">
      <DndContext {...rows.dndProps}>
        <ul className="divide-y divide-gray-800 rounded-md border border-gray-800">
          <li>
            <UserRow
              name={label(owner)}
              avatar={owner.avatar}
              summary={summaryOf(owner)}
              extra={rowExtra?.(owner)}
              onEdit={() => openEdit(owner)}
            />
          </li>
          <SortableContext
            items={rows.sortableIds}
            strategy={verticalListSortingStrategy}
          >
            {others.map((profile, index) => (
              <SortableUserRow
                key={rows.keyAt(index)}
                id={rows.keyAt(index)}
                name={label(profile)}
                avatar={profile.avatar}
                summary={summaryOf(profile)}
                extra={rowExtra?.(profile)}
                onEdit={() => openEdit(profile)}
                onDelete={() => {
                  setPendingRemoval(index);
                  removeDialog.open();
                }}
              />
            ))}
          </SortableContext>
        </ul>
      </DndContext>

      <div className="flex flex-wrap items-center gap-3">
        {maxProfiles > 0 ? (
          <Button
            size="sm"
            intent="white"
            rounded
            leftIcon={<FiPlus />}
            onClick={openAdd}
            disabled={others.length >= maxProfiles}
          >
            Add profile
          </Button>
        ) : (
          <span className="text-xs text-[--muted]">
            This instance does not allow more profiles.
          </span>
        )}
        {others.length > 0 && (
          <span className="text-xs text-[--muted]">
            {others.length} of {maxProfiles}
          </span>
        )}
      </div>

      {draft && value && (
        <Modal
          open
          onOpenChange={() => setDraft(null)}
          title={editingOwner ? 'Owner' : 'Profile'}
        >
          <div className="space-y-4">
            <TextInput
              label="Name"
              help={
                editingOwner
                  ? 'Shown in apps. Defaults to your addon name.'
                  : 'Shown in apps, and typed to sign in.'
              }
              placeholder={editingOwner ? userData.addonName || 'Owner' : ''}
              value={value.name ?? ''}
              onValueChange={(name) => set({ name })}
            />

            {!editingOwner && (
              <Select
                label="History"
                help="Own: a separate Continue Watching. Shared: the owner's."
                moreHelp="Sharing the owner's history means sharing its trackers and app settings too. With its own history, a profile syncs with the trackers chosen for it."
                value={value.history ?? 'own'}
                onValueChange={(history) =>
                  set({
                    history: history as Profile['history'],
                    trackers: history === 'shared' ? undefined : value.trackers,
                  })
                }
                options={[
                  { label: 'Own', value: 'own' },
                  { label: 'Shared with the owner', value: 'shared' },
                ]}
              />
            )}

            <VariantsField
              variants={variants}
              value={value.variants ?? []}
              onChange={(list) =>
                set({ variants: list.length ? list : undefined })
              }
            />

            {trackerSync && value.history !== 'shared' && (
              <TrackersField
                choices={choicesFor(
                  editingOwner ? '' : (draft.id ?? ''),
                  takenFor(draft.id, true)
                )}
                value={value.trackers && live(value.trackers)}
                onChange={(trackers) => set({ trackers })}
                automatic={
                  editingOwner
                    ? 'Syncs with every tracker addon.'
                    : 'Syncs with a tracker addon its variants add, and with any that keeps each profile apart.'
                }
                note={
                  editingOwner || owner.trackers
                    ? undefined
                    : 'The owner syncs with every tracker. Choose its trackers to free the rest.'
                }
                loading={trackersLoading}
                maxTrackers={maxTrackers}
              />
            )}

            <TextInput
              label="Avatar URL"
              help="Optional. Shown on the sign-in picker."
              placeholder="https://"
              value={value.avatar ?? ''}
              onValueChange={(avatar) => set({ avatar: avatar || undefined })}
            />

            {editingOwner ? (
              <Switch
                label="Hide from the sign-in picker"
                help="Still signs in by name. Other profiles can't switch to it."
                side="right"
                value={value.hidden ?? false}
                onValueChange={(hidden) => set({ hidden: hidden || undefined })}
              />
            ) : (
              <>
                <Switch
                  label="Keep separate from other profiles"
                  help="Left off the sign-in picker and other profiles' lists, and sees no one else. Signs in on an address of its own."
                  side="right"
                  value={value.hidden ?? false}
                  onValueChange={(hidden) =>
                    set({
                      hidden: hidden || undefined,
                      address: hidden ? newAddress() : undefined,
                    })
                  }
                />
                {value.hidden && value.address && (
                  <PersonalAddress
                    url={`${baseUrl}/jellyfin/p/${value.address}`}
                    pinSignIn={pinSignIn}
                    onRenew={() => set({ address: newAddress() })}
                  />
                )}
              </>
            )}

            <PinField
              value={value.lock}
              onChange={(lock) => set({ lock })}
              help={
                editingOwner
                  ? 'Needed every time someone signs in as the owner, even with your configuration password (typed after it as password/PIN), and asked whenever someone switches to it in the app, so other profiles can’t reach your history or settings. Anyone who can edit this configuration can still change or remove it.'
                  : pinSignIn
                    ? `Signing in as this profile needs it, typed after the password as password/PIN. On the sign-in picker or the profile's own address, a PIN of ${PIN_ONLY_LENGTH} or more digits also works on its own, without your configuration password. Anyone who can edit this configuration can still change or remove it.`
                    : 'Signing in as this profile needs it, typed after the password as password/PIN. Anyone who can edit this configuration can still change or remove it.'
              }
            />

            <div className="flex items-center justify-end gap-2">
              <Button
                size="sm"
                intent="primary-subtle"
                onClick={() => setDraft(null)}
              >
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
