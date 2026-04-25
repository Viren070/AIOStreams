'use client';
import { SNIPPETS } from '../../../../../core/src/utils/constants';
import { useDisclosure } from '@/hooks/disclosure';
import { Button } from '../../ui/button';
import { Modal } from '@/components/ui/modal';
import { CopyIcon } from 'lucide-react';
import { toast } from 'sonner';
import { copyToClipboard } from '@/utils/clipboard';

export function SnippetsButton() {
  const disclosure = useDisclosure(false);

  return (
    <>
      <Button intent="white" size="sm" onClick={disclosure.open}>
        Snippets
      </Button>
      <Modal
        open={disclosure.isOpen}
        onOpenChange={disclosure.close}
        title="Formatter Snippets"
      >
        <div className="space-y-4">
          {SNIPPETS.map((snippet, idx) => (
            <div
              key={idx}
              className="flex flex-col sm:flex-row sm:items-center sm:justify-between border rounded-md p-3 bg-gray-900 border-gray-800 gap-3"
            >
              <div>
                <div className="font-semibold text-base mb-1">
                  {snippet.name}
                </div>
                <div className="text-sm text-muted-foreground mb-1 break-words">
                  {snippet.description}
                </div>
                <div className="font-mono text-xs bg-gray-800 rounded px-2 py-1 inline-block break-all">
                  {snippet.value}
                </div>
              </div>
              <Button
                size="sm"
                intent="primary-outline"
                className="sm:ml-4 flex-shrink-0"
                onClick={async () => {
                  await copyToClipboard(snippet.value, {
                    onSuccess: () =>
                      toast.success('Snippet copied to clipboard'),
                    onError: () =>
                      toast.error('Failed to copy snippet to clipboard'),
                  });
                }}
                title="Copy snippet"
              >
                <CopyIcon className="w-5 h-5" />
              </Button>
            </div>
          ))}
        </div>
      </Modal>
    </>
  );
}
