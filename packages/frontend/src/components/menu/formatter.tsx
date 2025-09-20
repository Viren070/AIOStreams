'use client';
import { PageWrapper } from '../shared/page-wrapper';

import * as constants from '../../../../core/src/utils/constants';
import { ParsedStream } from '../../../../core/src/db/schemas';
import React, { useState, useEffect, useCallback } from 'react';
import { useUserData } from '@/context/userData';
import { SettingsCard } from '../shared/settings-card';
import { Textarea } from '../ui/textarea';
import { Select } from '../ui/select';
import { Switch } from '../ui/switch';
import { TextInput } from '../ui/text-input';
import FileParser from '../../../../core/src/parser/file';
import { UserConfigAPI } from '@/services/api';
import { SNIPPETS } from '../../../../core/src/utils/constants';
import { Modal } from '@/components/ui/modal';
import { useDisclosure } from '@/hooks/disclosure';
import { Button } from '../ui/button';
import { CopyIcon } from 'lucide-react';
import { toast } from 'sonner';
import { NumberInput } from '../ui/number-input';
import { PageControls } from '../shared/page-controls';
import { Tooltip } from '../ui/tooltip';
import { FaFileImport, FaFileExport } from 'react-icons/fa';
import { IconButton } from '../ui/button';
import { ImportModal } from '../shared/import-modal';
const formatterChoices = Object.values(constants.FORMATTER_DETAILS);

// Remove the throttle utility and replace with FormatQueue
class FormatQueue {
  private queue: (() => Promise<void>)[] = [];
  private processing = false;
  private readonly delay: number;

  constructor(delay: number) {
    this.delay = delay;
  }

  enqueue(formatFn: () => Promise<void>) {
    // Replace any existing queued format request with the new one
    this.queue = [formatFn];
    this.process();
  }

  private async process() {
    if (this.processing) return;

    this.processing = true;
    while (this.queue.length > 0) {
      const formatFn = this.queue.shift();
      if (formatFn) {
        try {
          await formatFn();
        } catch (error) {
          console.error('Error in format queue:', error);
        }
        // Wait for the specified delay before processing the next request
        await new Promise((resolve) => setTimeout(resolve, this.delay));
      }
    }
    this.processing = false;
  }
}

export function FormatterMenu() {
  return (
    <>
      <PageWrapper className="space-y-4 p-4 sm:p-8">
        <Content />
      </PageWrapper>
    </>
  );
}

function FormatterPreviewBox({
  name,
  description,
}: {
  name?: string;
  description?: string;
}) {
  return (
    <div className="bg-gray-900 rounded-md p-4 border border-gray-800">
      <div
        className="text-xl font-bold mb-1 overflow-x-auto"
        style={{ whiteSpace: 'pre' }}
      >
        {name}
      </div>
      <div
        className="text-base text-muted-foreground overflow-x-auto"
        style={{ whiteSpace: 'pre' }}
      >
        {description}
      </div>
    </div>
  );
}

