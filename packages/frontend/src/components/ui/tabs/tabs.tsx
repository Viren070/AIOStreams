import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cva } from 'class-variance-authority';
import { motion, useReducedMotion } from 'motion/react';
import * as React from 'react';
import { cn, ComponentAnatomy, defineStyleAnatomy } from '../core/styling';

/* -------------------------------------------------------------------------------------------------
 * Anatomy
 * -----------------------------------------------------------------------------------------------*/

export const TabsAnatomy = defineStyleAnatomy({
  root: cva(['UI-Tabs__root']),
  list: cva([
    'UI-Tabs__list',
    'inline-flex h-12 items-center justify-center w-full',
  ]),
  trigger: cva([
    'UI-Tabs__trigger appearance-none shadow-none',
    'inline-flex h-full items-center justify-center whitespace-nowrap px-3 py-1.5 text-sm text-[--muted] font-medium ring-offset-[--background]',
    'transition-all focus-visible:outline-none focus-visible:ring-1 ring-offset-1 ring-offset-[--background] focus-visible:ring-white/40',
    'disabled:pointer-events-none disabled:opacity-50',
    'border-transparent border-b-2 -mb-px',
    'data-[state=active]:border-[--brand] data-[state=active]:text-[--foreground]',
  ]),
  content: cva([
    'UI-Tabs__content',
    'ring-offset-[--background]',
    'focus-visible:outline-none focus-visible:ring-1 ring-offset-1 ring-offset-[--background] focus-visible:ring-white/40',
  ]),
});

/* -------------------------------------------------------------------------------------------------
 * Tabs
 * -----------------------------------------------------------------------------------------------*/

/** How the active tab is marked, which decides what slides between tabs. */
export type TabsVariant = 'underline' | 'pill';

interface TabsContextValue extends ComponentAnatomy<typeof TabsAnatomy> {
  activeTab?: string;
  layoutId?: string;
  variant?: TabsVariant;
  indicatorClass?: string;
}

const __TabsAnatomyContext = React.createContext<TabsContextValue>({});

export type TabsProps = React.ComponentPropsWithoutRef<
  typeof TabsPrimitive.Root
> &
  ComponentAnatomy<typeof TabsAnatomy> & {
    variant?: TabsVariant;
    /**
     * Appearance of the sliding marker. Needed because callers style the
     * active state through `triggerClass`, which this cannot read.
     */
    indicatorClass?: string;
  };

export const Tabs = React.forwardRef<HTMLDivElement, TabsProps>(
  (props, ref) => {
    const {
      className,
      listClass,
      triggerClass,
      contentClass,
      variant = 'underline',
      indicatorClass,
      value: valueProp,
      defaultValue,
      onValueChange,
      ...rest
    } = props;

    // Tracked here rather than read from each trigger's data-state, so only
    // the active trigger renders the marker and the layout animation has a
    // single source of truth.
    const [activeTab, setActiveTab] = React.useState(valueProp ?? defaultValue);

    React.useEffect(() => {
      if (valueProp !== undefined) setActiveTab(valueProp);
    }, [valueProp]);

    const handleValueChange = React.useCallback(
      (val: string) => {
        if (valueProp === undefined) setActiveTab(val);
        onValueChange?.(val);
      },
      [onValueChange, valueProp]
    );

    // Scoped per Tabs instance so two tab sets on one page don't animate
    // into each other.
    const uniqueId = React.useId();
    const layoutId = React.useMemo(
      () => `tab-indicator-${uniqueId.replace(/:/g, '')}`,
      [uniqueId]
    );

    return (
      <__TabsAnatomyContext.Provider
        value={{
          listClass,
          triggerClass,
          contentClass,
          activeTab,
          layoutId,
          variant,
          indicatorClass,
        }}
      >
        <TabsPrimitive.Root
          ref={ref}
          value={valueProp}
          defaultValue={defaultValue}
          onValueChange={handleValueChange}
          className={cn(TabsAnatomy.root(), className)}
          {...rest}
        />
      </__TabsAnatomyContext.Provider>
    );
  }
);

Tabs.displayName = 'Tabs';

/* -------------------------------------------------------------------------------------------------
 * TabsList
 * -----------------------------------------------------------------------------------------------*/

export type TabsListProps = React.ComponentPropsWithoutRef<
  typeof TabsPrimitive.List
>;

export const TabsList = React.forwardRef<HTMLDivElement, TabsListProps>(
  (props, ref) => {
    const { className, ...rest } = props;

    const { listClass } = React.useContext(__TabsAnatomyContext);

    return (
      <TabsPrimitive.List
        ref={ref}
        className={cn(TabsAnatomy.list(), listClass, className)}
        {...rest}
      />
    );
  }
);

TabsList.displayName = 'TabsList';

/* -------------------------------------------------------------------------------------------------
 * TabsTrigger
 * -----------------------------------------------------------------------------------------------*/

export type TabsTriggerProps = React.ComponentPropsWithoutRef<
  typeof TabsPrimitive.Trigger
>;

export const TabsTrigger = React.forwardRef<
  HTMLButtonElement,
  TabsTriggerProps
>((props, ref) => {
  const { className, children, ...rest } = props;

  const { triggerClass, activeTab, layoutId, variant, indicatorClass } =
    React.useContext(__TabsAnatomyContext);
  const reducedMotion = useReducedMotion();

  const isActive = activeTab === rest.value;
  const animated = !reducedMotion && !!layoutId;

  // The static active style has to give way, or it would show at the
  // destination before the marker arrives. `cn` is tailwind-merge, so this
  // beats whatever the caller set in `triggerClass`.
  const suppressStatic = animated
    ? variant === 'pill'
      ? 'data-[state=active]:bg-transparent'
      : 'data-[state=active]:border-transparent'
    : '';

  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        TabsAnatomy.trigger(),
        triggerClass,
        className,
        suppressStatic,
        animated && 'relative z-0'
      )}
      {...rest}
    >
      {children}
      {animated && isActive && (
        <motion.span
          layoutId={layoutId}
          transition={{ type: 'spring', stiffness: 500, damping: 38 }}
          className={cn(
            variant === 'pill'
              ? 'absolute inset-0 -z-10 rounded-[inherit] bg-[--subtle]'
              : 'absolute bottom-0 left-0 right-0 h-0.5 bg-[--brand]',
            indicatorClass
          )}
        />
      )}
    </TabsPrimitive.Trigger>
  );
});

TabsTrigger.displayName = 'TabsTrigger';

/* -------------------------------------------------------------------------------------------------
 * TabsContent
 * -----------------------------------------------------------------------------------------------*/

export type TabsContentProps = React.ComponentPropsWithoutRef<
  typeof TabsPrimitive.Content
>;

export const TabsContent = React.forwardRef<HTMLDivElement, TabsContentProps>(
  (props, ref) => {
    const { className, ...rest } = props;

    const { contentClass } = React.useContext(__TabsAnatomyContext);

    return (
      <TabsPrimitive.Content
        ref={ref}
        className={cn(TabsAnatomy.content(), contentClass, className)}
        {...rest}
      />
    );
  }
);

TabsContent.displayName = 'TabsContent';
