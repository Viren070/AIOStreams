import React from 'react';

/** Content clear of a landscape phone's notch on the right. */
export const GUTTER = 'ps-4 pe-[max(1rem,env(safe-area-inset-right))]';

export function Section({
  title,
  children,
  name,
}: {
  title?: string;
  children: React.ReactNode;
  name: string;
}) {
  return (
    <section
      data-ui="party-section"
      data-name={name}
      className="space-y-3 py-4"
    >
      {title && (
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[--muted]">
          {title}
        </h3>
      )}
      {children}
    </section>
  );
}
