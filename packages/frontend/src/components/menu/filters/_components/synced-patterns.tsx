'use client';
import { useEffect, useState } from 'react';
import { useUserData } from '@/context/userData';
import { useStatus } from '@/context/status';
import { useDisclosure } from '@/hooks/disclosure';
import { resolveRegexPatterns, resolveStreamExpressions } from '@/lib/api';
import { toast } from 'sonner';
import { cn } from '../../../ui/core/styling';
import { IconButton } from '../../../ui/button';
import { Button } from '../../../ui/button';
import { TextInput } from '../../../ui/text-input';
import { NumberInput } from '../../../ui/number-input';
import { Tooltip } from '../../../ui/tooltip';
import { Modal } from '../../../ui/modal';
import { Checkbox } from '../../../ui/checkbox';
import {
  Disclosure,
  DisclosureItem,
  DisclosureTrigger,
  DisclosureContent,
} from '../../../ui/disclosure';
import {
  FaRegTrashAlt,
  FaPlus,
  FaEdit,
  FaUndo,
  FaChevronDown,
} from 'react-icons/fa';

// Helpers

/**
 * Extract names from C-style block comments in a SEL expression.
 * Names are comments that don't start with `#`.
 */
function extractNamesFromExpression(expression: string): string[] | undefined {
  const regex = /\/\*\s*(.*?)\s*\*\//g;
  const names: string[] = [];
  let match;
  while ((match = regex.exec(expression)) !== null) {
    const content = match[1];
    if (!content.startsWith('#')) {
      names.push(content);
    }
  }
  return names.length > 0 ? names : undefined;
}

/**
 * Compare two string arrays for equality.
 */
function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// Types

export type SyncMode = 'regex' | 'sel';

export interface SyncConfig {
  urls: string[];
  onUrlsChange: (urls: string[]) => void;
  trusted?: boolean;
  syncMode?: SyncMode;
}

interface SyncedPatternValue {
  /** For regex patterns */
  pattern?: string;
  /** For SEL expressions */
  expression?: string;
  name?: string;
  score?: number;
  /** Predefined enabled flag from URL (for ranked SEL expressions) */
  enabled?: boolean;
}

interface SyncedPatternsProps {
  renderType: 'simple' | 'nameable' | 'ranked';
  syncMode: SyncMode;
  syncedValues: SyncedPatternValue[];
  isLoading: boolean;
  fetchError: string | null;
}

/** State for the regex override editing modal */
interface RegexEditingItemState {
  pattern: string;
  name?: string;
  score?: number;
  originalName?: string;
  disabled?: boolean;
}

/** State for the SEL score override editing modal (ranked only) */
interface SelEditingItemState {
  expression: string;
  score: number;
  exprNames?: string[];
  disabled?: boolean;
}

// SyncedPatterns

/**
 * Renders synced patterns/expressions for a single URL.
 */
