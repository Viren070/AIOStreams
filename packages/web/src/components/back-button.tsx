import { t } from '@lingui/core/macro';
import { LuArrowLeft } from 'react-icons/lu';
import { cn } from '@aiostreams/ui/core/styling';
import { goBackInApp } from '@/lib/paths';
import { slideBack } from '@/lib/hosts/shell/back-slide';
import { GlassSurface } from '@/components/shell/glass-surface';

export function BackButton({
  fallback,
  className,
}: {
  fallback: string;
  className?: string;
}) {
  return (
    <GlassSurface
      data-ui="back-button"
      className={cn('flex-none rounded-full', className)}
    >
      <button
        type="button"
        aria-label={t`Back`}
        className="flex size-10 items-center justify-center rounded-full text-xl text-white/80 transition-colors hover:bg-white/10 hover:text-white"
        onClick={() => {
          if (!slideBack()) goBackInApp(fallback);
        }}
      >
        <LuArrowLeft className="rtl:-scale-x-100" />
      </button>
    </GlassSurface>
  );
}
