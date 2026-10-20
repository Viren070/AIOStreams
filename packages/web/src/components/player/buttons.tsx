import React from 'react';
import { Button, type ButtonProps } from '@aiostreams/ui/button';
import { cn } from '@aiostreams/ui/core/styling';
import { Tooltip } from '@aiostreams/ui/tooltip';
import { currentHost } from '../../lib/hosts';

const FOCUS_FILL =
  '[html:not([data-pointer-focus])_&:focus-visible]:shadow-[inset_0_0_0_var(--control)_white] [html:not([data-pointer-focus])_&:focus-visible]:text-black';

type IconButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Stays the same as the label changes, for custom CSS. */
  name: string;
  label: string;
};

/** Whether the controls show; a tooltip left open over a resting pointer goes with them. */
export const ControlsShown = React.createContext(true);

export function ControlButton({
  name,
  label,
  className,
  ...props
}: IconButtonProps) {
  const shown = React.useContext(ControlsShown);
  const [open, setOpen] = React.useState(false);
  if (open && !shown) setOpen(false);
  return (
    <Tooltip
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button
          type="button"
          data-ui="player-button"
          data-name={name}
          data-focus="own"
          aria-label={label}
          className={cn(
            'flex size-[var(--control)] flex-none items-center justify-center rounded-full text-[length:var(--icon)] text-white/85 transition hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-40',
            FOCUS_FILL,
            className
          )}
          {...props}
        />
      }
    >
      {label}
    </Tooltip>
  );
}

export function MiddleButton({
  name,
  label,
  big = false,
  className,
  ...props
}: IconButtonProps & { big?: boolean }) {
  return (
    <button
      type="button"
      data-ui="player-middle-button"
      data-name={name}
      aria-label={label}
      title={label}
      className={cn(
        'pointer-events-auto flex flex-none items-center justify-center rounded-full transition-opacity duration-300 disabled:text-white/30',
        big ? 'size-16 bg-black/50 text-3xl' : 'size-12 bg-black/40 text-2xl',
        className
      )}
      {...props}
    />
  );
}

export function PlayerAction({
  primary = false,
  className,
  ...props
}: Omit<ButtonProps, 'intent'> & { primary?: boolean }) {
  const tv = !!currentHost().tv;
  return (
    <Button
      intent={tv ? 'white-outline' : primary ? 'white' : 'gray-outline'}
      data-focus={tv ? 'own' : undefined}
      className={cn(
        'rounded-full',
        tv &&
          'bg-black/50 backdrop-blur-sm focus-visible:border-white focus-visible:bg-white focus-visible:text-black',
        className
      )}
      {...props}
    />
  );
}
