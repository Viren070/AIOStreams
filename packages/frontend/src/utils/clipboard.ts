interface CopyOptions {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

/**
 * Temporarily clears the user's current document selection to prevent it from
 * interfering with the hidden text selection used during the execCommand fallback.
 * Returns a cleanup function to restore their original selection.
 */
function deselectCurrent(): () => void {
  const selection = document.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return () => {};
  }

  let active = document.activeElement as HTMLElement | null;
  const ranges: Range[] = [];
  for (let i = 0; i < selection.rangeCount; i++) {
    ranges.push(selection.getRangeAt(i));
  }

  switch (active?.tagName?.toUpperCase()) {
    case 'INPUT':
    case 'TEXTAREA':
      (active as HTMLInputElement | HTMLTextAreaElement).blur();
      break;
    default:
      active = null;
      break;
  }

  selection.removeAllRanges();
  return () => {
    if (selection.type === 'Caret') selection.removeAllRanges();
    if (selection.rangeCount === 0) {
      ranges.forEach((range) => selection.addRange(range));
    }
    if (active) {
      active.focus();
    }
  };
}

/**
 * Copies text to the clipboard using a multi-tiered fallback strategy to ensure
 * cross-browser compatibility (Clipboard API -> execCommand -> IE11 -> Prompt).
 */
export async function copyToClipboard(
  text: string,
  options: CopyOptions = {}
): Promise<void> {
  const { onSuccess, onError } = options;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      onSuccess?.();
      return;
    } catch (err) {
      // Allow execution to cascade into fallback methods
    }
  }

  let reselectPrevious: (() => void) | null = null;
  let range: Range | null = null;
  let selection: Selection | null = null;
  let mark: HTMLSpanElement | null = null;

  try {
    reselectPrevious = deselectCurrent();

    range = document.createRange();
    selection = document.getSelection();

    if (!selection) {
      throw new Error('Unable to get document selection');
    }

    mark = document.createElement('span');
    mark.textContent = text;

    // Accessibility: Prevent screen readers from announcing the hidden copy payload
    mark.setAttribute('aria-hidden', 'true');

    mark.style.all = 'unset';
    mark.style.position = 'fixed';
    mark.style.top = '0';
    mark.style.clip = 'rect(0, 0, 0, 0)';
    mark.style.whiteSpace = 'pre';

    mark.style.userSelect = 'text';
    (mark.style as unknown as Record<string, string>).MozUserSelect = 'text';
    (mark.style as unknown as Record<string, string>).msUserSelect = 'text';
    mark.style.userSelect = 'text';

    mark.addEventListener('copy', (e: ClipboardEvent) => {
      e.stopPropagation();
    });

    document.body.appendChild(mark);

    range.selectNodeContents(mark);
    selection.addRange(range);

    const successful = document.execCommand('copy');
    if (!successful) {
      throw new Error('copy command was unsuccessful');
    }
  } catch (err) {
    try {
      (
        window as unknown as Window & {
          clipboardData: { setData(format: string, data: string): void };
        }
      ).clipboardData.setData('text', text);
    } catch (err2) {
      const copyKey =
        (/mac os x/i.test(navigator.userAgent) ? '⌘' : 'Ctrl') + '+C';
      window.prompt(`Copy to clipboard: ${copyKey}, Enter`, text);

      const error = new Error('Copy failed - user prompt shown');
      onError?.(error);
      return;
    }
  } finally {
    if (selection) {
      if (typeof selection.removeRange === 'function' && range) {
        selection.removeRange(range);
      } else {
        selection.removeAllRanges();
      }
    }

    if (mark) {
      document.body.removeChild(mark);
    }

    reselectPrevious?.();
  }
  onSuccess?.();
}
