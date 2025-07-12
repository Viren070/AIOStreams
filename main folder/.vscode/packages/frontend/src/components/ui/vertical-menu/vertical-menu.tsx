'use client';

import { cva, VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { useContext } from 'react';
import { cn, ComponentAnatomy, defineStyleAnatomy } from '../core/styling';
import {
  Disclosure,
  DisclosureContent,
  DisclosureItem,
  DisclosureTrigger,
} from '../disclosure';
import { Tooltip, TooltipProps } from '../tooltip';

/* -------------------------------------------------------------------------------------------------
 * Anatomy
 * -----------------------------------------------------------------------------------------------*/

export const VerticalMenuAnatomy = defineStyleAnatomy({
  root: cva(['UI-VerticalMenu__root', 'flex flex-col gap-1']),
  item: cva(
    [
      'UI-VerticalMenu__item',
      'group/verticalMenu_item relative flex flex-none truncate items-center w-full font-medium rounded-[--radius] transition cursor-pointer',
      'hover:bg-[--subtle] hover:text-[--foreground]',
      'focus-visible:bg-[--subtle] outline-none text-[--muted]',
      'data-[current=true]:bg-[--subtle] data-[current=true]:text-[--foreground]',
    ],
    {
      variants: {
        collapsed: {
          true: 'justify-center',
          false: null,
        },
      },
      defaultVariants: {
        collapsed: false,
      },
    }
  ),
  itemContent: cva(
    ['UI-VerticalMenu__itemContent', 'w-full flex items-center relative'],
    {
      variants: {
        size: {
          sm: 'px-3 h-8 text-sm',
          md: 'px-3 h-10 text-sm',
          lg: 'px-3 h-12 text-base',
        },
        collapsed: {
          true: 'justify-center',
          false: null,
        },
      },
      defaultVariants: {
        size: 'md',
        collapsed: false,
      },
    }
  ),
  parentItem: cva([
    'UI-VerticalMenu__parentItem',
    'group/verticalMenu_parentItem',
    'cursor-pointer w-full',
  ]),
  itemChevron: cva(
    [
      'UI-VerticalMenu__itemChevron',
      'size-4 absolute transition-transform group-data-[state=open]/verticalMenu_parentItem:rotate-90',
    ],
    {
      variants: {
        size: {
          sm: 'right-3',
          md: 'right-3',
          lg: 'right-3',
        },
        collapsed: {
          true: 'top-1 left-1 size-3',
          false: null,
        },
      },
      defaultVariants: {
        size: 'md',
        collapsed: false,
      },
    }
  ),
  itemIcon: cva(
    [
      'UI-VerticalMenu__itemIcon',
      'flex-shrink-0 mr-3',
      'text-[--muted] text-xl',
      'group-hover/verticalMenu_item:text-[--foreground]',
      'group-data-[current=true]/verticalMenu_item:text-[--foreground]',
    ],
    {
      variants: {
        size: {
          sm: 'size-5',
          md: 'size-6',
          lg: 'size-7',
        },
        collapsed: {
          true: 'mr-0',
          false: null,
        },
      },
      defaultVariants: {
        size: 'md',
      },
    }
  ),
  subContent: cva(['UI-VerticalMenu__subContent', 'border-b py-1']),
});

/* -------------------------------------------------------------------------------------------------
 * VerticalMenu
 * -----------------------------------------------------------------------------------------------*/

const __VerticalMenuContext = React.createContext<
  Pick<VerticalMenuProps, 'onItemSelect'> & {
    collapsed?: boolean;
  }
>({});

export type VerticalMenuItem = {
  name: string;
  iconType?: React.ElementType;
  isCurrent?: boolean;
  onClick?: () => void;
  addon?: React.ReactNode;
  subContent?: React.ReactNode;
};

export type VerticalMenuProps = React.ComponentPropsWithRef<'div'> &
  ComponentAnatomy<typeof VerticalMenuAnatomy> &
  VariantProps<typeof VerticalMenuAnatomy.itemContent> & {
    /**
     * The items to render.
     */
    items: VerticalMenuItem[];
    /**
     * Props passed to each item tooltip that is shown when the menu is collapsed.
     */
    itemTooltipProps?: Omit<TooltipProps, 'trigger'>;
    /**
     * Callback fired when an item is selected.
     */
    onItemSelect?: (item: VerticalMenuItem) => void;
  };

export const VerticalMenu = React.forwardRef<HTMLDivElement, VerticalMenuProps>(
  (props, ref) => {
    const {
      children,
      size = 'md',
      collapsed: _collapsed1,
      onItemSelect,
      /**/
      itemClass,
      itemIconClass,
      parentItemClass,
      subContentClass,
      itemChevronClass,
      itemContentClass,
      itemTooltipProps,
      className,
      items,
      ...rest
    } = props;

    const { onItemSelect: _onItemSelect, collapsed: _collapsed2 } = useContext(
      __VerticalMenuContext
    );

    const collapsed = _collapsed1 ?? _collapsed2 ?? false;

    const handleItemClick =
      (item: VerticalMenuItem) => (e: React.MouseEvent<HTMLElement>) => {
        onItemSelect?.(item);
        _onItemSelect?.(item);
        item.onClick?.();
      };

    const ItemContentWrapper = React.useCallback(
      (props: { children: React.ReactElement; name: string }) => {
        return !collapsed ? (
          props.children
        ) : (
          <Tooltip trigger={props.children} side="right" {...itemTooltipProps}>
            {props.name}
          </Tooltip>
        );
      },
      [collapsed, itemTooltipProps]
    );

    const ItemContent = React.useCallback(
      (item: VerticalMenuItem) => (
        <ItemContentWrapper name={item.name}>
          <div
            data-vertical-menu-item={item.name}
            className={cn(
              VerticalMenuAnatomy.itemContent({ size, collapsed }),
              itemContentClass
            )}
          >
            {item.iconType && (
              <item.iconType
                className={cn(
                  VerticalMenuAnatomy.itemIcon({ size, collapsed }),
                  itemIconClass
                )}
                aria-hidden="true"
                data-current={item.isCurrent}
              />
            )}
            {!collapsed && <span>{item.name}</span>}
            {item.addon}
          </div>
        </ItemContentWrapper>
      ),
      [collapsed, size, itemContentClass, itemIconClass]
    );

    return (
      <nav
        ref={ref}
        className={cn(VerticalMenuAnatomy.root(), className)}
        role="navigation"
        {...rest}
      >
        <__VerticalMenuContext.Provider
          value={{
            onItemSelect,
            collapsed: _collapsed1 ?? false,
          }}
        >
          {items.map((item, idx) => {
            return (
              <React.Fragment key={item.name + idx}>
                {!item.subContent ? (
                  <button
                    className={cn(
                      VerticalMenuAnatomy.item({ collapsed }),
                      itemClass
                    )}
                    data-current={item.isCurrent}
                    onClick={handleItemClick(item)}
                    data-vertical-menu-item-button={item.name}
                  >
                    <ItemContent {...item} />
                  </button>
                ) : (
                  <Disclosure type="multiple">
                    <DisclosureItem value={item.name}>
                      <DisclosureTrigger>
                        <button
                          className={cn(
                            VerticalMenuAnatomy.item({ collapsed }),
                            itemClass,
                            VerticalMenuAnatomy.parentItem(),
                            parentItemClass
                          )}
                          aria-current={item.isCurrent ? 'page' : undefined}
                          data-current={item.isCurrent}
                          onClick={handleItemClick(item)}
                        >
                          <ItemContent {...item} />
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="24"
                            height="24"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className={cn(
                              VerticalMenuAnatomy.itemChevron({
                                size,
                                collapsed,
                              }),
                              itemChevronClass
                            )}
                          >
                            <polyline points="9 18 15 12 9 6"></polyline>
                          </svg>
                        </button>
                      </DisclosureTrigger>

                      <DisclosureContent
                        className={cn(
                          VerticalMenuAnatomy.subContent(),
                          subContentClass
                        )}
                      >
                        {item.subContent}
                      </DisclosureContent>
                    </DisclosureItem>
                  </Disclosure>
                )}
              </React.Fragment>
            );
          })}
        </__VerticalMenuContext.Provider>
      </nav>
    );
  }
);

VerticalMenu.displayName = 'VerticalMenu';
