'use client';
import React, { useMemo, useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { TextInput } from '../../ui/text-input';
import { Button, IconButton } from '../../ui/button';
import { FaRegTrashAlt } from 'react-icons/fa';
import { LuPencil, LuCheck, LuX } from 'react-icons/lu';
import { Tooltip } from '../../ui/tooltip';
import {
  ConfirmationDialog,
  useConfirmationDialog,
} from '../../shared/confirmation-dialog';

export type FormatterDefinition = {
  name: string;
  description: string;
};

export interface SavedFormattersModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canSaveCurrent: boolean;
  savedDefinitions: Record<string, FormatterDefinition>;
  onSave: (name: string) => void;
  onLoad: (name: string) => void;
  onRename: (oldName: string, newName: string) => void;
  onDelete: (name: string) => void;
}

interface SavedFormatterItemProps {
  name: string;
  onLoad: (name: string) => void;
  onRename: (oldName: string, newName: string) => void;
  onDelete: (name: string) => void;
}

function SavedFormatterItem({
  name,
  onLoad,
  onRename,
  onDelete,
}: SavedFormatterItemProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

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

  React.useEffect(() => {
    setDraft(name);
  }, [name]);

  const handleConfirm = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== name) {
      onRename(name, trimmed);
    } else {
      setDraft(name);
    }
    setEditing(false);
  };

  const handleCancel = () => {
    setDraft(name);
    setEditing(false);
  };

  return (
    <>
      <ConfirmationDialog {...deleteDialog} />
      <div className="flex items-center gap-2 overflow-hidden rounded-lg border border-gray-700 bg-gray-800/30 px-3 py-2.5 group/item">
        {editing ? (
          <>
            <TextInput
              value={draft}
              onValueChange={setDraft}
              autoFocus
              className="flex-1 min-w-0 text-sm"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleConfirm();
                if (e.key === 'Escape') handleCancel();
              }}
            />
            <div className="flex items-center gap-1 shrink-0">
              <Tooltip
                trigger={
                  <IconButton
                    size="sm"
                    rounded
                    intent="primary-subtle"
                    icon={<LuCheck className="h-3.5 w-3.5" />}
                    onClick={handleConfirm}
                  />
                }
              >
                Confirm rename
              </Tooltip>
              <Tooltip
                trigger={
                  <IconButton
                    size="sm"
                    rounded
                    intent="gray-subtle"
                    icon={<LuX className="h-3.5 w-3.5" />}
                    onClick={handleCancel}
                  />
                }
              >
                Cancel
              </Tooltip>
            </div>
          </>
        ) : (
          <>
            <div className="flex-1 min-w-0 overflow-hidden">
              <Tooltip
                trigger={
                  <span className="truncate text-sm cursor-default">
                    {name}
                  </span>
                }
              >
                {name}
              </Tooltip>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <Tooltip
                trigger={
                  <IconButton
                    size="sm"
                    rounded
                    intent="gray-subtle"
                    icon={<LuPencil className="h-3.5 w-3.5" />}
                    onClick={() => setEditing(true)}
                    className="opacity-0 group-hover/item:opacity-100 transition-opacity"
                  />
                }
              >
                Rename
              </Tooltip>
              <Button
                size="sm"
                intent="primary-subtle"
                onClick={() => onLoad(name)}
              >
                Load
              </Button>
              <Tooltip
                trigger={
                  <IconButton
                    size="sm"
                    rounded
                    intent="alert-subtle"
                    icon={<FaRegTrashAlt />}
                    onClick={deleteDialog.open}
                  />
                }
              >
                Delete
              </Tooltip>
            </div>
          </>
        )}
      </div>
    </>
  );
}

export function SavedFormattersModal({
  open,
  onOpenChange,
  canSaveCurrent,
  savedDefinitions,
  onSave,
  onLoad,
  onRename,
  onDelete,
}: SavedFormattersModalProps) {
  const [newName, setNewName] = useState('');

  const savedEntries = useMemo(
    () =>
      Object.entries(savedDefinitions).sort(([a], [b]) => a.localeCompare(b)),
    [savedDefinitions]
  );

  React.useEffect(() => {
    if (!open) setNewName('');
  }, [open]);

  const handleSave = () => {
    if (!newName.trim()) return;
    onSave(newName);
    setNewName('');
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Saved Formatters"
      description="Save your current formatter or load a previously saved one"
    >
      <div className="space-y-4 w-full min-w-0">
        <div className="rounded-lg border border-gray-700/60 bg-gray-800/20 p-3 space-y-3">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">
            Save current
          </p>
          <div className="flex gap-2">
            <TextInput
              value={newName}
              onValueChange={setNewName}
              placeholder="Name for this formatter"
              disabled={!canSaveCurrent}
              className="flex-1 text-sm"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canSaveCurrent) handleSave();
              }}
            />
            <Button
              intent="primary"
              disabled={!canSaveCurrent || !newName.trim()}
              onClick={handleSave}
              className="shrink-0"
            >
              Save
            </Button>
          </div>
          {!canSaveCurrent && (
            <p className="text-xs text-gray-500">
              Customise a built-in formatter or switch to Custom first.
            </p>
          )}
        </div>

        <div className="space-y-2 max-h-72 overflow-y-auto overflow-x-hidden -mx-1 px-1">
          {savedEntries.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">
              No saved formatters yet.
            </p>
          ) : (
            savedEntries.map(([savedName]) => (
              <SavedFormatterItem
                key={savedName}
                name={savedName}
                onLoad={onLoad}
                onRename={onRename}
                onDelete={onDelete}
              />
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}
