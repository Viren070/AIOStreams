import React from 'react';
import { currentHost } from '../lib/hosts';

/** Jumps under way at once, which a held key's repeats reach. */
const LAYERS = 3;

/** On TVs only. A layer holds anything `position: fixed` inside it to itself. */
export function GlideLayers({
  name = '',
  children,
}: {
  /** Names the page's own set, which the document scrolls. */
  name?: string;
  children: React.ReactNode;
}) {
  if (!currentHost().tv) return <>{children}</>;
  let inner = children;
  for (let i = LAYERS - 1; i >= 0; i--)
    inner = (
      <div
        data-glide-layer
        data-glide-layers={i === 0 ? name : undefined}
        // Kept as layers, since one made as a glide starts draws nothing for a frame.
        className="will-change-transform"
      >
        {inner}
      </div>
    );
  return inner;
}
