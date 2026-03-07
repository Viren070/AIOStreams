'use client';

import React, { useMemo } from 'react';
import { DiffViewer } from './diff-viewer';
import {
  computeManifestDiff,
  manifestValueFormatter,
} from '../../utils/diff/manifest';

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
