import { memo } from 'react';

interface ServiceExpiryBadgeProps {
  text: string;
  colors: {
    background: string;
    foreground: string;
  };
  title?: string;
}

export const ServiceExpiryBadge = memo(function ServiceExpiryBadge({
  text,
  colors,
  title,
}: ServiceExpiryBadgeProps) {
  return (
    <span
      className="ml-2 inline-flex shrink-0 items-center rounded px-2 py-0.5 text-[0.65rem] font-semibold uppercase leading-none shadow-sm"
      style={{
        backgroundColor: colors.background,
        color: colors.foreground,
      }}
      title={title}
    >
      {text}
    </span>
  );
});
