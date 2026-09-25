import React from 'react';
import { cn } from '@aiostreams/ui/core/styling';

export function UserAvatar({
  name,
  src,
  className,
}: {
  name: string | null | undefined;
  src?: string | null;
  className?: string;
}) {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [src]);
  return (
    <span
      className={cn(
        'relative flex flex-none items-center justify-center overflow-hidden rounded-full bg-brand-500/30 font-semibold uppercase text-white',
        className
      )}
    >
      {src && !failed ? (
        <img
          src={src}
          alt=""
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        (name || '?').slice(0, 1)
      )}
    </span>
  );
}
