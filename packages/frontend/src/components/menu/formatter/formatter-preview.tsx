'use client';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import * as constants from '../../../../../core/src/utils/constants';
import { ParsedStream } from '../../../../../core/src/db/schemas';
import FileParser from '../../../../../core/src/parser/file';
import { mergeParsedFiles } from '../../../../../core/src/parser/merge';
import { useUserData } from '@/context/userData';
import { SettingsCard } from '../../shared/settings-card';
import { TextInput } from '../../ui/text-input';
import { NumberInput } from '../../ui/number-input';
import { Select } from '../../ui/select';
import { Switch } from '../../ui/switch';
import { Button } from '../../ui/button';
import { getFormattedStream } from '@/lib/api';
import { toast } from 'sonner';
import { useDisclosure } from '@/hooks/disclosure';
import { FormatQueue } from './format-queue';
import { AdvancedModal } from './advanced-modal';

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

function parseAgeToHours(ageString: string): number | undefined {
  const match = ageString.match(/^(\d+)([a-zA-Z])$/);
  if (!match) return undefined;
  const value = parseInt(match[1], 10);
  switch (match[2].toLowerCase()) {
    case 'd':
      return value * 24;
    case 'h':
      return value;
    case 'm':
      return value / 60;
    case 'y':
      return value * 24 * 365;
    default:
      return undefined;
  }
}

