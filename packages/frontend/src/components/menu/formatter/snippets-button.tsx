import { SNIPPETS } from '../../../../../core/src/utils/constants';
import { useDisclosure } from '@aiostreams/ui/hooks/disclosure';
import { Button } from '@aiostreams/ui/button';
import { Modal } from '@aiostreams/ui/modal';
import { CopyIcon, PlusIcon } from 'lucide-react';
import { toast } from 'sonner';
import { copyToClipboard } from '@aiostreams/ui/utils/clipboard';

export function SnippetsButton({
  onInsert,
}: {
  /** Insert a snippet at the focused editor's caret. Falls back to copy. */
  onInsert?: (value: string) => boolean;
}) {
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
              <div className="flex gap-2 sm:ml-4 flex-shrink-0">
                {onInsert && (
                  <Button
                    size="sm"
                    intent="primary"
                    onClick={() => {
                      if (onInsert(snippet.value)) {
                        toast.success('Snippet inserted');
                        disclosure.close();
                      } else {
                        toast.message('Click into a template first');
                      }
                    }}
                    title="Insert at cursor"
                  >
                    <PlusIcon className="w-5 h-5" />
                  </Button>
                )}
                <Button
                  size="sm"
                  intent="primary-outline"
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
            </div>
          ))}
        </div>
      </Modal>
    </>
  );
}
