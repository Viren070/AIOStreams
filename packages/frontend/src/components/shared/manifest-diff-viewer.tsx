'use client';

import React, { useMemo } from 'react';
import { DiffViewer } from './diff-viewer';
import {
  computeManifestDiff,
  manifestValueFormatter,
} from '../../utils/diff/manifest';
import { Alert } from '../ui/alert';

interface ManifestDiffViewerProps {
  oldManifest: any;
  newManifest: any;
}

/** Replace numeric resource indices with the resource name, e.g.
 *  resources[2].types → resources["stream"].types */
function buildManifestPathFormatter(
  oldManifest: any,
  newManifest: any
): (path: string[]) => string {
  return (path: string[]) => {
    const parts = path.map((segment, i) => {
      // Is this a bracketed index like "[2]"?
      const indexMatch = segment.match(/^\[(\d+)\]$/);
      if (!indexMatch) return segment;
      const index = parseInt(indexMatch[1], 10);

      // Is the parent segment "resources"?
      if (path[i - 1] === 'resources') {
        const resource =
          (newManifest?.resources ?? [])[index] ??
          (oldManifest?.resources ?? [])[index];
        if (
          resource &&
          typeof resource === 'object' &&
          typeof resource.name === 'string'
        ) {
          return `["${resource.name}"]`;
        }
      }

      return segment;
    });

    // Join: use '.' between plain segments, nothing before a bracketed segment
    return parts.reduce((acc, part, i) => {
      if (i === 0) return part;
      return part.startsWith('[') ? acc + part : acc + '.' + part;
    }, '');
  };
}

export function ManifestDiffViewer({
  oldManifest,
  newManifest,
}: ManifestDiffViewerProps) {
  const { diffs, annotations } = useMemo(
    () => computeManifestDiff(oldManifest, newManifest),
    [oldManifest, newManifest]
  );

  const pathFormatter = useMemo(
    () => buildManifestPathFormatter(oldManifest, newManifest),
    [oldManifest, newManifest]
  );

  if (diffs.length === 0) {
    return (
      <div className="text-center p-4 text-[--muted] text-sm">
        No meaningful manifest changes detected.
      </div>
    );
  }

  return (
    <DiffViewer
      diffs={diffs}
      valueFormatter={manifestValueFormatter}
      oldValue={oldManifest}
      newValue={newManifest}
      annotations={annotations}
      pathFormatter={pathFormatter}
    />
  );
}

/**
 * Compact summary shown directly inside the "Manifest Changed" notification
 * modal. Displays a severity banner and a list of annotated change items so
 * the user can immediately see what matters - without opening the full diff.
 */
export function ManifestChangeSummary({
  oldManifest,
  newManifest,
}: ManifestDiffViewerProps) {
  const { diffs, annotations } = useMemo(
    () => computeManifestDiff(oldManifest, newManifest),
    [oldManifest, newManifest]
  );

  const annotatedItems = useMemo(() => {
    const severityOrder: Record<string, number> = {
      critical: 0,
      warning: 1,
      info: 2,
    };
    return diffs
      .map((diff) => {
        const pathKey = diff.path.join('.').replace(/\.\[/g, '[');
        const annotation = annotations.get(pathKey);
        return annotation ? { diff, annotation, pathKey } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort(
        (a, b) =>
          (severityOrder[a.annotation.severity ?? 'info'] ?? 3) -
          (severityOrder[b.annotation.severity ?? 'info'] ?? 3)
      );
  }, [diffs, annotations]);

  if (diffs.length === 0) return null;

  const hasCritical = annotatedItems.some(
    (x) => x.annotation.severity === 'critical'
  );
  const hasWarning =
    !hasCritical &&
    annotatedItems.some((x) => x.annotation.severity === 'warning');

  const alertIntent: 'alert' | 'warning' | 'info' = hasCritical
    ? 'alert'
    : hasWarning
      ? 'warning'
      : 'info';

  const alertDescription = hasCritical
    ? 'Reinstall required - some changes will not take effect in Stremio until you reinstall.'
    : hasWarning
      ? 'Reinstall recommended to apply all changes correctly.'
      : 'No significant changes - reinstall is not required for expected functionality.';

  return (
    <div className="space-y-2">
      <Alert
        intent={alertIntent}
        isClosable={false}
        description={alertDescription}
      />
      {annotatedItems.length > 0 && (
        <div className="space-y-1.5">
          {annotatedItems.map((item, i) => (
            <div
              key={i}
              className="p-2.5 rounded-lg border border-[--border] bg-gray-800/30 space-y-1"
            >
              <span
                className={`inline-block px-2 py-0.5 text-[10px] font-semibold rounded border ${
                  item.annotation.className ?? ''
                }`}
              >
                {item.annotation.label}
              </span>
              {item.annotation.description && (
                <p className="text-xs text-[--muted]">
                  {item.annotation.description}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
