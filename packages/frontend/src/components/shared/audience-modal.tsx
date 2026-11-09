import React from 'react';
import { Modal } from '@aiostreams/ui/modal';
import { IconButton } from '@aiostreams/ui/button';
import { SwitchAnatomy } from '@aiostreams/ui/switch';
import { cn } from '@aiostreams/ui/core/styling';
import { LuLink, LuUsers } from 'react-icons/lu';
import type { Audience, Toggle } from '@/lib/audiences';
import type { Audiences } from '@/hooks/variants';
import { UserAvatar } from './user-avatar';

export interface AudienceTarget {
  title: string;
  toggles: Toggle[];
}

export function AudienceButton({
  summary,
  onClick,
  className,
}: {
  summary: string | undefined;
  onClick: () => void;
  className?: string;
}) {
  return (
    <IconButton
      rounded
      className={className}
      intent={summary ? 'primary' : 'primary-subtle'}
      icon={<LuUsers />}
      title={summary ?? 'Everyone gets this'}
      aria-label="Who gets this"
      onClick={onClick}
    />
  );
}

function AudienceRow({
  audience,
  state,
  onToggle,
}: {
  audience: Audience;
  state: boolean | 'indeterminate';
  onToggle: () => void;
}) {
  const on = state === true;
  const caption =
    audience.locked ??
    (state === 'indeterminate' ? 'Gets some of these' : audience.caption);
  return (
    <li>
      {/* The switch is drawn, not a control, so it always shows the config. */}
      <button
        type="button"
        role="switch"
        aria-checked={state === 'indeterminate' ? 'mixed' : on}
        disabled={!!audience.locked}
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors enabled:hover:bg-white/5 disabled:cursor-not-allowed focus-visible:bg-white/5 focus-visible:outline-none"
      >
        {audience.kind === 'user' ? (
          <UserAvatar name={audience.label} avatar={audience.avatar} />
        ) : (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[--subtle] text-[--muted]">
            <LuLink className="h-4 w-4" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-white">
            {audience.label}
          </span>
          {caption && (
            <span
              className={cn(
                'block text-xs',
                audience.locked ? 'text-[--orange]' : 'truncate text-[--muted]'
              )}
            >
              {caption}
            </span>
          )}
        </span>
        <span
          data-state={on ? 'checked' : 'unchecked'}
          data-disabled={!!audience.locked}
          className={cn(
            SwitchAnatomy.root({ size: 'md' }),
            'pointer-events-none'
          )}
        >
          <span
            data-state={on ? 'checked' : 'unchecked'}
            className={SwitchAnatomy.thumb({ size: 'md' })}
          />
        </span>
      </button>
    </li>
  );
}

export function AudienceModal({
  who,
  target,
  onClose,
}: {
  who: Audiences;
  target: AudienceTarget | null;
  onClose: () => void;
}) {
  if (!target) return null;
  const states = who.states(target.toggles);
  const conditional = who.conditional(target.toggles);
  const groups = [
    {
      title: 'Users',
      rows: who.audiences.flatMap((a, i) => (a.kind === 'user' ? [i] : [])),
    },
    {
      title: 'Install links',
      rows: who.audiences.flatMap((a, i) => (a.kind === 'user' ? [] : [i])),
    },
  ].filter((group) => group.rows.length);

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={target.title}
      description={`Turn ${target.toggles.length > 1 ? 'them' : 'it'} on or off for each user and install link.`}
    >
      <div className="space-y-4">
        {groups.map((group) => (
          <section key={group.title} className="space-y-1.5">
            <h3 className="text-xs font-medium text-[--muted]">
              {group.title}
            </h3>
            <ul className="divide-y divide-gray-800 overflow-hidden rounded-md border border-gray-800">
              {group.rows.map((i) => (
                <AudienceRow
                  key={who.audiences[i].key}
                  audience={who.audiences[i]}
                  state={states[i]}
                  onToggle={() =>
                    who.assign(
                      target.toggles,
                      who.audiences[i].key,
                      states[i] !== true
                    )
                  }
                />
              ))}
            </ul>
          </section>
        ))}
        {conditional.length > 0 && (
          <p className="text-xs text-[--muted]">
            {conditional.join(', ')} can also change this, on the requests their
            condition matches.
          </p>
        )}
      </div>
    </Modal>
  );
}
