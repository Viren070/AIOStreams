import * as React from 'react';
import { TextInput } from '@/components/ui/text-input';
import { parseDuration, formatDurationMs } from '@/lib/format';

export interface DurationInputProps {
  label?: React.ReactNode;
  help?: React.ReactNode;
  disabled?: boolean;
  /** Current value in milliseconds. */
  value: number;
  /** Called with the parsed millisecond value whenever the input is valid. */
  onValueChange: (ms: number) => void;
  placeholder?: string;
  /** Minimum allowed value in milliseconds (default 0). */
  min?: number;
}

/**
 * Controlled duration field that stores a raw millisecond number but lets the
 * user type a friendly string like `1.5s`, `500ms`, or `2s`. Surfaces a
 * validation error (without committing) for unparseable / out-of-range input.
 */
export function DurationInput({
  label,
  help,
  disabled,
  value,
  onValueChange,
  placeholder,
  min = 0,
}: DurationInputProps) {
  const [text, setText] = React.useState(() => formatDurationMs(value));
  const [err, setErr] = React.useState<string | null>(null);

  // Resync when the value changes upstream, unless the current text already
  // represents it (avoids clobbering what the user is typing).
  React.useEffect(() => {
    if (parseDuration(text) !== value) {
      setText(formatDurationMs(value));
      setErr(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <TextInput
      label={label}
      help={help}
      error={err ?? undefined}
      disabled={disabled}
      value={text}
      placeholder={placeholder ?? 'e.g. "1.5s", "500ms", "2s"'}
      onValueChange={(v) => {
        setText(v);
        const ms = parseDuration(v);
        if (ms == null || ms < min) {
          setErr('Invalid duration. Use e.g. 500ms, 1.5s, 2s, 1m.');
        } else {
          setErr(null);
          onValueChange(ms);
        }
      }}
    />
  );
}
