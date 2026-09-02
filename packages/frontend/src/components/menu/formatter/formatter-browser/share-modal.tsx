import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CommunityItemMine } from '@aiostreams/core';
import type { FormatterDefinition } from '../../../../../../core/src/utils/formatter-definitions';
import { Modal } from '../../../ui/modal';
import { Button } from '../../../ui/button';
import { TextInput } from '../../../ui/text-input';
import { Textarea } from '../../../ui/textarea';
import { BasicField } from '../../../ui/basic-field';
import {
  submitCommunityFormatter,
  updateCommunityItem,
  type Credentials,
} from '@/lib/api';
import { COMMUNITY_QUERY_ROOT, MY_COMMUNITY_QUERY_ROOT } from '@/lib/queries';
import { bumpPatch } from '../../../../../../core/src/community/version';
import { MAX_COMMUNITY_TAGS, parseTags } from '@/lib/tags';

export interface ShareFormatterModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  credentials: Credentials;
  definition: FormatterDefinition;
  /** Present when pushing a new revision of an existing submission. */
  existing?: CommunityItemMine;
  moderated: boolean;
}

export function ShareFormatterModal({
  open,
  onOpenChange,
  credentials,
  definition,
  existing,
  moderated,
}: ShareFormatterModalProps) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [author, setAuthor] = useState('');
  const [tagsText, setTagsText] = useState('');

  useEffect(() => {
    if (!open) return;
    setName(existing?.name ?? '');
    setDescription(existing?.description ?? '');
    setAuthor(existing?.author ?? '');
    setTagsText(existing?.tags?.join(', ') ?? '');
  }, [open, existing]);

  const tags = parseTags(tagsText);

  const mutation = useMutation({
    mutationFn: () =>
      existing
        ? updateCommunityItem(credentials, existing.id, {
            name: name.trim(),
            description: description.trim(),
            author: author.trim(),
            tags,
            payload: definition,
          })
        : submitCommunityFormatter(credentials, {
            name: name.trim(),
            description: description.trim(),
            author: author.trim(),
            tags,
            payload: definition,
          }),
    onSuccess: (item) => {
      qc.invalidateQueries({ queryKey: COMMUNITY_QUERY_ROOT });
      qc.invalidateQueries({ queryKey: MY_COMMUNITY_QUERY_ROOT });
      if (item.draft) toast.success('Update submitted for review');
      else if (item.status === 'pending') toast.success('Submitted for review');
      else toast.success(existing ? 'Update published' : 'Published');
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message ?? 'Failed to share'),
  });

  const canSubmit = name.trim().length > 0 && author.trim().length > 0;
  const nextVersion = existing ? bumpPatch(existing.version) : '1.0.0';

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={existing ? 'Update shared formatter' : 'Share formatter'}
      description={
        existing
          ? `Publishes the formatter currently in the editor as v${nextVersion} of "${existing.name}".`
          : 'Publishes the formatter currently in the editor for everyone on this instance.'
      }
    >
      <div className="space-y-4">
        <BasicField label="Name">
          <TextInput
            value={name}
            onValueChange={setName}
            placeholder="A short, recognisable name"
            maxLength={100}
          />
        </BasicField>
        <BasicField
          label="Description"
          help="What makes it different, what it shows."
        >
          <Textarea
            value={description}
            onValueChange={setDescription}
            placeholder="Optional"
            maxLength={1000}
          />
        </BasicField>
        <BasicField
          label="Author"
          help="Shown on the card. Up to 20 characters."
        >
          <TextInput
            value={author}
            onValueChange={setAuthor}
            placeholder="Your name or handle"
            maxLength={20}
          />
        </BasicField>
        <BasicField
          label="Tags"
          help={`Comma separated, up to ${MAX_COMMUNITY_TAGS}. Used to filter the community list.`}
        >
          <TextInput
            value={tagsText}
            onValueChange={setTagsText}
            placeholder="minimal, emoji, anime"
          />
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="text-xs bg-gray-800 text-gray-300 px-2 py-0.5 rounded border border-gray-700"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </BasicField>
        {moderated && (
          <p className="text-xs text-[--muted]">
            This instance reviews submissions before they appear to others.
            {existing && ' The current version stays published meanwhile.'}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button
            intent="gray-outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            intent="primary"
            size="sm"
            disabled={!canSubmit}
            loading={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {existing ? `Publish v${nextVersion}` : 'Share'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
