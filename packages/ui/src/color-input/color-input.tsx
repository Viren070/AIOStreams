import React from 'react';
import { colord } from 'colord';
import { HexColorPicker } from 'react-colorful';
import { Popover } from '../popover';
import { TextInput, type TextInputProps } from '../text-input';

export type ColorInputProps = Omit<
  TextInputProps,
  'value' | 'onValueChange' | 'rightAddon'
> & {
  /** A `#rrggbb` colour. */
  value: string;
  onValueChange: (value: string) => void;
};

/** A colour typed as hex or picked; only valid colours reach `onValueChange`. */
export const ColorInput = React.forwardRef<HTMLInputElement, ColorInputProps>(
  ({ value, onValueChange, onBlur, ...props }, ref) => {
    const [text, setText] = React.useState(value);
    React.useEffect(() => setText(value), [value]);

    const change = (next: string) => {
      setText(next);
      const color = colord(next);
      if (color.isValid()) onValueChange(color.toHex().slice(0, 7));
    };

    return (
      <TextInput
        {...props}
        ref={ref}
        value={text}
        onValueChange={change}
        onBlur={(e) => {
          setText(value);
          onBlur?.(e);
        }}
        rightAddon={
          <Popover
            className="flex justify-center"
            trigger={
              <button
                type="button"
                aria-label="Pick a colour"
                className="size-7 cursor-pointer rounded-[--radius-md] border border-white/20"
                style={{ backgroundColor: value }}
              />
            }
          >
            <HexColorPicker color={value} onChange={change} />
          </Popover>
        }
      />
    );
  }
);
ColorInput.displayName = 'ColorInput';
