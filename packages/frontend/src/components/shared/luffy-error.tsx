import { Button } from '@/components/ui/button/button';
import { cn } from '@/components/ui/core/styling';
import React from 'react';

interface LuffyErrorProps {
  children?: React.ReactNode;
  className?: string;
  reset?: () => void;
  title?: string | null;
  showRefreshButton?: boolean;
}

export const LuffyError: React.FC<LuffyErrorProps> = (props) => {
  const {
    children,
    reset,
    className,
    title = 'Oops!',
    showRefreshButton = false,
    ...rest
  } = props;

  return (
    <>
      <div
        data-luffy-error
        className={cn(
          'w-full flex flex-col items-center mt-10 space-y-4',
          className
        )}
      >
        {
          <div
            data-luffy-error-image-container
            className="size-[8rem] mx-auto flex-none rounded-[--radius-md] object-cover object-center relative overflow-hidden"
          >
            <img
              data-luffy-error-image
              src="/logo.png"
              alt={''}
              className="absolute inset-0 w-full h-full object-contain object-top"
            />
          </div>
        }
        <div data-luffy-error-content className="text-center space-y-4">
          {!!title && <h3 data-luffy-error-title>{title}</h3>}
          <div data-luffy-error-content-children>{children}</div>
          <div data-luffy-error-content-buttons>
            {showRefreshButton && !reset && (
              <Button
                data-luffy-error-content-button-refresh
                intent="warning-subtle"
                onClick={() => window.location.reload()}
              >
                Retry
              </Button>
            )}
            {!!reset && (
              <Button
                data-luffy-error-content-button-reset
                intent="warning-subtle"
                onClick={reset}
              >
                Retry
              </Button>
            )}
          </div>
        </div>
      </div>
    </>
  );
};
