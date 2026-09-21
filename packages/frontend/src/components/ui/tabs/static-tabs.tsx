import { cva } from 'class-variance-authority';
import { motion, useReducedMotion } from 'motion/react';
import * as React from 'react';
import { cn, ComponentAnatomy, defineStyleAnatomy } from '../core/styling';

/* -------------------------------------------------------------------------------------------------
 * Anatomy
 * -----------------------------------------------------------------------------------------------*/

export const StaticTabsAnatomy = defineStyleAnatomy({
  root: cva([
    'UI-StaticTabs__root',
    'flex w-full overflow-hidden overflow-x-auto gap-2 py-1',
  ]),
  trigger: cva([
    'UI-StaticTabs__trigger',
    'group/staticTabs__trigger inline-flex flex-none shrink-0 basis-auto items-center font-medium text-sm transition outline-none min-w-0 justify-center',
    'text-[--muted] hover:text-[--foreground]',
    'h-10 px-4 rounded-xl border border-transparent',
    'data-[current=true]:font-semibold data-[current=true]:text-white',
    'focus-visible:bg-[--subtle]',
  ]),
  icon: cva(['UI-StaticTabs__icon', '-ml-0.5 mr-2 h-4 w-4']),
});

/* -------------------------------------------------------------------------------------------------
 * StaticTabs
 * -----------------------------------------------------------------------------------------------*/

export type StaticTabsItem = {
  name: string;
  href?: string | null | undefined;
  iconType?: React.ElementType;
  onClick?: () => void;
  isCurrent: boolean;
};

export type StaticTabsProps = React.ComponentPropsWithRef<'nav'> &
  ComponentAnatomy<typeof StaticTabsAnatomy> & {
    items: StaticTabsItem[];
    /**
     * Appearance of the sliding marker. Callers style the shell, and the
     * marker has to match it, so it cannot be derived here.
     */
    pillClass?: string;
  };

export const StaticTabs = React.forwardRef<HTMLElement, StaticTabsProps>(
  (props, ref) => {
    const {
      children,
      className,
      triggerClass,
      iconClass,
      items,
      pillClass,
      ...rest
    } = props;

    const reducedMotion = useReducedMotion();
    const uniqueId = React.useId();
    const layoutId = `static-tab-indicator-${uniqueId.replace(/:/g, '')}`;
    const animated = !reducedMotion;

    // `rounded-[inherit]` takes the trigger's radius, so the marker follows
    // whatever shape the caller gave the tabs.
    const pill = (isCurrent: boolean) =>
      animated && isCurrent ? (
        <motion.span
          layoutId={layoutId}
          transition={{ type: 'spring', stiffness: 500, damping: 38 }}
          className={cn(
            'absolute inset-0 -z-10 rounded-[inherit] bg-[--subtle]',
            pillClass
          )}
        />
      ) : null;

    return (
      <nav
        ref={ref}
        className={cn(StaticTabsAnatomy.root(), className)}
        role="navigation"
        {...rest}
      >
        {items.map((tab) =>
          !!tab.href ? (
            <a
              key={tab.name}
              href={tab.href ?? '#'}
              className={cn(
                'cursor-pointer',
                StaticTabsAnatomy.trigger(),
                triggerClass,
                animated ? 'relative z-0' : 'data-[current=true]:bg-[--subtle]'
              )}
              aria-current={tab.isCurrent ? 'page' : undefined}
              data-current={tab.isCurrent}
            >
              {pill(!!tab.isCurrent)}
              {tab.iconType && (
                <tab.iconType
                  className={cn(StaticTabsAnatomy.icon(), iconClass)}
                  aria-hidden="true"
                  data-current={tab.isCurrent}
                />
              )}
              <span>{tab.name}</span>
            </a>
          ) : (
            <div
              key={tab.name}
              className={cn(
                StaticTabsAnatomy.trigger(),
                'cursor-pointer',
                triggerClass,
                animated ? 'relative z-0' : 'data-[current=true]:bg-[--subtle]'
              )}
              aria-current={tab.isCurrent ? 'page' : undefined}
              data-current={tab.isCurrent}
              onClick={tab.onClick}
            >
              {pill(!!tab.isCurrent)}
              {tab.iconType && (
                <tab.iconType
                  className={cn(StaticTabsAnatomy.icon(), iconClass)}
                  aria-hidden="true"
                  data-current={tab.isCurrent}
                />
              )}
              <span>{tab.name}</span>
            </div>
          )
        )}
      </nav>
    );
  }
);

StaticTabs.displayName = 'StaticTabs';
