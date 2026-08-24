import React from 'react';
import { LuPlus, LuX } from 'react-icons/lu';
import { IconButton } from '@/components/ui/button';
import { buildManifestUrl } from '@/lib/manifest-url';
import {
  VariantPills,
  type VariantOption,
} from '@/components/shared/variant-pills';

/** One addon to keep in sync. An empty selection is the base config. */
export type PushTarget = string[];

interface PushTargetsFieldProps {
  variants: VariantOption[];
  value: PushTarget[];
  onChange: (value: PushTarget[]) => void;
  baseUrl: string;
  uuid: string;
  encryptedPassword?: string;
  alias?: string | null;
}

export function pushTargetsToUrls(
  targets: PushTarget[],
  parts: Omit<Parameters<typeof buildManifestUrl>[0], 'variantIds'>
): string[] {
  const urls = targets.map((variantIds) =>
    buildManifestUrl({ ...parts, variantIds })
  );
  return Array.from(new Set(urls.filter(Boolean)));
}

/**
 * Each row becomes one addon in the linked account. Selecting several variants
 * in a row combines them into that one addon, matching what the install card
 * does; separate rows are separate addons.
 *
 * Always the path form: not every platform treats the query string as part of
 * an addon's identity.
 */
export function PushTargetsField({
  variants,
  value,
  onChange,
  baseUrl,
  uuid,
  encryptedPassword,
  alias,
}: PushTargetsFieldProps) {
  const usable = variants.filter((variant) => variant.enabled !== false);
  if (usable.length === 0) return null;

  const rows = value.length > 0 ? value : [[]];

  const setRow = (index: number, next: PushTarget) =>
    onChange(rows.map((row, i) => (i === index ? next : row)));

  const urls = pushTargetsToUrls(rows, {
    baseUrl,
    uuid,
    encryptedPassword,
    alias,
  });

  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm font-medium text-white">What to push</p>
        <p className="text-xs text-gray-500">
          Each row is installed as its own addon. Pick more than one variant in
          a row to combine them into a single addon.
        </p>
      </div>

      <div className="space-y-2">
        {rows.map((row, index) => (
          <div
            key={index}
            className="rounded-lg border border-gray-700 bg-gray-800/40 p-2.5"
          >
            <div className="flex items-start gap-2">
              <VariantPills
                className="flex-1"
                variants={usable}
                value={row}
                onChange={(next) => setRow(index, next)}
              />
              {rows.length > 1 && (
                <IconButton
                  intent="gray-basic"
                  size="sm"
                  aria-label="Remove"
                  icon={<LuX />}
                  onClick={() => onChange(rows.filter((_, i) => i !== index))}
                />
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => onChange([...rows, []])}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-[--brand]"
        >
          <LuPlus className="h-3 w-3" /> Add another addon
        </button>
        <span className="text-xs text-gray-500">
          {urls.length} addon{urls.length === 1 ? '' : 's'}
        </span>
      </div>
    </div>
  );
}
