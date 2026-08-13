import type { UserData } from '@aiostreams/core';

/**
 * Fields that are not settings, so a template cannot meaningfully set them and
 * an update must never offer a choice about them. Identity and server state:
 * `trusted` is written server-side from the uuid, so prompting about it would
 * offer a decision the user does not get to make. `appliedTemplates` and
 * `variants` are this feature's own bookkeeping and the user's saved variants.
 */
const NOT_A_SETTING = new Set([
  'uuid',
  'encryptedPassword',
  'ip',
  'trusted',
  'parentConfig',
  'appliedTemplates',
  'variants',
]);

/** A field both the user and a template update have changed. */
export interface TemplateUpdateConflict {
  field: string;
  mine: unknown;
  theirs: unknown;
}

/**
 * Normalises a value for comparison. Presets carry an instanceId that identifies
 * them, so they compare on that rather than on position. Credentials are
 * dropped: they are the user's, never the template's, and must not be compared.
 */
function comparable(field: string, value: unknown): string {
  if (field === 'presets' && Array.isArray(value)) {
    const byInstance = [...value]
      .map((preset: any) => ({ ...preset }))
      .sort((a, b) =>
        String(a?.instanceId).localeCompare(String(b?.instanceId))
      );
    return JSON.stringify(byInstance);
  }
  if (field === 'services' && Array.isArray(value)) {
    return JSON.stringify(
      value.map((service: any) => ({ ...service, credentials: undefined }))
    );
  }
  return JSON.stringify(value ?? null);
}

/**
 * Works out which settings a template update would take away from the user.
 *
 * base is the template's config as it was applied. Comparing against it is what
 * separates "the user chose this" from "the template set it", so no setting has
 * to record where it came from.
 *
 * The fields considered are the ones the incoming template actually sets, which
 * is by construction everything a template can affect — there is no list to keep
 * in step with the schema, and a field added upstream is covered the day a
 * template starts setting it.
 *
 * A field is a conflict only when both sides moved it and they disagree. A field
 * the user never touched applies silently: an update that changes forty settings
 * the user has no opinion about should ask about none of them.
 *
 * With no base — anyone who applied a template before it was stored — every
 * field the update would change counts. Noisy once, and correct: assuming the
 * user changed nothing is how their settings get overwritten.
 */
export interface TemplateUpdatePlan {
  /** Fields the update itself changes. Everything else is left as it is. */
  changed: string[];
  /** Of those, the ones the user has also changed and would lose. */
  conflicts: TemplateUpdateConflict[];
}

/**
 * Works out what a template update actually changes, and which of those the
 * user would lose.
 *
 * base is the template's config as it was applied, so comparing against it
 * separates "the user chose this" from "the template set it" without any field
 * having to record where it came from.
 *
 * Only fields the update moves are applied at all. A field the template still
 * sets at the value it always set is not a change, so it neither prompts nor
 * overwrites — without that, re-applying a template would quietly reset every
 * customisation the user had made to settings the update never touched.
 *
 * With no base — a first apply, or a template applied before the snapshot
 * existed — everything the template sets is treated as changed, which is the
 * behaviour that has always applied.
 */
export function planTemplateUpdate(
  base: Partial<UserData> | undefined,
  mine: Partial<UserData>,
  theirs: Partial<UserData>
): TemplateUpdatePlan {
  const changed: string[] = [];
  const conflicts: TemplateUpdateConflict[] = [];

  for (const field of Object.keys(theirs)) {
    if (NOT_A_SETTING.has(field)) continue;
    const ours = (mine as any)?.[field];
    const incoming = (theirs as any)[field];

    if (base) {
      const original = (base as any)[field];
      // The update leaves this field where it was, so it is not part of the
      // update at all.
      if (comparable(field, original) === comparable(field, incoming)) continue;
      changed.push(field);
      // The user never moved it, so the update simply applies.
      if (comparable(field, original) === comparable(field, ours)) continue;
    } else {
      if (comparable(field, ours) === comparable(field, incoming)) continue;
      changed.push(field);
    }

    if (comparable(field, ours) === comparable(field, incoming)) continue;
    conflicts.push({ field, mine: ours, theirs: incoming });
  }

  return { changed, conflicts };
}
