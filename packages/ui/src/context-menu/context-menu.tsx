import * as ContextMenuPrimitive from '@radix-ui/react-context-menu';
import { cva } from 'class-variance-authority';
import * as React from 'react';
import { cn, defineStyleAnatomy } from '../core/styling';

/* -------------------------------------------------------------------------------------------------
 * Anatomy
 * -----------------------------------------------------------------------------------------------*/

export const ContextMenuAnatomy = defineStyleAnatomy({
  root: cva([
    'UI-ContextMenu__root',
    'z-50 max-h-[var(--radix-context-menu-content-available-height)] min-w-[14rem] overflow-y-auto rounded-xl border bg-[--background] p-1 text-[--foreground] shadow-lg',
    'data-[state=open]:animate-in',
    'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
    'data-[state=closed]:zoom-out-100 data-[state=open]:zoom-in-95',
  ]),
  item: cva([
    'UI-ContextMenu__item',
    'relative flex cursor-pointer select-none items-center rounded-[--radius] px-2 py-2 text-sm outline-none transition-colors',
    'focus:bg-[--subtle] data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
    '[&>svg]:mr-2 [&>svg]:text-lg',
  ]),
  label: cva([
    'UI-ContextMenu__label',
    'px-2 py-1.5 text-xs font-semibold text-[--muted]',
  ]),
  separator: cva([
    'UI-ContextMenu__separator',
    '-mx-1 my-1 h-px bg-[--border]',
  ]),
});

/* -------------------------------------------------------------------------------------------------
 * ContextMenu
 * -----------------------------------------------------------------------------------------------*/

export const ContextMenu = ContextMenuPrimitive.Root;

export const ContextMenuTrigger = ContextMenuPrimitive.Trigger;

export const ContextMenuContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>
>(({ className, ...rest }, ref) => (
  <ContextMenuPrimitive.Portal>
    {/* Anchored to a point, partial stickiness would let it leave the screen. */}
    <ContextMenuPrimitive.Content
      ref={ref}
      className={cn(ContextMenuAnatomy.root(), className)}
      collisionPadding={8}
      sticky="always"
      {...rest}
    />
  </ContextMenuPrimitive.Portal>
));
ContextMenuContent.displayName = 'ContextMenuContent';

export const ContextMenuItem = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item>
>(({ className, ...rest }, ref) => (
  <ContextMenuPrimitive.Item
    ref={ref}
    className={cn(ContextMenuAnatomy.item(), className)}
    {...rest}
  />
));
ContextMenuItem.displayName = 'ContextMenuItem';

export const ContextMenuLabel = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Label>
>(({ className, ...rest }, ref) => (
  <ContextMenuPrimitive.Label
    ref={ref}
    className={cn(ContextMenuAnatomy.label(), className)}
    {...rest}
  />
));
ContextMenuLabel.displayName = 'ContextMenuLabel';

export const ContextMenuSeparator = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>
>(({ className, ...rest }, ref) => (
  <ContextMenuPrimitive.Separator
    ref={ref}
    className={cn(ContextMenuAnatomy.separator(), className)}
    {...rest}
  />
));
ContextMenuSeparator.displayName = 'ContextMenuSeparator';
