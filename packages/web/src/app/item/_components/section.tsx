import React from 'react';

export function Section({
  name,
  title,
  action,
  children,
}: {
  name: string;
  /** Left out when the first row carries it. */
  title?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section data-ui="section" data-name={name} className="space-y-4">
      {title && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 data-ui="section-title" className="text-xl font-semibold">
            {title}
          </h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
