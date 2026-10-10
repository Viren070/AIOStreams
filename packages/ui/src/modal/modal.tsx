import * as DialogPrimitive from '@radix-ui/react-dialog';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { cva } from 'class-variance-authority';
import * as React from 'react';
import { CloseButton } from '../button';
import { cn, ComponentAnatomy, defineStyleAnatomy } from '../core/styling';
import { keepsModalOpen } from '../core/utils';

/* -------------------------------------------------------------------------------------------------
 * Anatomy
 * -----------------------------------------------------------------------------------------------*/

export const ModalAnatomy = defineStyleAnatomy({
  overlay: cva([
    'UI-Modal__overlay',
    'fixed inset-0 w-screen z-50 bg-black/80',
    // A layer that outlives the fade, which an Android web view draws empty for a frame as it ends.
    'will-change-[opacity]',
    'data-[state=open]:animate-in data-[state=closed]:animate-out',
    'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
    // "overflow-y-auto p-0 md:p-4 grid place-items-center",
  ]),
  content: cva(
    [
      'UI-Modal__content',
      'z-50 grid relative w-full w-full shadow-xl border border-[rgb(255_255_255_/_5%)] max-w-lg gap-4 bg-[--paper] p-6 duration-200',
      // A column no wider than the box, which unwrapped text would widen past it.
      'grid-cols-[minmax(0,1fr)]',
      'will-change-[opacity,transform]',
      'data-[state=open]:animate-in data-[state=closed]:animate-out',
      'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
    ],
    {
      variants: {
        side: {
          center: [
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
            'sm:rounded-2xl',
          ],
          right: [
            'h-full max-w-md border-y-0 border-r-0 duration-300',
            'data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right',
            'pr-[env(safe-area-inset-right)]',
          ],
        },
      },
      defaultVariants: { side: 'center' },
    }
  ),
  close: cva(['UI-Modal__close', 'absolute right-4 top-4 !mt-0']),
  header: cva([
    'UI-Modal__header',
    'flex flex-col space-y-1.5 min-w-0 text-center sm:text-left',
  ]),
  footer: cva([
    'UI-Modal__footer',
    'flex flex-col-reverse gap-2 sm:flex-row sm:justify-end',
  ]),
  title: cva([
    'UI-Modal__title',
    'text-xl font-semibold leading-snug tracking-tight break-words',
  ]),
  description: cva(['UI-Modal__description', 'text-sm text-[--muted]']),
});

/* -------------------------------------------------------------------------------------------------
 * Modal
 * -----------------------------------------------------------------------------------------------*/

export type ModalProps = Omit<
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Root>,
  'modal'
> &
  Pick<
    React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
    | 'onOpenAutoFocus'
    | 'onCloseAutoFocus'
    | 'onEscapeKeyDown'
    | 'onPointerDownCapture'
    | 'onInteractOutside'
  > &
  ComponentAnatomy<typeof ModalAnatomy> & {
    /**
     * Interaction with outside elements will be enabled and other elements will be visible to screen readers.
     */
    allowOutsideInteraction?: boolean;
    /**
     * The button that opens the modal
     */
    trigger?: React.ReactElement;
    /**
     * Title of the modal
     */
    title?: React.ReactNode;
    /**
     * An optional accessible description to be announced when the dialog is opened.
     */
    description?: React.ReactNode;
    /**
     * Footer of the modal
     */
    footer?: React.ReactNode;
    /**
     * Optional replacement for the default close button
     */
    closeButton?: React.ReactElement;
    /**
     * Whether to hide the close button
     */
    hideCloseButton?: boolean;
    side?: 'center' | 'right';
  };