export function SyncedPatterns({
  renderType,
  syncMode,
  syncedValues,
  isLoading,
  fetchError,
}: SyncedPatternsProps) {
  const { userData, setUserData } = useUserData();
  const { isOpen, open, close } = useDisclosure(false);

  const [regexEditing, setRegexEditing] =
    useState<RegexEditingItemState | null>(null);
  const [selEditing, setSelEditing] = useState<SelEditingItemState | null>(
    null
  );

  const isSel = syncMode === 'sel';
  const overrideKey = isSel ? 'selOverrides' : 'regexOverrides';
  const itemLabel = isSel ? 'Expression' : 'Pattern';

  if (isLoading) {
    return (
      <div className="px-3 pb-2 text-xs text-[--muted] animate-pulse">
        Loading {itemLabel.toLowerCase()}s...
      </div>
    );
  }

  if (fetchError && syncedValues.length === 0) {
    return (
      <div className="px-3 pb-3">
        <div className="rounded border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-400">
          <span className="font-medium">Error: </span>
          {fetchError}
        </div>
      </div>
    );
  }

  if (syncedValues.length === 0) {
    return null;
  }

  return (
    <div className="px-3 pb-3 space-y-2">
      {fetchError && (
        <div className="rounded border border-yellow-500/30 bg-yellow-500/5 p-2 text-xs text-yellow-400">
          <span className="font-medium">Warning: </span>
          {fetchError}
        </div>
      )}
      {syncedValues.map((value, index) => {
        const patternStr = value.pattern ?? value.expression ?? '';
        const overrides = (userData[overrideKey] || []) as any[];

        // For SEL items, extract names from expression comments
        const extractedNames = isSel
          ? extractNamesFromExpression(patternStr)
          : undefined;

        const matchesOverride = (o: any) => {
          if (isSel) {
            if (o.expression === patternStr) return true;
            if (o.exprNames && extractedNames) {
              return arraysEqual(o.exprNames, extractedNames);
            }
            return false;
          }
          return (
            o.pattern === patternStr ||
            (value.name && o.originalName === value.name)
          );
        };

        const override = overrides.find(matchesOverride);
        // If no override exists, respect the predefined enabled flag from the URL
        const isDisabled = override
          ? override.disabled
          : value.enabled === false;

        // For SEL: no name overrides, effectiveName is always from upstream
        // For regex: name comes from override or upstream
        const effectiveName = isSel
          ? (extractedNames?.join(', ') ?? '')
          : (override?.name ?? value.name ?? '');
        const isOverridden = isSel
          ? !!override && !override.disabled && override.score !== undefined
          : !!override && !override.disabled;
        const effectiveScore =
          override?.score !== undefined ? override.score : (value.score ?? 0);

        // Enable/Disable handler
        const handleEnabledChange = (enabled: boolean) => {
          setUserData((prev) => {
            const currentOverrides = [...((prev[overrideKey] as any[]) || [])];

            if (enabled) {
              const idx = currentOverrides.findIndex(matchesOverride);
              if (idx >= 0) {
                const existing = currentOverrides[idx];
                const hasScoreChange =
                  existing.score !== undefined &&
                  existing.score !== value.score;
                // For regex, also check name changes
                const hasNameChange =
                  !isSel &&
                  existing.name !== undefined &&
                  existing.name !== value.name;

                if (hasNameChange || hasScoreChange) {
                  currentOverrides[idx] = { ...existing, disabled: false };
                  return { ...prev, [overrideKey]: currentOverrides };
                } else {
                  // If the item comes with enabled=false from the URL, we need
                  // to keep an override with disabled=false to persist the user's
                  // choice to enable it across syncs
                  if (value.enabled === false) {
                    currentOverrides[idx] = { ...existing, disabled: false };
                    return { ...prev, [overrideKey]: currentOverrides };
                  }
                  currentOverrides.splice(idx, 1);
                  return { ...prev, [overrideKey]: currentOverrides };
                }
              }
              // No existing override but the URL has enabled=false:
              // create an override with disabled=false to persist the user's choice
              if (value.enabled === false) {
                const entry = isSel
                  ? {
                      expression: patternStr,
                      exprNames: extractedNames,
                      disabled: false,
                    }
                  : {
                      pattern: patternStr,
                      originalName: value.name,
                      disabled: false,
                    };
                currentOverrides.push(entry);
                return { ...prev, [overrideKey]: currentOverrides };
              }
              return prev;
            }

            const idx = currentOverrides.findIndex(matchesOverride);
            const existingOverride = idx >= 0 ? currentOverrides[idx] : null;

            const entry = isSel
              ? {
                  expression: patternStr,
                  score: existingOverride?.score,
                  exprNames: extractedNames,
                  disabled: true,
                }
              : {
                  pattern: patternStr,
                  name: existingOverride?.name,
                  score: existingOverride?.score,
                  originalName: value.name,
                  disabled: true,
                };

            if (idx >= 0) {
              currentOverrides[idx] = entry;
            } else {
              currentOverrides.push(entry);
            }
            return { ...prev, [overrideKey]: currentOverrides };
          });
          toast.success(
            enabled ? `${itemLabel} enabled` : `${itemLabel} disabled`
          );
        };

        // Reset handler
        const handleReset = () => {
          setUserData((prev) => ({
            ...prev,
            [overrideKey]: ((prev[overrideKey] as any[]) || []).filter(
              (o: any) => !matchesOverride(o)
            ),
          }));
          toast.info('Override removed');
        };

        return (
          <div
            key={index}
            className={cn(
              'p-2 rounded border',
              isDisabled
                ? 'opacity-50 border-gray-700/50 bg-gray-900/30'
                : 'border-gray-700 bg-gray-900/60',
              isOverridden && !isDisabled && 'border-primary/40'
            )}
          >
            {/*  Simple: checkbox + pattern/expression  */}
            {renderType === 'simple' && (
              <div className="relative flex gap-2 items-start pl-[calc(24px+0.5rem)]">
                <div className="absolute left-0 top-1/2 -translate-y-1/2 min-w-[24px] flex justify-center">
                  <Checkbox
                    value={!isDisabled}
                    size="lg"
                    onValueChange={(checked) =>
                      handleEnabledChange(checked === true)
                    }
                  />
                </div>
                <div className="flex-1">
                  <TextInput
                    value={patternStr}
                    label={`${itemLabel} (Synced)`}
                    disabled
                    size="sm"
                  />
                </div>
              </div>
            )}

            {/*  Nameable: checkbox + name + pattern + override (regex only)  */}
            {renderType === 'nameable' && (
              <div className="relative flex gap-2 items-start pl-[calc(24px+0.5rem)]">
                <div className="absolute left-0 top-1/2 -translate-y-1/2 min-w-[24px] flex justify-center">
                  <Checkbox
                    value={!isDisabled}
                    size="lg"
                    onValueChange={(checked) =>
                      handleEnabledChange(checked === true)
                    }
                  />
                </div>
                <div className="flex-none w-1/3">
                  <TextInput
                    value={effectiveName}
                    label={
                      !isSel && isOverridden
                        ? 'Name (Overridden)'
                        : 'Name (Synced)'
                    }
                    disabled
                    size="sm"
                    className={cn(isDisabled && 'line-through text-gray-500')}
                  />
                </div>
                <div className="flex-1">
                  <TextInput
                    value={patternStr}
                    label={`${itemLabel} (Synced)`}
                    disabled
                    size="sm"
                    className={cn(isDisabled && 'line-through text-gray-500')}
                  />
                </div>
                <div className="pb-0.5 flex gap-1 flex-shrink-0 self-end">
                  {isOverridden && (
                    <Tooltip
                      trigger={
                        <IconButton
                          size="sm"
                          rounded
                          icon={<FaUndo className="text-xs" />}
                          intent="alert-subtle"
                          onClick={handleReset}
                          className="h-[38px] w-[38px] border border-red-500/20 hover:border-red-500/50 transition-colors shadow-sm"
                        />
                      }
                    >
                      Reset Override
                    </Tooltip>
                  )}
                  {/* Regex: name override. SEL: no overrides for nameable. */}
                  {!isSel && (
                    <Tooltip
                      trigger={
                        <IconButton
                          size="sm"
                          rounded
                          icon={<FaEdit className="text-xs" />}
                          intent={isOverridden ? 'primary' : 'primary-subtle'}
                          onClick={() => {
                            setRegexEditing({
                              pattern: patternStr,
                              name: override?.name ?? value.name ?? '',
                              originalName: value.name,
                            });
                            open();
                          }}
                          className="h-[38px] w-[38px] border border-primary/20 hover:border-primary/50 transition-colors shadow-sm"
                        />
                      }
                    >
                      Override
                    </Tooltip>
                  )}
                </div>
              </div>
            )}

            {/*  Ranked: checkbox + pattern + name + score + override  */}
            {renderType === 'ranked' && (
              <div className="relative">
                <div className="absolute left-0 top-1/2 -translate-y-1/2 min-w-[24px] flex justify-center">
                  <Checkbox
                    value={!isDisabled}
                    size="lg"
                    onValueChange={(checked) =>
                      handleEnabledChange(checked === true)
                    }
                  />
                </div>
                <div className="flex gap-2 items-start pl-[calc(24px+0.5rem)]">
                  <div className="flex-1">
                    <TextInput
                      value={patternStr}
                      label={`${itemLabel} (Synced)`}
                      disabled
                      size="sm"
                      className={cn(isDisabled && 'line-through text-gray-500')}
                    />
                  </div>
                  <div className="pb-0.5 flex gap-1 flex-shrink-0 self-end">
                    {isOverridden && (
                      <Tooltip
                        trigger={
                          <IconButton
                            rounded
                            size="sm"
                            icon={<FaUndo className="text-xs" />}
                            intent="alert-subtle"
                            onClick={handleReset}
                          />
                        }
                      >
                        Reset Override
                      </Tooltip>
                    )}
                    <Tooltip
                      trigger={
                        <IconButton
                          size="sm"
                          rounded
                          icon={<FaEdit className="text-xs" />}
                          intent={isOverridden ? 'primary' : 'primary-subtle'}
                          onClick={() => {
                            if (isSel) {
                              setSelEditing({
                                expression: patternStr,
                                score: effectiveScore,
                                exprNames: extractedNames,
                              });
                            } else {
                              setRegexEditing({
                                pattern: patternStr,
                                name: override?.name ?? value.name ?? '',
                                score: effectiveScore,
                                originalName: value.name,
                              });
                            }
                            open();
                          }}
                        />
                      }
                    >
                      Override
                    </Tooltip>
                  </div>
                </div>
                <div className="flex gap-2 pl-[calc(24px+0.5rem)] mt-2">
                  <div className="flex-1">
                    <TextInput
                      value={effectiveName}
                      label={`Name${extractedNames && extractedNames.length > 1 ? 's' : ''} (Synced)`}
                      disabled
                      size="sm"
                      className={cn(isDisabled && 'line-through text-gray-500')}
                    />
                  </div>
                  <div className="w-24">
                    <NumberInput
                      value={effectiveScore}
                      label={isOverridden ? 'Score (Ovr)' : 'Score'}
                      disabled
                      size="sm"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/*  Regex Override Modal (name + score)  */}
      <Modal
        open={isOpen && regexEditing !== null}
        onOpenChange={(val) => {
          if (!val) {
            setRegexEditing(null);
            close();
          }
        }}
        title="Override"
      >
        <div className="space-y-4 py-2">
          <p className="text-xs text-[--muted] break-all">
            {itemLabel}:{' '}
            <code className="text-[--primary]">{regexEditing?.pattern}</code>
          </p>
          {(renderType === 'nameable' || renderType === 'ranked') && (
            <TextInput
              label="Custom Name"
              value={regexEditing?.name || ''}
              onValueChange={(name) =>
                setRegexEditing((prev) => (prev ? { ...prev, name } : null))
              }
            />
          )}
          {renderType === 'ranked' && (
            <NumberInput
              label="Custom Score"
              value={regexEditing?.score ?? 0}
              onValueChange={(score) =>
                setRegexEditing((prev) => (prev ? { ...prev, score } : null))
              }
            />
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              intent="primary-outline"
              onClick={() => {
                setRegexEditing(null);
                close();
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!regexEditing) return;
                setUserData((prev) => {
                  const overrides = [...((prev[overrideKey] as any[]) || [])];
                  const matchFn = (o: any) =>
                    o.pattern === regexEditing.pattern ||
                    (regexEditing.originalName &&
                      o.originalName === regexEditing.originalName);
                  const idx = overrides.findIndex(matchFn);
                  const existingOverride =
                    idx >= 0 ? overrides[idx] : undefined;
                  const entry = {
                    pattern: regexEditing.pattern,
                    name: regexEditing.name || undefined,
                    score: regexEditing.score,
                    originalName: regexEditing.originalName,
                    disabled:
                      regexEditing.disabled ?? existingOverride?.disabled,
                  };
                  if (idx >= 0) {
                    overrides[idx] = entry;
                  } else {
                    overrides.push(entry);
                  }
                  return { ...prev, [overrideKey]: overrides };
                });
                setRegexEditing(null);
                close();
                toast.success('Override saved');
              }}
            >
              Save Override
            </Button>
          </div>
        </div>
      </Modal>

      {/*  SEL Score Override Modal (ranked only)  */}
      <Modal
        open={isOpen && selEditing !== null}
        onOpenChange={(val) => {
          if (!val) {
            setSelEditing(null);
            close();
          }
        }}
        title="Score Override"
      >
        <div className="space-y-4 py-2">
          <p className="text-xs text-[--muted] break-all">
            Expression:{' '}
            <code className="text-[--primary]">{selEditing?.expression}</code>
          </p>
          <NumberInput
            label="Custom Score"
            value={selEditing?.score ?? 0}
            onValueChange={(score) =>
              setSelEditing((prev) => (prev ? { ...prev, score } : null))
            }
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button
              intent="primary-outline"
              onClick={() => {
                setSelEditing(null);
                close();
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!selEditing) return;
                setUserData((prev) => {
                  const overrides = [...((prev[overrideKey] as any[]) || [])];
                  const matchFn = (o: any) => {
                    if (o.expression === selEditing.expression) return true;
                    if (o.exprNames && selEditing.exprNames) {
                      return arraysEqual(o.exprNames, selEditing.exprNames);
                    }
                    return false;
                  };
                  const idx = overrides.findIndex(matchFn);
                  const existingOverride =
                    idx >= 0 ? overrides[idx] : undefined;
                  const entry = {
                    expression: selEditing.expression,
                    score: selEditing.score,
                    exprNames: selEditing.exprNames,
                    disabled: selEditing.disabled ?? existingOverride?.disabled,
                  };
                  if (idx >= 0) {
                    overrides[idx] = entry;
                  } else {
                    overrides.push(entry);
                  }
                  return { ...prev, [overrideKey]: overrides };
                });
                setSelEditing(null);
                close();
                toast.success('Score override saved');
              }}
            >
              Save Override
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// SyncedUrlInputs

/** Per-URL fetch state */
interface UrlFetchState {
  values: SyncedPatternValue[];
  isLoading: boolean;
  error: string | null;
}

export function SyncedUrlInputs({
  syncConfig,
  renderType = 'simple',
}: {
  syncConfig?: SyncConfig;
  renderType?: 'simple' | 'nameable' | 'ranked';
}) {
  const { status } = useStatus();
  const { userData, password } = useUserData();
  const [newUrl, setNewUrl] = useState('');

  const [fetchedData, setFetchedData] = useState<Record<string, UrlFetchState>>(
    {}
  );

  const syncMode = syncConfig?.syncMode ?? 'regex';
  const itemLabel = syncMode === 'sel' ? 'expressions' : 'patterns';

  // Fetch data for all URLs once on mount and when urls/credentials change
  useEffect(() => {
    if (!syncConfig) return;
    const { urls } = syncConfig;
    if (urls.length === 0) return;

    const abortController = new AbortController();
    const credentials =
      userData.uuid && password
        ? { uuid: userData.uuid, password: password }
        : undefined;

    // Mark all URLs as loading
    setFetchedData((prev) => {
      const next = { ...prev };
      for (const url of urls) {
        next[url] = {
          values: prev[url]?.values ?? [],
          isLoading: true,
          error: null,
        };
      }
      return next;
    });

    // Fetch each URL independently
    for (const url of urls) {
      const fetchPromise =
        syncMode === 'sel'
          ? resolveStreamExpressions([url], credentials).then((result) => {
              const urlError = result.errors?.find((e) => e.url === url);
              return {
                values: (result.expressions || []).map((e) => ({
                  expression: e.expression,
                  pattern: e.expression,
                  name: e.name,
                  score: e.score,
                  enabled: e.enabled,
                })),
                error: urlError?.error ?? null,
              };
            })
          : resolveRegexPatterns([url], credentials).then((result) => {
              const urlError = result.errors?.find((e) => e.url === url);
              return {
                values: (result.patterns || []).map((p) => ({
                  pattern: p.pattern,
                  name: p.name,
                  score: p.score,
                })),
                error: urlError?.error ?? null,
              };
            });

      fetchPromise
        .then(({ values, error }) => {
          if (abortController.signal.aborted) return;
          setFetchedData((prev) => ({
            ...prev,
            [url]: { values, isLoading: false, error },
          }));
        })
        .catch((err) => {
          if (abortController.signal.aborted) return;
          setFetchedData((prev) => ({
            ...prev,
            [url]: {
              values: [],
              isLoading: false,
              error:
                err instanceof Error ? err.message : 'Failed to fetch from URL',
            },
          }));
        });
    }

    return () => abortController.abort();
  }, [syncConfig?.urls?.join(','), userData.uuid, password, syncMode]);

  if (!syncConfig) {
    return null;
  }

  const { urls, onUrlsChange, trusted } = syncConfig;

  const validateAndAdd = (url: string) => {
    const allowedUrls = status?.settings?.allowedRegexPatterns?.urls || [];

    if (!url) return false;

    try {
      new URL(url);
    } catch {
      toast.error('Invalid URL format');
      return false;
    }

    if (urls.includes(url)) {
      toast.error('URL is already added');
      return false;
    }

    if (syncMode === 'sel') {
      // SEL sync access check
      const selAccess = status?.settings?.selSyncAccess ?? 'all';
      const isUnrestricted =
        selAccess === 'all' || (selAccess === 'trusted' && trusted);

      if (!isUnrestricted) {
        const whitelistedSelUrls = status?.settings?.whitelistedSelUrls || [];
        if (!whitelistedSelUrls.includes(url)) {
          toast.error(
            'This URL is not in the allowed list. Contact the instance owner to whitelist it.'
          );
          return false;
        }
      }
      return true;
    }

    // Regex sync access check
    const isUnrestricted =
      status?.settings.regexFilterAccess === 'all' ||
      (status?.settings.regexFilterAccess === 'trusted' && trusted);

    if (!isUnrestricted && !allowedUrls.includes(url)) {
      toast.error('URL is not in the allowed list');
      return false;
    }

    return true;
  };

  const handleUrlsUpdate = (newUrls: string[]) => {
    onUrlsChange(newUrls);
  };

  const handleAdd = () => {
    if (!validateAndAdd(newUrl)) return;

    handleUrlsUpdate([...urls, newUrl]);
    setNewUrl('');
  };

  return (
    <div className="mt-4 border-t border-gray-800 pt-4 space-y-3">
      <div>
        <h5 className="text-sm font-medium">
          Synced URLs
          {urls.length > 0 && (
            <span className="ml-1.5 text-xs text-[--muted] font-normal">
              ({urls.length})
            </span>
          )}
        </h5>
        <p className="text-xs text-[--muted]">
          Automatically fetch and sync {itemLabel} from URLs
        </p>
      </div>

      <div className="space-y-2">
        {urls.length > 0 && (
          <div className="rounded-md border border-[--brand]/20 bg-[--brand]/5 divide-y divide-[--brand]/10">
            {urls.map((url) => {
              const urlState = fetchedData[url];
              return (
                <Disclosure key={url} type="single" collapsible>
                  <DisclosureItem value="items">
                    <div className="flex items-center gap-2 p-2 px-3 text-sm">
                      <DisclosureTrigger>
                        <button
                          type="button"
                          className="group flex items-center"
                        >
                          <FaChevronDown className="text-[10px] text-[--muted] transition-transform duration-200 group-data-[state=open]:rotate-180" />
                        </button>
                      </DisclosureTrigger>
                      <span className="flex-1 truncate font-mono text-xs text-[--muted]">
                        {url}
                      </span>
                      <IconButton
                        size="sm"
                        rounded
                        icon={<FaRegTrashAlt />}
                        intent="alert-subtle"
                        onClick={() =>
                          handleUrlsUpdate(urls.filter((u) => u !== url))
                        }
                      />
                    </div>
                    <DisclosureContent>
                      <SyncedPatterns
                        renderType={renderType}
                        syncMode={syncMode}
                        syncedValues={urlState?.values ?? []}
                        isLoading={urlState?.isLoading ?? true}
                        fetchError={urlState?.error ?? null}
                      />
                    </DisclosureContent>
                  </DisclosureItem>
                </Disclosure>
              );
            })}
          </div>
        )}
        <div className="flex gap-2">
          <div className="flex-1">
            <TextInput
              value={newUrl}
              placeholder={`https://example.com/${itemLabel}.json`}
              onValueChange={setNewUrl}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAdd();
                }
              }}
            />
          </div>
          <IconButton
            onClick={handleAdd}
            disabled={!newUrl}
            icon={<FaPlus />}
            rounded
            intent="primary-subtle"
          />
        </div>
      </div>
    </div>
  );
}
