import React from 'react';
import { useMenu } from '@/context/menu';
import { PageControls } from './page-controls';

/** The new layout titles pages itself. */
export function MenuHeader({
  title,
  description,
  badge,
  controls = true,
}: {
  title: string;
  description?: React.ReactNode;
  badge?: React.ReactNode;
  controls?: boolean;
}) {
  const { layout } = useMenu();
  if (layout === 'new') return badge ? <div>{badge}</div> : null;
  return (
    <div className="flex items-center w-full">
      <div>
        <div className="flex items-center gap-2">
          <h2>{title}</h2>
          {badge}
        </div>
        {description && <p className="text-[--muted]">{description}</p>}
      </div>
      {controls && (
        <div className="hidden lg:block lg:ml-auto">
          <PageControls />
        </div>
      )}
    </div>
  );
}
