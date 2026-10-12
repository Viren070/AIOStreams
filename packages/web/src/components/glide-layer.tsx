import React from 'react';
import { currentHost } from '../lib/hosts';

/** On TVs only. The layer holds anything `position: fixed` inside it to itself. */
export function GlideLayer({
  name = '',
  children,
}: {
  /** Names the page's own, which the document scrolls. */
  name?: string;
  children: React.ReactNode;
}) {
  if (!currentHost().tv) return <>{children}</>;
  return (
    <div
      data-glide-layer={name}
      // Kept as a layer, since one made as a glide starts draws nothing for a frame.
      className="will-change-transform"
    >
      {children}
    </div>
  );
}
