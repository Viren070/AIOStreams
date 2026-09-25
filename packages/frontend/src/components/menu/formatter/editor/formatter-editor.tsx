import React, { useMemo, useRef } from 'react';
import CodeMirror, {
  EditorView,
  ReactCodeMirrorRef,
} from '@uiw/react-codemirror';
import { placeholder as placeholderExtension } from '@codemirror/view';
import { cn } from '@aiostreams/ui/core/styling';
import { formatterTheme } from './formatter-theme.js';
import { formatterHighlight } from './formatter-highlight.js';
import { formatterLinter } from './formatter-lint.js';
import { formatterCompletion } from './formatter-complete.js';

export interface FormatterEditorProps {
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** starting height; the user can drag the corner to resize from here */
  initialHeight?: string;
  minHeight?: string;
  /** reports the editor view when it gains focus (for snippet insertion) */
  onFocusView?: (view: EditorView) => void;
  /** reports the editor view once it is created (for the outline's go-to) */
  onViewReady?: (view: EditorView) => void;
}

/**
 * A CodeMirror editor for the custom-formatter template language. Drop-in
 * replacement for the plain `<Textarea>`: exposes the same controlled
 * `value` / `onValueChange` string contract. All language behaviour comes from
 * the engine (@aiostreams/core); nothing about the grammar is duplicated here.
 */
export function FormatterEditor({
  value,
  onValueChange,
  placeholder,
  disabled,
  className,
  initialHeight = '11rem',
  minHeight = '6rem',
  onFocusView,
  onViewReady,
}: FormatterEditorProps) {
  const ref = useRef<ReactCodeMirrorRef>(null);
  const onFocusRef = useRef(onFocusView);
  onFocusRef.current = onFocusView;

  const extensions = useMemo(
    () => [
      formatterHighlight,
      formatterLinter,
      formatterCompletion,
      EditorView.lineWrapping,
      placeholderExtension(placeholder ?? ''),
      EditorView.domEventHandlers({
        focus: (_event, view) => {
          onFocusRef.current?.(view);
          return false;
        },
      }),
    ],
    [placeholder]
  );

  return (
    <div
      style={{ height: initialHeight, minHeight }}
      className={cn(
        'w-full rounded-[--radius] border border-[--border] bg-[--paper] shadow-sm overflow-hidden transition',
        'resize-y', // drag the corner to grow, like a textarea
        'focus-within:ring-1 focus-within:ring-[--ring] focus-within:border-brand',
        disabled && 'opacity-60 pointer-events-none',
        className
      )}
    >
      <CodeMirror
        ref={ref}
        className="h-full"
        value={value}
        onChange={onValueChange}
        onCreateEditor={(view) => onViewReady?.(view)}
        editable={!disabled}
        theme={formatterTheme}
        indentWithTab={false}
        height="100%"
        basicSetup={{
          lineNumbers: false,
          foldGutter: false,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
          autocompletion: false,
          bracketMatching: true,
          closeBrackets: true,
          searchKeymap: false,
          highlightSelectionMatches: false,
          indentOnInput: false,
          // native selection stops at the last character instead of filling to
          // the line's right edge across a multi-line selection
          drawSelection: false,
        }}
        extensions={extensions}
      />
    </div>
  );
}
