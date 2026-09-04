import React, { useEffect, useMemo, useState } from 'react';
import { useUserData } from '@/context/userData';
import { useStatus } from '@/context/status';
import { SettingsCard } from '../../../../shared/settings-card';
import { Button, IconButton } from '@/components/ui/button';
import { TextInput } from '@/components/ui/text-input';
import { Switch } from '@/components/ui/switch';
import { Alert } from '@/components/ui/alert';
import { Modal } from '@/components/ui/modal';
import { UserDataDiffViewer } from '@/components/shared/userdata-diff-viewer';
import { toast } from 'sonner';
import { FiEye, FiPlus, FiTrash2 } from 'react-icons/fi';
import type { UserData } from '@aiostreams/core';
import {
  applyCelProgram,
  parseCelScript,
  type CelLimits,
} from '../../../../../../../core/src/variants/language';
import { CelEditor } from './cel-editor';
import { ConditionTester } from './condition-tester';

type Variant = NonNullable<UserData['variants']>[number];

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;

const CONDITION_HELP =
  'Optional. A true/false expression that makes this variant apply on its own, without ?v= in the URL. ' +
  'Available: userAgent, resource, type, id, query(\'name\'), header(\'name\'), health(\'id\'), ' +
  'includes(a, b) and matches(value, \'regex\'). Selecting the variant in the URL still applies it either way.';

function nextVariantId(existing: Variant[]): string {
  if (!existing.some((v) => v.id === 'variant')) return 'variant';
  for (let i = 2; ; i++) {
    const candidate = `variant-${i}`;
    if (!existing.some((v) => v.id === candidate)) return candidate;
  }
}

export function Variants() {
  const { userData, setUserData } = useUserData();
  const { status } = useStatus();
  const [previewFor, setPreviewFor] = useState<string | null>(null);

  const settings = status?.settings.variants;
  const limits: CelLimits = useMemo(
    () => ({
      maxScriptLength: settings?.maxScriptLength ?? 4000,
      maxInstructions: settings?.maxInstructions ?? 100,
      maxValueDepth: settings?.maxValueDepth ?? 10,
      maxPathSegments: settings?.maxPathSegments ?? 12,
      maxPathMatches: settings?.maxPathMatches ?? 200,
    }),
    [settings]
  );

  const variants = userData.variants ?? [];
  const maxVariants = settings?.max ?? 10;

  const updateVariants = (next: Variant[]) =>
    setUserData((prev) => ({ ...prev, variants: next }));

  const patchVariant = (index: number, patch: Partial<Variant>) =>
    updateVariants(
      variants.map((variant, i) =>
        i === index ? { ...variant, ...patch } : variant
      )
    );

  const addVariant = () => {
    if (variants.length >= maxVariants) {
      toast.error(`This instance allows at most ${maxVariants} variants.`);
      return;
    }
    updateVariants([...variants, { id: nextVariantId(variants), script: '' }]);
  };

  if (settings?.access === 'none') {
    return (
      <Alert
        intent="info-basic"
        title="Variants are disabled"
        description="This instance has turned off config variants."
      />
    );
  }

  if (settings?.access === 'trusted' && !userData.trusted) {
    return (
      <Alert
        intent="info-basic"
        title="Variants are limited to trusted users"
        description="This instance only lets trusted users define config variants. Ask the instance owner to add you."
      />
    );
  }

  return (
    <div className="space-y-4" id="variants">
      <div className="space-y-3">
        <p className="text-sm text-[--muted]">
          A variant is a named set of instructions that adjusts this
          configuration on the fly. Install one by adding{' '}
          <code className="text-xs px-1 py-0.5 rounded bg-[--subtle]">
            ?v=&lt;id&gt;
          </code>{' '}
          to your manifest URL and your client treats it as a separate addon.
          Use it for a second formatter, a different debrid account, or a
          tighter filter set without maintaining a second config.{' '}
          <a
            href="https://docs.aiostreams.viren070.me/reference/config-expressions"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            Language reference
          </a>
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            intent="white"
            rounded
            leftIcon={<FiPlus />}
            onClick={addVariant}
            disabled={variants.length >= maxVariants}
          >
            Add variant
          </Button>
          <span className="text-xs text-[--muted]">
            {variants.length} of {maxVariants} used
          </span>
        </div>
      </div>

      {variants.map((variant, index) => (
        <VariantCard
          key={index}
          variant={variant}
          variants={variants}
          userData={userData}
          limits={limits}
          onChange={(patch) => patchVariant(index, patch)}
          onDelete={() =>
            updateVariants(variants.filter((_, i) => i !== index))
          }
          onPreview={() => setPreviewFor(variant.id)}
        />
      ))}

      {variants.length === 0 && (
        <Alert
          intent="info-basic"
          title="No variants yet"
          description="Add one to serve a second, adjusted version of this configuration from the same UUID."
        />
      )}

      {variants.length > 0 && (
        <ConditionTester variants={variants} healthChecks={userData.healthChecks} />
      )}

      <PreviewModal
        variantId={previewFor}
        variants={variants}
        userData={userData}
        limits={limits}
        onClose={() => setPreviewFor(null)}
      />
    </div>
  );
}

