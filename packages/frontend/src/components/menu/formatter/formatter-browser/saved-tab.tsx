import React, { useEffect, useMemo, useState } from 'react';
import { Bookmark, BookmarkPlus, Check, Pencil, Trash2, X } from 'lucide-react';
import type { FormatterDefinition } from '../../../../../../core/src/utils/formatter-definitions';
import { Button, IconButton } from '../../../ui/button';
import { Popover } from '../../../ui/popover';
import { TextInput } from '../../../ui/text-input';
import { Tooltip } from '../../../ui/tooltip';
import {
  ConfirmationDialog,
  useConfirmationDialog,
} from '../../../shared/confirmation-dialog';
import { FormatterCard } from './formatter-card';
import type { CardPreview } from './use-card-previews';

export interface SavedTabProps {
  saved: Record<string, FormatterDefinition>;
  previews: Record<string, CardPreview>;
  activeName?: string;
  onSelect: (name: string) => void;
  onSaveCurrent: (name: string) => void;
  onRename: (oldName: string, newName: string) => void;
  onDelete: (name: string) => void;
}

export function SavedTab({
  saved,
  previews,
  activeName,
  onSelect,
  onSaveCurrent,
  onRename,
  onDelete,
}: SavedTabProps) {
  const names = useMemo(
    () => Object.keys(saved).sort((a, b) => a.localeCompare(b)),
    [saved]
  );

  if (names.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-gray-800 px-4 py-10 text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-gray-800/60 text-[--muted]">
          <Bookmark className="h-5 w-5" />
        </span>
        <div className="space-y-1">
          <p className="text-sm font-medium">No saved formatters yet</p>
          <p className="text-xs text-[--muted]">
            Keep a named copy of the formatter in the editor so you can switch
            back to it later.
          </p>
        </div>
        <SaveCurrentPopover
          existing={names}
          onSave={onSaveCurrent}
          intent="primary"
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex-1 min-w-[12rem] text-xs text-[--muted]">
          Saved formatters live in your config. Pick one to edit it in place.
        </p>
        <SaveCurrentPopover existing={names} onSave={onSaveCurrent} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[560px] overflow-y-auto pr-2">
        {names.map((name) => (
          <SavedCard
            key={name}
            name={name}
            existingNames={names}
            preview={previews[`saved:${name}`]}
            active={activeName === name}
            onSelect={onSelect}
            onRename={onRename}
            onDelete={onDelete}
          />
        ))}
      </div>
    </div>
  );
}

function SaveCurrentPopover({
  existing,
  onSave,
  intent = 'primary-subtle',
}: {
  existing: string[];
  onSave: (name: string) => void;
  intent?: 'primary' | 'primary-subtle';
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const trimmed = name.trim();
  const overwrites = trimmed.length > 0 && existing.includes(trimmed);

  const close = () => {
    setOpen(false);
    setName('');
  };
  const save = () => {
    if (!trimmed) return;
    onSave(trimmed);
    close();
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : close())}
      align="end"
      className="w-80"
      // the wrapper suppresses auto-focus by default; here the field should get it
      onOpenAutoFocus={() => {}}
      trigger={
        <Button
          size="sm"
          intent={intent}
          leftIcon={<BookmarkPlus className="w-4 h-4" />}
        >
          Save current formatter
        </Button>
      }
    >
      <div className="space-y-3">
        <div className="space-y-0.5">
          <p className="text-sm font-semibold">Save current formatter</p>
          <p className="text-xs text-[--muted]">
            Keeps a named copy of the templates in the editor and switches to
            it.
          </p>
        </div>
        <TextInput
          value={name}
          onValueChange={setName}
          placeholder="Name"
          className="text-sm"
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
          }}
        />
        {overwrites && (
          <p className="text-xs text-yellow-400 break-all">
            Replaces the existing &ldquo;{trimmed}&rdquo;.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button size="sm" intent="gray-outline" onClick={close}>
            Cancel
          </Button>
          <Button size="sm" intent="primary" disabled={!trimmed} onClick={save}>
            Save
          </Button>
        </div>
      </div>
    </Popover>
  );
}

function SavedCard({
  name,
  existingNames,
  preview,
  active,
  onSelect,
  onRename,
  onDelete,
}: {
  name: string;
  existingNames: string[];
  preview?: CardPreview;
  active: boolean;
  onSelect: (name: string) => void;
  onRename: (oldName: string, newName: string) => void;
  onDelete: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  useEffect(() => {
    setDraft(name);
  }, [name]);

  const deleteDialog = useConfirmationDialog({
    title: 'Delete formatter',
    description: (
      <span className="break-all">
        Are you sure you want to delete &ldquo;{name}&rdquo;?
      </span>
    ),
    actionText: 'Delete',
    actionIntent: 'alert-subtle',
    onConfirm: () => onDelete(name),
  });

  const confirmRename = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== name) {
      if (existingNames.includes(trimmed)) {
        return;
      }
      onRename(name, trimmed);
    } else {
      setDraft(name);
    }
    setEditing(false);
  };

  const cancelRename = () => {
    setDraft(name);
    setEditing(false);
  };

  const duplicate =
    editing && draft.trim() !== name && existingNames.includes(draft.trim());

  return (
    <>
      <ConfirmationDialog {...deleteDialog} />
      <FormatterCard
        title={name}
        preview={preview}
        active={active}
        header={
          editing ? (
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <TextInput
                  value={draft}
                  onValueChange={setDraft}
                  autoFocus
                  className="flex-1 min-w-0 text-sm"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') confirmRename();
                    if (e.key === 'Escape') cancelRename();
                  }}
                />
                <IconButton
                  size="sm"
                  rounded
                  intent="primary-subtle"
                  icon={<Check className="h-3.5 w-3.5" />}
                  disabled={duplicate}
                  onClick={confirmRename}
                />
                <IconButton
                  size="sm"
                  rounded
                  intent="gray-subtle"
                  icon={<X className="h-3.5 w-3.5" />}
                  onClick={cancelRename}
                />
              </div>
              {duplicate && (
                <p className="text-xs text-red-300">
                  A saved formatter with this name already exists.
                </p>
              )}
            </div>
          ) : undefined
        }
        badge={
          <span className="text-xs bg-sky-500/20 text-sky-300 px-2 py-0.5 rounded border border-sky-500/30">
            Saved
          </span>
        }
        actions={
          <>
            <Button
              size="sm"
              intent={active ? 'gray-outline' : 'primary-subtle'}
              disabled={active}
              onClick={() => onSelect(name)}
            >
              {active ? 'In use' : 'Use'}
            </Button>
            <div className="ml-auto flex items-center gap-1">
              <Tooltip
                trigger={
                  <IconButton
                    size="sm"
                    rounded
                    intent="gray-subtle"
                    icon={<Pencil className="h-3.5 w-3.5" />}
                    onClick={() => setEditing(true)}
                  />
                }
              >
                Rename
              </Tooltip>
              <Tooltip
                trigger={
                  <IconButton
                    size="sm"
                    rounded
                    intent="alert-subtle"
                    icon={<Trash2 className="h-3.5 w-3.5" />}
                    onClick={deleteDialog.open}
                  />
                }
              >
                Delete
              </Tooltip>
            </div>
          </>
        }
      />
    </>
  );
}
