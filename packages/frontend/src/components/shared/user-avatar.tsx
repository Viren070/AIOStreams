import React from 'react';

export function UserAvatar({
  name,
  avatar,
}: {
  name: string;
  avatar?: string;
}) {
  if (avatar) {
    return (
      <img
        src={avatar}
        alt=""
        className="h-8 w-8 shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[--subtle] text-xs font-semibold uppercase text-[--muted]">
      {name.trim().charAt(0) || '?'}
    </span>
  );
}