function Content() {
  const { userData, setUserData } = useUserData();
  const importModalDisclosure = useDisclosure(false);

  const [formattedStream, setFormattedStream] = useState<{
    name: string;
    description: string;
  } | null>(null);
  const [isFormatting, setIsFormatting] = useState(false);

  const handleImport = (data: any) => {
    if (typeof data.name === 'string' && typeof data.description === 'string') {
      handleFormatterChange(
        constants.CUSTOM_FORMATTER,
        data.name,
        data.description
      );
      toast.success('Formatter imported successfully');
    } else {
      toast.error('Invalid formatter format');
    }
  };

  const handleExport = () => {
    const data = {
      name: userData.formatter.definition?.name || '',
      description: userData.formatter.definition?.description || '',
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'custom-formatter.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('Formatter exported successfully');
  };

  // Create format queue ref to persist between renders
  const formatQueueRef = React.useRef<FormatQueue>(new FormatQueue(200));

  // Stream preview state
  const [filename, setFilename] = useState(
    'Movie.Title.2023.2160p.BluRay.HEVC.DV.TrueHD.Atmos.7.1.iTA.ENG-GROUP.mkv'
  );
  const [folder, setFolder] = useState(
    'Movie.Title.2023.2160p.BluRay.HEVC.DV.TrueHD.Atmos.7.1.iTA.ENG-GROUP'
  );
  const [indexer, setIndexer] = useState('RARBG');
  const [seeders, setSeeders] = useState<number | undefined>(125);
  const [age, setAge] = useState<string>('10d');
  const [addonName, setAddonName] = useState('Torrentio');
  const [providerId, setProviderId] = useState<constants.ServiceId | 'none'>(
    'none'
  );
  const [isCached, setIsCached] = useState(true);
  const [type, setType] =
    useState<(typeof constants.STREAM_TYPES)[number]>('debrid');
  const [library, setLibrary] = useState(false);
  const [duration, setDuration] = useState<number | undefined>(9120000); // 2h 32m in milliseconds
  const [fileSize, setFileSize] = useState<number | undefined>(62500000000); // 58.2 GB in bytes
  const [folderSize, setFolderSize] = useState<number | undefined>(
    125000000000
  ); // 116.4 GB in bytes
  const [proxied, setProxied] = useState(false);
  const [regexMatched, setRegexMatched] = useState<string | undefined>(
    undefined
  );
  const [message, setMessage] = useState('This is a message');

  const handleFormatterChange = (
    formatterId?: string,
    name?: string,
    description?: string
  ) => {
    setUserData((prev) => ({
      ...prev,
      formatter: {
        ...prev.formatter,
        id: (formatterId || prev.formatter.id) as constants.FormatterType,
        definition: {
          name: name ?? prev.formatter.definition?.name ?? '',
          description:
            description ?? prev.formatter.definition?.description ?? '',
        },
      },
    }));
  };

  const formatStream = useCallback(async () => {
    if (isFormatting) return;

    try {
      setIsFormatting(true);
      const parsedFile = FileParser.parse(filename);
      const stream: ParsedStream = {
        id: 'preview',
        type,
        addon: {
          name: addonName,
          preset: {
            type: 'custom',
            id: 'custom',
            options: {},
          },
          enabled: true,
          manifestUrl: 'http://localhost:2000/manifest.json',
          timeout: 10000,
        },
        library,
        parsedFile,
        filename,
        folderName: folder,
        folderSize,
        indexer,
        regexMatched: {
          name: regexMatched,
          index: 0,
        },
        torrent: {
          infoHash: type === 'p2p' ? '1234567890' : undefined,
          seeders,
        },
        service:
          providerId === 'none'
            ? undefined
            : {
                id: providerId,
                cached: isCached,
              },
        age,
        duration,
        size: fileSize,
        proxied,
        message,
      };
      const data = await UserConfigAPI.formatStream(stream, userData);
      if (!data.success) {
        throw new Error(data.error?.message || 'Failed to format stream');
      }
      setFormattedStream(data.data ?? null);
    } catch (error) {
      console.error('Error formatting stream:', error);
      toast.error(`Failed to format stream: ${error}`);
    } finally {
      setIsFormatting(false);
    }
  }, [
    filename || undefined,
    folder || undefined,
    indexer,
    seeders,
    age,
    addonName,
    providerId,
    isCached,
    type,
    library,
    duration,
    fileSize,
    folderSize,
    proxied,
    isFormatting,
    regexMatched,
    message,
    userData,
  ]);

  useEffect(() => {
    formatQueueRef.current.enqueue(formatStream);
  }, [
    filename,
    folder,
    indexer,
    seeders,
    age,
    addonName,
    providerId,
    isCached,
    type,
    library,
    duration,
    fileSize,
    folderSize,
    proxied,
    regexMatched,
    userData,
    message,
  ]);

  return (
    <>
      <div className="flex items-center w-full">
        <div>
          <h2>Formatter</h2>
          <p className="text-[--muted]">Format your streams to your liking.</p>
        </div>
        <div className="hidden lg:block lg:ml-auto">
          <PageControls />
        </div>
      </div>

      {/* Formatter Selection in its own SettingsCard */}
      <SettingsCard
        title="Formatter Selection"
        description="Choose how your streams should be formatted"
      >
        <Select
          value={userData.formatter.id}
          onValueChange={(value) =>
            handleFormatterChange(value as constants.FormatterType)
          }
          options={formatterChoices.map((f) => ({
            label: f.name,
            value: f.id,
          }))}
        />
        <p className="text-sm text-muted-foreground mt-2">
          {userData.formatter.id !== constants.CUSTOM_FORMATTER &&
            formatterChoices.find((f) => f.id === userData.formatter.id)
              ?.description}
        </p>
      </SettingsCard>

      {/* Custom Formatter Definition in its own SettingsCard, only if custom is selected */}
      {userData.formatter.id === constants.CUSTOM_FORMATTER && (
        <SettingsCard
          title="Custom Formatter"
          description="Define your own formatter"
        >
          <div className="text-sm text-gray-400">
            Type <span className="font-mono">{'{debug.jsonf}'}</span> to see the
            available variables. For a more detailed explanation, check the{' '}
            <a
              href="https://github.com/Viren070/AIOStreams/wiki/Custom-Formatter"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[--brand] hover:text-[--brand]/80 hover:underline"
            >
              wiki
            </a>
            . You can also check the definitions of the predefined formatters{' '}
            <a
              href="https://github.com/Viren070/AIOStreams/blob/main/packages/core/src/formatters/predefined.ts"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[--brand] hover:text-[--brand]/80 hover:underline"
            >
              here
            </a>
            .
          </div>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">
                Name Template
              </label>
              <Textarea
                value={userData.formatter.definition?.name || ''}
                onValueChange={(value) =>
                  handleFormatterChange(constants.CUSTOM_FORMATTER, value)
                }
                placeholder="Enter a template for the stream name"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">
                Description Template
              </label>
              <Textarea
                value={userData.formatter.definition?.description || ''}
                onValueChange={(value) =>
                  handleFormatterChange(
                    constants.CUSTOM_FORMATTER,
                    undefined,
                    value
                  )
                }
                placeholder="Enter a template for the stream description"
              />
            </div>
            <div className="flex gap-2 items-center">
              <SnippetsButton />
              <div className="ml-auto flex gap-2">
                <Tooltip
                  trigger={
                    <IconButton
                      rounded
                      size="sm"
                      intent="primary-subtle"
                      icon={<FaFileImport />}
                      onClick={importModalDisclosure.open}
                    />
                  }
                >
                  Import
                </Tooltip>
                <Tooltip
                  trigger={
                    <IconButton
                      rounded
                      size="sm"
                      intent="primary-subtle"
                      icon={<FaFileExport />}
                      onClick={handleExport}
                    />
                  }
                >
                  Export
                </Tooltip>
              </div>
            </div>
          </div>
        </SettingsCard>
      )}

      {/* Preview in its own SettingsCard */}
      <SettingsCard
        title="Preview"
        description="See how your streams would be formatted based on controllable variables"
      >
        <div className="space-y-4">
          <div className="flex flex-col space-y-2">
            <FormatterPreviewBox
              name={formattedStream?.name}
              description={formattedStream?.description}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <TextInput
              label={<span className="truncate block">Filename</span>}
              value={filename}
              onValueChange={(value) => setFilename(value || '')}
              className="w-full"
            />
            <TextInput
              label={<span className="truncate block">Folder Name</span>}
              value={folder}
              onValueChange={(value) => setFolder(value || '')}
              className="w-full"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-6 gap-4">
            <TextInput
              label={<span className="truncate block">Indexer</span>}
              value={indexer}
              onValueChange={(value) => setIndexer(value || '')}
              className="w-full"
            />
            <NumberInput
              label={<span className="truncate block">Seeders</span>}
              value={seeders}
              onValueChange={(value) => setSeeders(value || undefined)}
              className="w-full"
              min={0}
              defaultValue={0}
            />
            <TextInput
              label={<span className="truncate block">Age</span>}
              value={age}
              onValueChange={(value) => setAge(value || '')}
              className="w-full"
            />
            <NumberInput
              label={<span className="truncate block">Duration (s)</span>}
              value={duration ? duration / 1000 : undefined}
              onValueChange={(value) =>
                setDuration(value ? value * 1000 : undefined)
              }
              className="w-full"
              min={0}
              step={1000}
              defaultValue={0}
            />
            <NumberInput
              label={<span className="truncate block">File Size (bytes)</span>}
              value={fileSize}
              onValueChange={(value) => setFileSize(value || undefined)}
              className="w-full"
              step={1000000000}
              defaultValue={0}
              min={0}
            />
            <NumberInput
              label={
                <span className="truncate block">Folder Size (bytes)</span>
              }
              value={folderSize}
              onValueChange={(value) => setFolderSize(value || undefined)}
              className="w-full"
              step={1000000000}
              defaultValue={0}
              min={0}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <Select
              label={<span className="truncate block">Service</span>}
              value={providerId}
              options={[
                { label: 'None', value: 'none' },
                ...Object.values(constants.SERVICE_DETAILS).map((service) => ({
                  label: service.name,
                  value: service.id,
                })),
              ]}
              onValueChange={(value: string) =>
                setProviderId(value as constants.ServiceId)
              }
              className="w-full"
            />
            <TextInput
              label={<span className="truncate block">Addon Name</span>}
              value={addonName}
              onChange={(e) => setAddonName(e.target.value)}
              className="w-full"
            />
            <Select
              label={<span className="truncate block">Stream Type</span>}
              value={type}
              onValueChange={(value: string) =>
                setType(value as (typeof constants.STREAM_TYPES)[number])
              }
              options={constants.STREAM_TYPES.map((type) => ({
                label: type.charAt(0).toUpperCase() + type.slice(1),
                value: type,
              }))}
              className="w-full"
            />
            <TextInput
              label={<span className="truncate block">Regex Matched</span>}
              value={regexMatched}
              onValueChange={(value) => setRegexMatched(value || undefined)}
              className="w-full"
            />
          </div>

          <TextInput
            label={<span className="truncate block">Message</span>}
            value={message}
            onValueChange={(value) => setMessage(value || '')}
            className="w-full"
            placeholder="This is a message"
          />

          {/* Centralized Switches Container - flex row, wraps on small width, centered */}
          <div className="flex justify-center flex-wrap gap-4 pt-2">
            <Switch
              label={<span className="truncate block">Cached</span>}
              value={isCached}
              onValueChange={setIsCached}
            />
            <Switch
              label={<span className="truncate block">Library</span>}
              value={library}
              onValueChange={setLibrary}
            />
            <Switch
              label={<span className="truncate block">Proxied</span>}
              value={proxied}
              onValueChange={setProxied}
            />
          </div>
        </div>
      </SettingsCard>

      <ImportModal
        open={importModalDisclosure.isOpen}
        onOpenChange={importModalDisclosure.toggle}
        onImport={handleImport}
      />
    </>
  );
}

function SnippetsButton() {
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
                  if (!navigator.clipboard) {
                    toast.error(
                      'The clipboard API is not available in this browser or context.'
                    );
                    return;
                  }
                  try {
                    await navigator.clipboard.writeText(snippet.value);
                    toast.success('Snippet copied to clipboard');
                  } catch (error) {
                    console.error(
                      'Failed to copy snippet to clipboard:',
                      error
                    );
                    toast.error('Failed to copy snippet to clipboard');
                  }
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
