'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import type { TemplateUpdateConflict } from '@/lib/templates/merge';

interface Props {
  conflicts: TemplateUpdateConflict[];
  isLoading?: boolean;
  onCancel: () => void;
  onConfirm: (keepMine: string[]) => void;
}

/**
 * Shown when a template update would change a setting the user has changed
 * themselves. Only those settings appear: anything the user never touched is
 * updated without asking.
 */
export function TemplateConflictStep({
  conflicts,
  isLoading,
  onCancel,
  onConfirm,
}: Props) {
  // Keeping the user's own values is the default. The update is what they asked
  // for, but their changes are the thing they would notice losing.
  const [keepMine, setKeepMine] = useState<Set<string>>(
    () => new Set(conflicts.map((c) => String(c.field)))
  );

  const toggle = (field: string, keep: boolean) => {
    setKeepMine((prev) => {
      const next = new Set(prev);
      if (keep) next.add(field);
      else next.delete(field);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-4 overflow-y-auto">
      <p className="text-sm text-[--muted]">
        These settings differ from the template because you changed them. Tick
        the ones to keep as they are; the rest will take the update. Everything
        else in this template updates either way.
      </p>

      <div className="flex flex-col gap-2">
        {conflicts.map((conflict) => {
          const field = String(conflict.field);
          return (
            <label
              key={field}
              className="flex items-center gap-3 rounded-[--radius] border border-[--border] p-3"
            >
              <Checkbox
                value={keepMine.has(field)}
                onValueChange={(v) => toggle(field, Boolean(v))}
                aria-label={`Keep my ${field}`}
              />
              <span className="text-sm font-mono">{field}</span>
              <span className="ml-auto text-xs text-[--muted]">
                {keepMine.has(field) ? 'keeping yours' : 'taking update'}
              </span>
            </label>
          );
        })}
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Button
          intent="primary"
          className="flex-1"
          loading={isLoading}
          onClick={() => onConfirm([...keepMine])}
        >
          Apply Update
        </Button>
        <Button intent="gray-outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
