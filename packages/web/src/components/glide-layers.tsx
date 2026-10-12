import React from 'react';
import { currentHost } from '../lib/hosts';
import { GLIDE_LAYERS } from '../lib/input/glide';

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
  for (let i = GLIDE_LAYERS - 1; i >= 0; i--)
    inner = (
      <div
        data-glide-layer={i === 0 ? name : ''}
        // Kept as layers, since one made as a glide starts draws nothing for a frame.
        className="will-change-transform"
      >
        {inner}
      </div>
    );
  return inner;
}
