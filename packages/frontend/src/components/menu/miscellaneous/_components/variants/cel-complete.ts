import {
  autocompletion,
  Completion,
  CompletionContext,
  CompletionResult,
} from '@codemirror/autocomplete';
import { UserData } from '@aiostreams/core';
import { FIELD_META } from '../../../../../../../core/src/utils/fieldMeta';
import { DENIED_ROOT_KEYS } from '../../../../../../../core/src/variants/language';

const VERBS: Completion[] = [
  { label: 'set', type: 'keyword', detail: 'set <path> = <value>' },
  { label: 'merge', type: 'keyword', detail: 'merge <path> = { ... }' },
  { label: 'unset', type: 'keyword', detail: 'unset <path>' },
  { label: 'clear', type: 'keyword', detail: 'clear <path>' },
  { label: 'add', type: 'keyword', detail: 'add <path> <value>, ...' },
  { label: 'prepend', type: 'keyword', detail: 'prepend <path> <value>, ...' },
  { label: 'remove', type: 'keyword', detail: 'remove <path> [<value>, ...]' },
  { label: 'enable', type: 'keyword', detail: 'enable <path>' },
  { label: 'disable', type: 'keyword', detail: 'disable <path>' },
  {
    label: 'use formatter ',
    type: 'keyword',
    detail: 'apply a saved formatter',
  },
  { label: 'use variant ', type: 'keyword', detail: 'apply another variant' },
];

/** A config root may only appear as the first token after a verb. */
const ROOT_POSITION =
  /^\s*(set|merge|unset|clear|add|prepend|remove|enable|disable)\s+\w*$/;

const ROOTS: Completion[] = Object.entries(FIELD_META)
  .filter(([key]) => !DENIED_ROOT_KEYS.has(key))
  .map(([key, meta]) => ({
    label: key,
    type: meta.type === 'list' ? 'property' : 'variable',
    detail: meta.label,
  }));

export interface CelCompletionContext {
  userData: UserData;
  /** Id of the variant being edited, so it cannot reference itself. */
  currentVariantId: string;
}

/** Selector values are drawn from the live config, so they are always real. */
export function celCompletion({
  userData,
  currentVariantId,
}: CelCompletionContext) {
  return autocompletion({
    override: [
      (context: CompletionContext): CompletionResult | null => {
        const line = context.state.doc.lineAt(context.pos);
        const before = context.state.sliceDoc(line.from, context.pos);

        const savedFormatter = /use\s+formatter\s+"?([\w\s-]*)$/.exec(before);
        if (savedFormatter) {
          const names = Object.keys(
            userData.formatter?.definitions?.saved ?? {}
          );
          return {
            from: context.pos - savedFormatter[1].length,
            options: names.map((name) => ({
              label: name,
              type: 'text',
              detail: 'saved formatter',
            })),
            validFor: /^[\w\s-]*$/,
          };
        }

        const variantRef = /use\s+variant\s+"?([\w-]*)$/.exec(before);
        if (variantRef) {
          return {
            from: context.pos - variantRef[1].length,
            options: (userData.variants ?? [])
              .filter((variant) => variant.id !== currentVariantId)
              .map((variant) => ({
                label: variant.id,
                type: 'text',
                detail: variant.name ?? 'variant',
              })),
            validFor: /^[\w-]*$/,
          };
        }

        const presetRef = /presets\[instanceId\s*!?\*?=\s*"?([\w-]*)$/.exec(
          before
        );
        if (presetRef) {
          return {
            from: context.pos - presetRef[1].length,
            options: (userData.presets ?? []).map((preset) => ({
              label: preset.instanceId,
              type: 'text',
              detail:
                (preset.options?.name as string | undefined) ?? preset.type,
            })),
            validFor: /^[\w-]*$/,
          };
        }

        const presetType = /presets\[type\s*!?\*?=\s*"?([\w-]*)$/.exec(before);
        if (presetType) {
          const types = [
            ...new Set((userData.presets ?? []).map((p) => p.type)),
          ];
          return {
            from: context.pos - presetType[1].length,
            options: types.map((type) => ({
              label: type,
              type: 'text',
              detail: 'addon type',
            })),
            validFor: /^[\w-]*$/,
          };
        }

        const serviceRef = /services\[id\s*!?\*?=\s*"?([\w-]*)$/.exec(before);
        if (serviceRef) {
          return {
            from: context.pos - serviceRef[1].length,
            options: (userData.services ?? []).map((service) => ({
              label: service.id,
              type: 'text',
              detail: 'service',
            })),
            validFor: /^[\w-]*$/,
          };
        }

        const word = context.matchBefore(/[\w]*/);
        if (!word || (word.from === word.to && !context.explicit)) return null;

        // Past the root the user is inside a field's own shape, which has no
        // registry to complete from.
        if (/^\s*\w*$/.test(before)) {
          return { from: word.from, options: VERBS, validFor: /^\w*$/ };
        }
        if (ROOT_POSITION.test(before)) {
          return { from: word.from, options: ROOTS, validFor: /^\w*$/ };
        }
        return null;
      },
    ],
  });
}
