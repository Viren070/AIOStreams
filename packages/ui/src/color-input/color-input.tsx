import React from 'react';
import { colord } from 'colord';
import { HexColorPicker } from 'react-colorful';
import { Popover } from '../popover';
import { TextInput, type TextInputProps } from '../text-input';
import { cn } from '../core/styling';
import { uiText } from '../core/text';

export interface Swatch {
  value: string;
  name: string;
}

const defaultSwatches = (): Swatch[] => [
  { value: '#ffffff', name: uiText.white },
  { value: '#ffff00', name: uiText.yellow },
  { value: '#00ffff', name: uiText.cyan },
  { value: '#00ff00', name: uiText.green },
  { value: '#ff00ff', name: uiText.magenta },
  { value: '#ff0000', name: uiText.red },
  { value: '#0000ff', name: uiText.blue },
  { value: '#808080', name: uiText.grey },
  { value: '#000000', name: uiText.black },
];

export type ColorInputProps = Omit<
  TextInputProps,
  'value' | 'onValueChange' | 'rightAddon'
> & {
  /** A `#rrggbb` colour, or empty when `allowEmpty` lets it be unset. */
  value: string;
  onValueChange: (value: string) => void;
  /** Clearing the text unsets the colour, and a colour keeps its alpha. */
  allowEmpty?: boolean;
  /** The area to drag a colour on; leave it out where nothing can drag it, as on a TV. */
  picker?: boolean;
  /** Offered under the field; a general palette by default. */
  swatches?: readonly Swatch[];
};

const SWATCH =
  'size-7 flex-none rounded-full border border-white/25 ring-offset-2 ring-offset-[--paper] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white';

/** Stripes stand for no colour. */
const STRIPES =
  'bg-[repeating-linear-gradient(135deg,transparent_0_4px,rgb(255_255_255/0.15)_4px_8px)]';

const PREVIEW = cn(
  'size-7 rounded-[--radius-md] border border-white/20',
  STRIPES
);

/** A colour typed as hex, chosen from swatches, or picked; only valid colours reach `onValueChange`. */
export const ColorInput = React.forwardRef<HTMLInputElement, ColorInputProps>(
  (
    {
      value,
      onValueChange,
      allowEmpty,
      picker = true,
      swatches,
      onBlur,
      label,
      ...props
    },
    ref
  ) => {
    const [text, setText] = React.useState(value);
    React.useEffect(() => setText(value), [value]);

    const change = (next: string) => {
      setText(next);
      if (allowEmpty && !next.trim()) return onValueChange('');
      const color = colord(next);
      if (color.isValid())
        onValueChange(allowEmpty ? color.toHex() : color.toHex().slice(0, 7));
    };

    const current = value.toLowerCase();
    const options = [
      ...(allowEmpty ? [{ value: '', name: uiText.defaultColour }] : []),
      ...(swatches ?? defaultSwatches()),
    ];
    // One stop for the keys, on the chosen swatch, as a radio group has.
    const stop = Math.max(
      0,
      options.findIndex((s) => s.value.toLowerCase() === current)
    );
    const fill = value ? { background: value } : undefined;

    return (
      <div className="space-y-2">
        <TextInput
          {...props}
          ref={ref}
          label={label}
          value={text}
          onValueChange={change}
          onBlur={(e) => {
            setText(value);
            onBlur?.(e);
          }}
          rightAddon={
            picker ? (
              <Popover
                className="flex justify-center"
                trigger={
                  <button
                    type="button"
                    aria-label={uiText.pickColour}
                    className={cn(PREVIEW, 'cursor-pointer')}
                    style={fill}
                  />
                }
              >
                <HexColorPicker color={value || '#ffffff'} onChange={change} />
              </Popover>
            ) : (
              <span aria-hidden className={PREVIEW} style={fill} />
            )
          }
        />
        <div
          role="radiogroup"
          aria-label={typeof label === 'string' ? label : undefined}
          className="flex flex-wrap gap-2"
        >
          {options.map((swatch, index) => {
            const chosen = swatch.value.toLowerCase() === current;
            return (
              <button
                key={swatch.value || 'default'}
                type="button"
                role="radio"
                aria-checked={chosen}
                aria-label={swatch.name}
                tabIndex={index === stop ? 0 : -1}
                onClick={() => onValueChange(swatch.value)}
                className={cn(
                  SWATCH,
                  !swatch.value && STRIPES,
                  chosen && 'ring-2 ring-brand-500'
                )}
                style={swatch.value ? { background: swatch.value } : undefined}
              />
            );
          })}
        </div>
      </div>
    );
  }
);
ColorInput.displayName = 'ColorInput';