export function Modal(props: ModalProps) {
  const {
    allowOutsideInteraction = false,
    trigger,
    title,
    footer,
    description,
    children,
    closeButton,
    overlayClass,
    contentClass,
    closeClass,
    headerClass,
    footerClass,
    titleClass,
    descriptionClass,
    hideCloseButton,
    side = 'center',
    // Content
    onOpenAutoFocus,
    onCloseAutoFocus,
    onEscapeKeyDown,
    onPointerDownCapture,
    onInteractOutside,
    ...others
  } = props;
  // The root renders no element, so `data-*` attributes go on the dialog box.
  const rest: Record<string, unknown> = {};
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(others)) {
    (key.startsWith('data-') ? data : rest)[key] = value;
  }

  // Radix judges an outside press at `click`, after it may have closed the
  // layer it hit (a Select, or a dialog above), so snapshot at `pointerdown`.
  const innerLayerWasOpenRef = React.useRef(false);

  return (
    <DialogPrimitive.Root modal={!allowOutsideInteraction} {...rest}>
      {trigger && (
        <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>
      )}

      <DialogPrimitive.Portal>
        <InnerLayerSnapshotter targetRef={innerLayerWasOpenRef} />
        <DialogPrimitive.Overlay
          className={cn(
            ModalAnatomy.overlay(),
            side === 'right' && 'bg-black/50',
            overlayClass
          )}
        >
          <div
            className={cn(
              side === 'right'
                ? 'absolute inset-0 flex justify-end'
                : 'overflow-y-auto absolute inset-0 grid place-items-center p-0 md:p-4',
              side === 'center' &&
                process.env.NEXT_PUBLIC_PLATFORM === 'desktop' &&
                'md:p-8'
            )}
          >
            <DialogPrimitive.Content
              {...data}
              className={cn(ModalAnatomy.content({ side }), contentClass)}
              onOpenAutoFocus={onOpenAutoFocus}
              onCloseAutoFocus={onCloseAutoFocus}
              onEscapeKeyDown={onEscapeKeyDown}
              onPointerDownCapture={onPointerDownCapture}
              onInteractOutside={(e) => {
                if (keepsModalOpen(e.target)) {
                  e.preventDefault();
                  return;
                }
                if (innerLayerWasOpenRef.current) {
                  innerLayerWasOpenRef.current = false;
                  e.preventDefault();
                  return;
                }
                onInteractOutside?.(e);
              }}
            >
              {!title && !description ? (
                <VisuallyHidden>
                  <DialogPrimitive.Title>Dialog</DialogPrimitive.Title>
                </VisuallyHidden>
              ) : (
                <div className={cn(ModalAnatomy.header(), headerClass)}>
                  <DialogPrimitive.Title
                    className={cn(ModalAnatomy.title(), titleClass)}
                  >
                    {title}
                  </DialogPrimitive.Title>
                  {description && (
                    <DialogPrimitive.Description
                      className={cn(
                        ModalAnatomy.description(),
                        descriptionClass
                      )}
                    >
                      {description}
                    </DialogPrimitive.Description>
                  )}
                </div>
              )}

              {children}

              {footer && (
                <div className={cn(ModalAnatomy.footer(), footerClass)}>
                  {footer}
                </div>
              )}

              {!hideCloseButton && (
                <DialogPrimitive.Close
                  className={cn(ModalAnatomy.close(), closeClass)}
                  asChild
                >
                  {closeButton ? closeButton : <CloseButton />}
                </DialogPrimitive.Close>
              )}
            </DialogPrimitive.Content>
          </div>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

Modal.displayName = 'Modal';

// Matches Radix layers that use a `DismissableLayer` with
// `disableOutsidePointerEvents` (Select, DropdownMenu, ContextMenu, Popover).
// Tooltip is excluded — it has no dismissable layer and matching it would
// swallow legitimate modal-overlay taps when a tooltip happens to be visible.
const INNER_LAYER_SELECTOR =
  '[role="listbox"][data-state="open"],' +
  '[role="menu"][data-state="open"],' +
  '[data-radix-popper-content-wrapper]:not(:has([role="tooltip"]))';

// Read only on an outside press, so a match is another dialog.
const DIALOG_SELECTOR = '[role="dialog"], [role="alertdialog"]';

function InnerLayerSnapshotter({
  targetRef,
}: {
  targetRef: React.RefObject<boolean>;
}) {
  React.useEffect(() => {
    const handler = (e: PointerEvent) => {
      targetRef.current =
        !!document.querySelector(INNER_LAYER_SELECTOR) ||
        (e.target instanceof Element && !!e.target.closest(DIALOG_SELECTOR));
    };
    document.addEventListener('pointerdown', handler, true);
    return () => document.removeEventListener('pointerdown', handler, true);
  }, [targetRef]);
  return null;
}