interface VariantCardProps {
  variant: Variant;
  variants: Variant[];
  userData: UserData;
  limits: CelLimits;
  onChange: (patch: Partial<Variant>) => void;
  onDelete: () => void;
  onPreview: () => void;
}

function VariantCard({
  variant,
  variants,
  userData,
  limits,
  onChange,
  onDelete,
  onPreview,
}: VariantCardProps) {
  const diagnostics = useMemo(
    () => parseCelScript(variant.script, limits).diagnostics,
    [variant.script, limits]
  );
  const errors = diagnostics.filter((d) => d.severity === 'error');

  const idIssue = !ID_PATTERN.test(variant.id)
    ? 'Use 1-32 characters: lowercase letters, digits, "-" or "_".'
    : variants.filter((v) => v.id === variant.id).length > 1
      ? 'Another variant already uses this id.'
      : undefined;

  return (
    <SettingsCard
      title={variant.name || variant.id}
      action={
        <div className="flex items-center gap-2">
          <Switch
            label="Enabled"
            side="right"
            value={variant.enabled !== false}
            onValueChange={(value) => onChange({ enabled: value })}
          />
          <IconButton
            size="sm"
            intent="gray-subtle"
            icon={<FiEye />}
            onClick={onPreview}
          />
          <IconButton
            size="sm"
            intent="alert-subtle"
            icon={<FiTrash2 />}
            onClick={onDelete}
          />
        </div>
      }
    >
      <div className="grid gap-3 md:grid-cols-2">
        <TextInput
          label="Id"
          help="Used in the install URL as ?v=<id>. Changing it breaks existing installs."
          value={variant.id}
          error={idIssue}
          onValueChange={(value) => onChange({ id: value.toLowerCase() })}
        />
        <TextInput
          label="Name"
          help='A label for this list and the install page. To rename the addon in your client, write set addonName = "..." below.'
          value={variant.name ?? ''}
          onValueChange={(value) => onChange({ name: value || undefined })}
        />
      </div>

      <TextInput
        label="Activate when"
        help={CONDITION_HELP}
        placeholder="includes(userAgent, 'android')"
        value={variant.when ?? ''}
        onValueChange={(value) => onChange({ when: value || undefined })}
      />

      <CelEditor
        value={variant.script}
        onValueChange={(script) => onChange({ script })}
        limits={limits}
        userData={userData}
        currentVariantId={variant.id}
        placeholder={`# Example: set formatter.id = 'prism' to switch to the built-in Prism formatter.`}
      />

      <div className="flex items-center justify-between text-xs text-[--muted]">
        <span>
          {variant.script.length} / {limits.maxScriptLength} characters
        </span>
        <span className={errors.length ? 'text-[--red]' : undefined}>
          {errors.length
            ? `${errors.length} error${errors.length === 1 ? '' : 's'}`
            : 'No errors'}
        </span>
      </div>
    </SettingsCard>
  );
}

interface PreviewModalProps {
  variantId: string | null;
  variants: Variant[];
  userData: UserData;
  limits: CelLimits;
  onClose: () => void;
}

/** Applies the script to the draft config and diffs the result. */
function PreviewModal({
  variantId,
  variants,
  userData,
  limits,
  onClose,
}: PreviewModalProps) {
  // Held past close so the content stays put while the modal animates out,
  // rather than diffing against nothing and flashing every field as removed.
  const [variant, setVariant] = useState<Variant | null>(null);
  useEffect(() => {
    const found = variants.find((v) => v.id === variantId);
    if (found) setVariant(found);
  }, [variantId, variants]);

  const result = useMemo(() => {
    if (!variant) return null;
    const { program, diagnostics } = parseCelScript(variant.script, limits);
    const errors = diagnostics.filter((d) => d.severity === 'error');
    if (errors.length) return { errors, notes: [], patched: null };
    const programs = new Map(
      variants.map((v) => [v.id, parseCelScript(v.script, limits).program])
    );
    const applied = applyCelProgram(userData, program, {
      resolveVariant: (id) => programs.get(id),
      limits,
    });
    return { errors: [], notes: applied.notes, patched: applied.userData };
  }, [variant, variants, userData, limits]);

  return (
    <Modal
      open={variantId !== null}
      onOpenChange={(open) => !open && onClose()}
      title={`Preview: ${variant?.name || variant?.id || ''}`}
      contentClass="max-w-4xl"
    >
      {result?.errors.length ? (
        <Alert
          intent="alert"
          title="This script does not parse"
          description={result.errors
            .map((error) => `Line ${error.line}: ${error.message}`)
            .join('\n')}
        />
      ) : (
        <div className="space-y-3">
          {result?.notes.length ? (
            <Alert
              intent="warning"
              title="Some instructions matched nothing"
              description={result.notes
                .map((note) => `Line ${note.line}: ${note.message}`)
                .join('\n')}
            />
          ) : null}
          <UserDataDiffViewer
            oldConfig={userData}
            newConfig={result?.patched ?? null}
          />
        </div>
      )}
    </Modal>
  );
}
