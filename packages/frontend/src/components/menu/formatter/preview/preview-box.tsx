import { cn } from '../../../ui/core/styling';

export function FormatterPreviewBox({
  name,
  description,
  compact = false,
  className,
}: {
  name?: string;
  description?: string;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'bg-gray-900 rounded-md border border-gray-800',
        compact ? 'p-3' : 'p-4',
        className
      )}
    >
      <div
        className={cn(
          'font-bold mb-1 overflow-x-auto',
          compact ? 'text-sm' : 'text-xl'
        )}
        style={{ whiteSpace: 'pre' }}
      >
        {name}
      </div>
      <div
        className={cn(
          'text-muted-foreground overflow-x-auto',
          compact ? 'text-xs' : 'text-base'
        )}
        style={{ whiteSpace: 'pre' }}
      >
        {description}
      </div>
    </div>
  );
}
