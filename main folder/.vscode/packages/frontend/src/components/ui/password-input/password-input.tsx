import { cn } from '../core/styling';
import * as React from 'react';
import {
  BasicField,
  BasicFieldOptions,
  extractBasicFieldProps,
} from '../basic-field';
import {
  extractInputPartProps,
  InputAddon,
  InputAnatomy,
  InputContainer,
  InputIcon,
  InputStyling,
} from '../input';
import * as PasswordToggleField from '@radix-ui/react-password-toggle-field';
import { LuEye, LuEyeClosed } from 'react-icons/lu';

/* -------------------------------------------------------------------------------------------------
 * PasswordInput
 * -----------------------------------------------------------------------------------------------*/

export type PasswordInputProps = Omit<
  React.ComponentPropsWithRef<'input'>,
  'size' | 'type' | 'autoComplete'
> &
  InputStyling &
  BasicFieldOptions & {
    /**
     * Callback invoked when the value changes. Returns the string value.
     */
    onValueChange?: (value: string) => void;
    /**
     * The autoComplete attribute for the password input.
     * @default "current-password"
     */
    autoComplete?: 'current-password' | 'new-password';
  };

export const PasswordInput = React.forwardRef<
  HTMLInputElement,
  PasswordInputProps
>((props, ref) => {
  const [props1, basicFieldProps] = extractBasicFieldProps<PasswordInputProps>(
    props,
    React.useId()
  );

  const [
    {
      size,
      intent,
      leftAddon,
      leftIcon,
      rightAddon,
      rightIcon,
      className,
      onValueChange,
      onChange,
      autoComplete = 'current-password',
      ...rest
    },
    {
      inputContainerProps,
      leftAddonProps,
      leftIconProps,
      rightAddonProps,
      rightIconProps,
    },
  ] = extractInputPartProps<PasswordInputProps>({
    ...props1,
    size: props1.size ?? 'md',
    intent: props1.intent ?? 'basic',
    leftAddon: props1.leftAddon,
    leftIcon: props1.leftIcon,
    rightAddon: props1.rightAddon,
    rightIcon: props1.rightIcon,
  });

  const handleOnChange = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onValueChange?.(e.target.value);
      onChange?.(e);
    },
    [onValueChange, onChange]
  );

  return (
    <BasicField {...basicFieldProps}>
      <InputContainer {...inputContainerProps}>
        <InputAddon {...leftAddonProps} />
        <InputIcon {...leftIconProps} />

        <div className="relative flex-1">
          <PasswordToggleField.Root>
            <PasswordToggleField.Input
              id={basicFieldProps.id}
              name={basicFieldProps.name}
              className={cn(
                'form-input',
                InputAnatomy.root({
                  size,
                  intent,
                  hasError: !!basicFieldProps.error,
                  isDisabled: !!basicFieldProps.disabled,
                  isReadonly: !!basicFieldProps.readonly,
                  hasRightAddon: !!rightAddon,
                  hasRightIcon: !!rightIcon,
                  hasLeftAddon: !!leftAddon,
                  hasLeftIcon: !!leftIcon,
                }),
                className
              )}
              disabled={basicFieldProps.disabled || basicFieldProps.readonly}
              data-disabled={basicFieldProps.disabled}
              data-readonly={basicFieldProps.readonly}
              aria-readonly={basicFieldProps.readonly}
              required={basicFieldProps.required}
              onChange={handleOnChange}
              autoComplete={autoComplete}
              {...rest}
              ref={ref}
            />
            <PasswordToggleField.Toggle
              className={cn(
                'absolute right-0 top-0 h-full px-3',
                'text-muted-foreground hover:text-foreground',
                'focus:outline-none focus:ring-0',
                'disabled:opacity-50 disabled:pointer-events-none',
                'bg-transparent'
              )}
            >
              <PasswordToggleField.Icon
                visible={<LuEye className="h-6 w-6" />}
                hidden={<LuEyeClosed className="h-6 w-6" />}
              />
            </PasswordToggleField.Toggle>
          </PasswordToggleField.Root>
        </div>

        <InputAddon {...rightAddonProps} />
        <InputIcon {...rightIconProps} />
      </InputContainer>
    </BasicField>
  );
});

PasswordInput.displayName = 'PasswordInput';
