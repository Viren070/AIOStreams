import React, { useMemo } from 'react';
import CodeMirror, { EditorView } from '@uiw/react-codemirror';
import { placeholder as placeholderExtension } from '@codemirror/view';
import { UserData } from '@aiostreams/core';
import { cn } from '@aiostreams/ui/core/styling';
import { formatterTheme } from '../../../formatter/editor/formatter-theme.js';
import { celHighlight, celTheme } from './cel-highlight.js';
import { celLinter } from './cel-lint.js';
import { celCompletion } from './cel-complete.js';
import type { CelLimits } from '../../../../../../../core/src/variants/language';

export interface CelEditorProps {
  value: string;
  onValueChange: (value: string) => void;
  limits: CelLimits;
  userData: UserData;
  currentVariantId: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  initialHeight?: string;
}

/**
 * CodeMirror editor for the Config Expression Language. All language behaviour
 * comes from `@aiostreams/core`; nothing about the grammar is duplicated here.
 */
export function CelEditor({
  value,
  onValueChange,
  limits,
  userData,
  currentVariantId,
  placeholder,
  disabled,
  className,
  initialHeight = '14rem',
}: CelEditorProps) {
  const extensions = useMemo(
    () => [
      celHighlight,
      celTheme,
      celLinter(limits),
      celCompletion({ userData, currentVariantId }),
      EditorView.lineWrapping,
      placeholderExtension(placeholder ?? ''),
    ],
    [limits, userData, currentVariantId, placeholder]
  );

  return (
    <div
      style={{ height: initialHeight, minHeight: '8rem' }}
      className={cn(
        'w-full rounded-[--radius] border border-[--border] bg-[--paper] shadow-sm overflow-hidden transition',
        'resize-y',
        'focus-within:ring-1 focus-within:ring-[--ring] focus-within:border-brand',
        disabled && 'opacity-60 pointer-events-none',
        className
      )}
    >
      <CodeMirror
        className="h-full"
        value={value}
        onChange={onValueChange}
        editable={!disabled}
        theme={formatterTheme}
        indentWithTab={false}
        height="100%"
        basicSetup={{
          lineNumbers: true,
          foldGutter: false,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
          autocompletion: false,
          bracketMatching: true,
          closeBrackets: true,
          searchKeymap: false,
          highlightSelectionMatches: false,
          indentOnInput: false,
          drawSelection: true,
        }}
        extensions={extensions}
      />
    </div>
  );
}
