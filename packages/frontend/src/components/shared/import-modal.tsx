'use client';
import { useRef, useState } from 'react';
import { Modal } from '../ui/modal';
import { Button } from '../ui/button';
import { TextInput } from '../ui/text-input';
import { useDisclosure } from '@/hooks/disclosure';
import { toast } from 'sonner';

export interface ImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (data: any) => void;
}

export function ImportModal({
  open,
  onOpenChange,
  onImport,
}: ImportModalProps) {
  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const urlModalDisclosure = useDisclosure(false);
  const [url, setUrl] = useState('');

  const handleFileImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const data = JSON.parse(content);
        onImport(data);
        onOpenChange(false);
      } catch (error) {
        console.error('Error importing file:', error);
        toast.error('Failed to parse JSON file');
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleUrlImport = async () => {
    if (!url) {
      toast.error('Please enter a URL');
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('Failed to fetch URL');
      }
      const data = await response.json();
      onImport(data);
      urlModalDisclosure.close();
      onOpenChange(false);
    } catch (error) {
      console.error('Error importing from URL:', error);
      toast.error('Failed to import from URL');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <Modal open={open} onOpenChange={onOpenChange} title="Import">
        <div className="space-y-4">
          <div className="flex flex-col gap-4">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileImport}
              accept=".json"
              className="hidden"
            />
            <Button
              intent="primary"
              onClick={() => fileInputRef.current?.click()}
              className="w-full"
            >
              Import from File
            </Button>
            <Button
              intent="primary"
              onClick={urlModalDisclosure.open}
              className="w-full"
            >
              Import from URL
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={urlModalDisclosure.isOpen}
        onOpenChange={urlModalDisclosure.close}
        title="Import from URL"
      >
        <div className="space-y-4">
          <TextInput
            label="URL"
            value={url}
            onValueChange={setUrl}
            placeholder="Enter URL to JSON file"
          />
          <div className="flex justify-end gap-2">
            <Button intent="primary-outline" onClick={urlModalDisclosure.close}>
              Cancel
            </Button>
            <Button
              intent="primary"
              onClick={handleUrlImport}
              loading={isLoading}
            >
              Import
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
