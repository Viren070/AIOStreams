import type { CommunityItemMine, Template } from '@aiostreams/core';
import {
  submitCommunityTemplate,
  updateCommunityItem,
  type Credentials,
} from '@/lib/api';
import {
  bumpPatch,
  compareVersions,
} from '../../../../core/src/community/version';

/** Every share path shows this; the server stores exactly what it is sent. */
export const SHARE_TEMPLATE_CONFIRMATION = {
  title: 'Share this template?',
  description:
    'It is uploaded exactly as it is: nothing is checked, rewritten or removed on the server. Service credentials, API keys and addon passwords are replaced with placeholders when a template is built from your configuration, but variant scripts, addon URLs, regex patterns and other free text are included as written. Check them for keys, tokens or personal details before sharing.',
  actionText: 'I checked, share it',
  actionIntent: 'primary' as const,
};

/** The user's own community template with this name, if any. */
export function findOwnTemplate(
  mine: CommunityItemMine[] | undefined,
  name: string
): CommunityItemMine | undefined {
  const wanted = name.trim().toLowerCase();
  return mine?.find(
    (item) => item.kind === 'template' && item.name.toLowerCase() === wanted
  );
}

/** Keeps an author-set version when it beats the published one, else the next patch. */
export function withUploadVersion(
  template: Template,
  live?: CommunityItemMine
): Template {
  if (!live) return template;
  const own = template.metadata.version;
  const version =
    own && compareVersions(own, live.version) > 0
      ? own
      : bumpPatch(live.version);
  return { ...template, metadata: { ...template.metadata, version } };
}

/**
 * Submit a template JSON as-is, or push it as an update when the user already
 * shares one with the same name. The server stores it as sent.
 */
export async function shareTemplateJson(
  credentials: Credentials,
  template: Template,
  mine: CommunityItemMine[] | undefined
): Promise<{ item: CommunityItemMine; updated: boolean }> {
  const existing = findOwnTemplate(mine, template.metadata.name);
  const payload = withUploadVersion(template, existing);
  const item = existing
    ? await updateCommunityItem(credentials, existing.id, { template: payload })
    : await submitCommunityTemplate(credentials, payload);
  return { item, updated: !!existing };
}

export function shareOutcomeMessage(
  item: CommunityItemMine,
  updated: boolean
): string {
  if (item.draft) return 'Update submitted for review';
  if (item.status === 'pending') return 'Submitted for review';
  return updated ? 'Update published' : 'Shared with the community';
}

/** Open a file picker for a `.json` file; resolves null when cancelled. */
export function pickJsonFile(): Promise<unknown | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try {
        resolve(JSON.parse(await file.text()));
      } catch (err) {
        reject(new Error('That file is not valid JSON'));
      }
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export function looksLikeTemplate(value: unknown): value is Template {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as Template).metadata === 'object' &&
    typeof (value as Template).config === 'object'
  );
}
