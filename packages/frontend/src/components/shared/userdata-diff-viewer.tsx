'use client';

import React, { useMemo } from 'react';
import { UserData } from '@aiostreams/core';
import { DiffViewer } from './diff-viewer';
import {
  computeUserDataDiff,
  createValueFormatter,
} from '../../utils/diff/userData';

interface UserDataDiffViewerProps {
  oldConfig: UserData | null;
  newConfig: UserData | null;
}

export function UserDataDiffViewer({
  oldConfig,
  newConfig,
}: UserDataDiffViewerProps) {
  const allPresets: UserData['presets'] = useMemo(
    () => [...(oldConfig?.presets ?? []), ...(newConfig?.presets ?? [])],
    [oldConfig?.presets, newConfig?.presets]
  );

  const valueFormatter = useMemo(
    () => createValueFormatter(allPresets),
    [allPresets]
  );

  const { diffs, processedOld, processedNew } = useMemo(
    () => computeUserDataDiff(oldConfig, newConfig),
    [oldConfig, newConfig]
  );

  return (
    <DiffViewer
      diffs={diffs}
      valueFormatter={valueFormatter}
      oldValue={processedOld}
      newValue={processedNew}
    />
  );
}
