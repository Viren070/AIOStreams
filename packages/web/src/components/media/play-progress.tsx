import React from 'react';

/**
 * A Play button's words with how far into the title it is: a thin bar just
 * under them, in the text's own colour, so it turns black with the text on a
 * button lit white. It hangs below the words rather than taking a line, so
 * the label sits where it would without it.
 */
export function PlayProgress({
  percent,
  children,
}: {
  percent: number | null | undefined;
  children: React.ReactNode;
}) {
  if (!percent || percent <= 0) return <>{children}</>;
  return (
    <span data-ui="play-progress-label" className="relative inline-block">
      {children}
      <span
        data-ui="play-progress"
        aria-hidden
        className="absolute inset-x-0 -bottom-[5px] h-[3px] overflow-hidden rounded-full"
      >
        <span className="absolute inset-0 bg-current opacity-25" />
        <span
          className="absolute inset-y-0 start-0 rounded-full bg-current"
          style={{ width: `${Math.min(100, Math.max(4, percent))}%` }}
        />
      </span>
    </span>
  );
}
