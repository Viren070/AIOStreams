import { PAGE_TRANSITION } from '@/components/shared/page-transition';
import { cn } from '@aiostreams/ui/core/styling';
import { motion } from 'motion/react';
import React from 'react';

type PageWrapperProps = {
  children?: React.ReactNode;
} & React.ComponentPropsWithoutRef<'div'> &
  React.ComponentPropsWithoutRef<typeof motion.div>;

/** In case the entrance never reports finishing, as in a hidden tab. */
const ENTRANCE_LIMIT_MS = 1000;

const Entered = React.createContext(true);

/** False while the page is animating in; heavy work waits for it. */
export const usePageEntered = () => React.useContext(Entered);

export function PageWrapper(props: PageWrapperProps) {
  const { children, className, onAnimationComplete, ...rest } = props;
  const animates = (rest as { initial?: unknown }).initial !== false;
  const [entered, setEntered] = React.useState(!animates);
  React.useEffect(() => {
    if (entered) return;
    const timer = setTimeout(() => setEntered(true), ENTRANCE_LIMIT_MS);
    return () => clearTimeout(timer);
  }, [entered]);

  return (
    <div data-page-wrapper-container>
      <motion.div
        data-page-wrapper
        {...PAGE_TRANSITION}
        {...(rest as any)}
        onAnimationComplete={(definition) => {
          setEntered(true);
          onAnimationComplete?.(definition);
        }}
        className={cn('z-[5] relative', className)}
      >
        <Entered.Provider value={entered}>{children}</Entered.Provider>
      </motion.div>
    </div>
  );
}
