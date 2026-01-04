import { toast } from 'sonner';

type CopyOptions = {
  successMessage?: string;
  errorMessage?: string;
  description?: string;
};

export async function copyToClipboard(text: string, options: CopyOptions = {}) {
  const {
    successMessage = 'Copied to clipboard',
    errorMessage = 'Failed to copy to clipboard',
    description,
  } = options;

  try {
    console.log('Attempting to copy to clipboard:', text);
    if (typeof navigator === 'undefined') {
      throw new Error('Navigator is not available');
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      toast.success(successMessage, description ? { description } : undefined);
      return { success: true as const };
    }

    console.warn('Clipboard API not available, falling back to execCommand');

    // Fallback for environments where Clipboard API is unavailable (e.g., http:, some iframes)
    const textarea = document.createElement('textarea');
    textarea.value = text;
    // Prevent scrolling to bottom on iOS
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    const successful = document.execCommand('copy');
    console.log('execCommand copy result:', successful);
    document.body.removeChild(textarea);

    if (!successful) {
      throw new Error('execCommand copy failed');
    }

    toast.success(successMessage, description ? { description } : undefined);
    return { success: true as const };
  } catch (error) {
    console.error('Error copying to clipboard:', error);
    toast.error(errorMessage);
    return { success: false as const, error: error as unknown };
  }
}