export function FormatterPreview() {
  const { userData } = useUserData();
  const advancedModalDisclosure = useDisclosure(false);
  const formatQueueRef = useRef<FormatQueue>(new FormatQueue(200));

  const [formattedStream, setFormattedStream] = useState<{
    name: string;
    description: string;
  } | null>(null);
  const [isFormatting, setIsFormatting] = useState(false);

  // Basic preview state
  const [filename, setFilename] = useState(
    'Movie.Title.2023.2160p.BluRay.HEVC.DV.TrueHD.Atmos.7.1.iTA.ENG-GROUP.mkv'
  );
  const [folder, setFolder] = useState(
    'Movie.Title.2023.2160p.BluRay.HEVC.DV.TrueHD.Atmos.7.1.iTA.ENG-GROUP'
  );
  const [indexer, setIndexer] = useState('RARBG');
  const [seeders, setSeeders] = useState<number | undefined>(125);
  const [age, setAge] = useState('10d');
  const [addonName, setAddonName] = useState('Torrentio');
  const [providerId, setProviderId] = useState<constants.ServiceId | 'none'>(
    'none'
  );
  const [isCached, setIsCached] = useState(true);
  const [type, setType] =
    useState<(typeof constants.STREAM_TYPES)[number]>('debrid');
  const [library, setLibrary] = useState(false);
  const [privateTorrent, setPrivateTorrent] = useState(false);
  const [duration, setDuration] = useState<number | undefined>(9120000);
  const [fileSize, setFileSize] = useState<number | undefined>(62500000000);
  const [folderSize, setFolderSize] = useState<number | undefined>(
    125000000000
  );
  const [proxied, setProxied] = useState(false);
  const [regexMatched, setRegexMatched] = useState<string | undefined>(
    undefined
  );
  const [message, setMessage] = useState('This is a message');

  // Advanced state
  const [seadex, setSeadex] = useState(false);
  const [seadexBest, setSeadexBest] = useState(false);
  const [regexScore, setRegexScore] = useState<number | undefined>(25);
  const [streamExpressionScore, setStreamExpressionScore] = useState<
    number | undefined
  >(150);
  const [maxRegexScore, setMaxRegexScore] = useState<number | undefined>(50);
  const [maxSeScore, setMaxSeScore] = useState<number | undefined>(100);
  const [seMatched, setSeMatched] = useState<string | undefined>(undefined);
  const [rseMatched, setRseMatched] = useState<string | undefined>(undefined);
  const [rankedRegexMatched, setRankedRegexMatched] = useState('');

  const formatStream = useCallback(async () => {
    if (isFormatting) return;
    try {
      setIsFormatting(true);
      const fileParsed = FileParser.parse(filename);
      const folderParsed = folder ? FileParser.parse(folder) : undefined;
      const parsedFile =
        mergeParsedFiles(fileParsed, folderParsed) || fileParsed;

      const stream: ParsedStream = {
        id: 'preview',
        type,
        addon: {
          name: addonName,
          preset: { type: 'custom', id: 'custom', options: {} },
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
        regexMatched: { name: regexMatched, index: 0 },
        torrent: {
          infoHash: type === 'p2p' ? '1234567890' : undefined,
          seeders,
          private: privateTorrent,
        },
        service:
          providerId === 'none'
            ? undefined
            : { id: providerId, cached: isCached },
        age: parseAgeToHours(age),
        duration,
        size: fileSize,
        bitrate:
          fileSize && duration
            ? Math.floor((fileSize * 8) / (duration / 1000))
            : undefined,
        proxied,
        message,
        seadex: { isSeadex: seadex, isBest: seadex && seadexBest },
        streamExpressionScore,
        streamExpressionMatched: seMatched
          ? { name: seMatched, index: 0 }
          : undefined,
        rankedStreamExpressionsMatched: rseMatched
          ? rseMatched
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
        regexScore,
        rankedRegexesMatched: rankedRegexMatched
          ? rankedRegexMatched
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
      };

      const context = { userData, maxRegexScore, maxSeScore };
      const formattedData = await getFormattedStream(stream, context);
      setFormattedStream(formattedData);
    } catch (error) {
      console.error('Error formatting stream:', error);
      toast.error(`Failed to format stream: ${error}`);
    } finally {
      setIsFormatting(false);
    }
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
    privateTorrent,
    duration,
    fileSize,
    folderSize,
    proxied,
    isFormatting,
    regexMatched,
    message,
    userData,
    seadex,
    seadexBest,
    streamExpressionScore,
    rseMatched,
    rankedRegexMatched,
    regexScore,
    maxRegexScore,
    maxSeScore,
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
    privateTorrent,
    duration,
    fileSize,
    folderSize,
    proxied,
    regexMatched,
    userData,
    message,
    seadex,
    seadexBest,
    streamExpressionScore,
    rseMatched,
    rankedRegexMatched,
    regexScore,
    maxRegexScore,
    maxSeScore,
  ]);

  return (
    <>
      <SettingsCard
        title="Preview"
        description="See how your streams would be formatted based on controllable variables"
      >
        <div className="space-y-4">
          <FormatterPreviewBox
            name={formattedStream?.name}
            description={formattedStream?.description}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <TextInput
              label={<span className="truncate block">Filename</span>}
              value={filename}
              onValueChange={(v) => setFilename(v || '')}
              className="w-full"
            />
            <TextInput
              label={<span className="truncate block">Folder Name</span>}
              value={folder}
              onValueChange={(v) => setFolder(v || '')}
              className="w-full"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-6 gap-4">
            <TextInput
              label={<span className="truncate block">Indexer</span>}
              value={indexer}
              onValueChange={(v) => setIndexer(v || '')}
              className="w-full"
            />
            <NumberInput
              label={<span className="truncate block">Seeders</span>}
              value={seeders}
              onValueChange={(v) => setSeeders(v || undefined)}
              className="w-full"
              min={0}
              defaultValue={0}
            />
            <TextInput
              label={<span className="truncate block">Age</span>}
              value={age}
              onValueChange={(v) => setAge(v || '')}
              className="w-full"
            />
            <NumberInput
              label={<span className="truncate block">Duration (s)</span>}
              value={duration ? duration / 1000 : undefined}
              onValueChange={(v) => setDuration(v ? v * 1000 : undefined)}
              className="w-full"
              min={0}
              step={1000}
              defaultValue={0}
            />
            <NumberInput
              label={<span className="truncate block">File Size (bytes)</span>}
              value={fileSize}
              onValueChange={(v) => setFileSize(v || undefined)}
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
              onValueChange={(v) => setFolderSize(v || undefined)}
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
                ...Object.values(constants.SERVICE_DETAILS).map((s) => ({
                  label: s.name,
                  value: s.id,
                })),
              ]}
              onValueChange={(v) => setProviderId(v as constants.ServiceId)}
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
              onValueChange={(v) =>
                setType(v as (typeof constants.STREAM_TYPES)[number])
              }
              options={constants.STREAM_TYPES.map((t) => ({
                label: t.charAt(0).toUpperCase() + t.slice(1),
                value: t,
              }))}
              className="w-full"
            />
            <TextInput
              label={<span className="truncate block">Regex Matched</span>}
              value={regexMatched}
              onValueChange={(v) => setRegexMatched(v || undefined)}
              className="w-full"
            />
          </div>

          <TextInput
            label={<span className="truncate block">Message</span>}
            value={message}
            onValueChange={(v) => setMessage(v || '')}
            className="w-full"
            placeholder="This is a message"
          />

          <div className="flex justify-center pt-2">
            <Button
              intent="white"
              size="sm"
              onClick={advancedModalDisclosure.open}
            >
              Advanced Variables
            </Button>
          </div>

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
              label={<span className="truncate block">Private</span>}
              value={privateTorrent}
              onValueChange={setPrivateTorrent}
            />
            <Switch
              label={<span className="truncate block">Proxied</span>}
              value={proxied}
              onValueChange={setProxied}
            />
          </div>
        </div>
      </SettingsCard>

      <AdvancedModal
        open={advancedModalDisclosure.isOpen}
        onOpenChange={advancedModalDisclosure.toggle}
        regexScore={regexScore}
        setRegexScore={setRegexScore}
        maxRegexScore={maxRegexScore}
        setMaxRegexScore={setMaxRegexScore}
        streamExpressionScore={streamExpressionScore}
        setStreamExpressionScore={setStreamExpressionScore}
        maxSeScore={maxSeScore}
        setMaxSeScore={setMaxSeScore}
        seMatched={seMatched}
        setSeMatched={setSeMatched}
        rseMatched={rseMatched}
        setRseMatched={setRseMatched}
        rankedRegexMatched={rankedRegexMatched}
        setRankedRegexMatched={setRankedRegexMatched}
        seadex={seadex}
        setSeadex={setSeadex}
        seadexBest={seadexBest}
        setSeadexBest={setSeadexBest}
      />
    </>
  );
}
