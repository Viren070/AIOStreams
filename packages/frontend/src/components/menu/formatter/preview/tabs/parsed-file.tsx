import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import * as constants from '../../../../../../../core/src/utils/constants';
import { ParsedFile } from '../../../../../../../core/src/db/schemas';
import { IconButton, Button } from '../../../../ui/button';
import { TextInput } from '../../../../ui/text-input';
import { Select } from '../../../../ui/select';
import { Combobox } from '../../../../ui/combobox';
import {
  AdvancedFields,
  FieldGrid,
  FieldLabel,
  FieldNote,
  FieldRef,
  useFieldState,
} from '../fields';
import { PreviewInput, splitList } from '../state';

/** Radix rejects an empty option value, so absence needs a sentinel. */
const NONE = '__none__';
const AUTO = '__auto__';

type RowKind =
  | 'text'
  | 'textList'
  | 'numberList'
  | 'enum'
  | 'enumList'
  | 'bool';

type SetOverride = (
  key: keyof ParsedFile,
  value: unknown,
  /** false keeps an explicit choice even when it matches the parser */
  collapseIfSame?: boolean
) => void;

interface Row {
  key: keyof ParsedFile;
  label: string;
  /** the template fields this parsed value feeds */
  field: FieldRef;
  kind: RowKind;
  options?: readonly string[];
  help?: string;
}

const LANGUAGE_FIELDS = [
  'stream.languages',
  'stream.uLanguages',
  'stream.languageEmojis',
  'stream.uLanguageEmojis',
  'stream.languageCodes',
  'stream.uLanguageCodes',
  'stream.smallLanguageCodes',
  'stream.uSmallLanguageCodes',
  'stream.wedontknowwhatakilometeris',
  'stream.uWedontknowwhatakilometeris',
];

const SUBTITLE_FIELDS = [
  'stream.subtitles',
  'stream.uSubtitles',
  'stream.subtitleEmojis',
  'stream.uSubtitleEmojis',
  'stream.subtitleCodes',
  'stream.uSubtitleCodes',
  'stream.smallSubtitleCodes',
  'stream.uSmallSubtitleCodes',
  'stream.subbed',
];

const COMMON_ROWS: readonly Row[] = [
  { key: 'title', label: 'Title', field: 'stream.title', kind: 'text' },
  { key: 'year', label: 'Year', field: 'stream.year', kind: 'text' },
  {
    key: 'seasons',
    label: 'Seasons',
    field: [
      'stream.seasons',
      'stream.season',
      'stream.formattedSeasons',
      'stream.seasonEpisode',
    ],
    kind: 'numberList',
  },
  {
    key: 'episodes',
    label: 'Episodes',
    field: [
      'stream.episodes',
      'stream.episode',
      'stream.formattedEpisodes',
      'stream.seasonEpisode',
    ],
    kind: 'numberList',
  },
  {
    key: 'resolution',
    label: 'Resolution',
    field: 'stream.resolution',
    kind: 'enum',
    options: constants.RESOLUTIONS,
  },
  {
    key: 'quality',
    label: 'Quality',
    field: 'stream.quality',
    kind: 'enum',
    options: constants.QUALITIES,
  },
  {
    key: 'encode',
    label: 'Encode',
    field: 'stream.encode',
    kind: 'enum',
    options: constants.ENCODES,
  },
  {
    key: 'releaseGroup',
    label: 'Release group',
    field: 'stream.releaseGroup',
    kind: 'text',
  },
  {
    key: 'visualTags',
    label: 'Visual tags',
    field: 'stream.visualTags',
    kind: 'enumList',
    options: constants.VISUAL_TAGS,
  },
  {
    key: 'audioTags',
    label: 'Audio tags',
    field: 'stream.audioTags',
    kind: 'enumList',
    options: constants.AUDIO_TAGS,
  },
  {
    key: 'audioChannels',
    label: 'Audio channels',
    field: 'stream.audioChannels',
    kind: 'enumList',
    options: constants.AUDIO_CHANNELS,
  },
  {
    key: 'languages',
    label: 'Languages',
    field: LANGUAGE_FIELDS,
    kind: 'enumList',
    options: constants.LANGUAGES,
  },
  {
    key: 'mediaInfoQuality',
    label: 'Media info quality',
    field: 'stream.mediaInfoQuality',
    kind: 'enum',
    options: ['probe', 'indexer', 'addon'],
    help: 'Set when media info is confirmed, rather than guessed',
  },
  {
    key: 'subtitles',
    label: 'Subtitles',
    field: SUBTITLE_FIELDS,
    kind: 'enumList',
    options: constants.LANGUAGES,
    help: 'Only media info fills this in, so overriding is the only way to preview it',
  },
  {
    key: 'editions',
    label: 'Editions',
    field: ['stream.edition', 'stream.editions'],
    kind: 'textList',
  },
  {
    key: 'seasonPack',
    label: 'Season pack',
    field: 'stream.seasonPack',
    kind: 'bool',
  },
];

const ADVANCED_ROWS: readonly Row[] = [
  { key: 'country', label: 'Country', field: 'stream.country', kind: 'text' },
  {
    key: 'episodeTitle',
    label: 'Episode title',
    field: 'stream.episodeTitle',
    kind: 'text',
  },
  { key: 'date', label: 'Date', field: 'stream.date', kind: 'text' },
  {
    key: 'folderSeasons',
    label: 'Folder seasons',
    field: ['stream.folderSeasons', 'stream.formattedFolderSeasons'],
    kind: 'numberList',
  },
  {
    key: 'folderEpisodes',
    label: 'Folder episodes',
    field: ['stream.folderEpisodes', 'stream.formattedFolderEpisodes'],
    kind: 'numberList',
  },
  {
    key: 'volumes',
    label: 'Volumes',
    field: [],
    kind: 'numberList',
    help: 'Parsed but not exposed to templates',
  },
  { key: 'network', label: 'Network', field: 'stream.network', kind: 'text' },
  {
    key: 'container',
    label: 'Container',
    field: 'stream.container',
    kind: 'text',
  },
  {
    key: 'extension',
    label: 'Extension',
    field: 'stream.extension',
    kind: 'text',
  },
  { key: 'subbed', label: 'Subbed', field: 'stream.subbed', kind: 'bool' },
  { key: 'dubbed', label: 'Dubbed', field: 'stream.dubbed', kind: 'bool' },
  {
    key: 'regraded',
    label: 'Regraded',
    field: 'stream.regraded',
    kind: 'bool',
  },
  { key: 'repack', label: 'Repack', field: 'stream.repack', kind: 'bool' },
  { key: 'proper', label: 'Proper', field: 'stream.proper', kind: 'bool' },
  {
    key: 'uncensored',
    label: 'Uncensored',
    field: 'stream.uncensored',
    kind: 'bool',
  },
  { key: 'unrated', label: 'Unrated', field: 'stream.unrated', kind: 'bool' },
  {
    key: 'upscaled',
    label: 'Upscaled',
    field: 'stream.upscaled',
    kind: 'bool',
  },
  {
    key: 'hasChapters',
    label: 'Has chapters',
    field: 'stream.hasChapters',
    kind: 'bool',
    help: 'Only media info fills this in, so overriding is the only way to preview it',
  },
];

/** undefined, empty string and empty array all mean the parser found nothing. */
function isEmptyValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  );
}

function sameValue(a: unknown, b: unknown): boolean {
  if (isEmptyValue(a) && isEmptyValue(b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((entry, i) => entry === b[i]);
  }
  return a === b;
}

function sameOverrides(a: Partial<ParsedFile>, b: Partial<ParsedFile>) {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) =>
    sameValue(a[key as keyof ParsedFile], b[key as keyof ParsedFile])
  );
}

function toText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

function toList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function ParsedFileRow({
  row,
  parsed,
  overrides,
  setOverride,
}: {
  row: Row;
  parsed: ParsedFile | undefined;
  overrides: Partial<ParsedFile>;
  setOverride: SetOverride;
}) {
  const { visible, isUsed } = useFieldState(row.field);
  if (!visible) return null;

  const overridden = row.key in overrides;
  const value = overridden ? overrides[row.key] : parsed?.[row.key];
  const label = (
    <FieldLabel label={row.label} field={row.field} isUsed={isUsed} />
  );

  let control: React.ReactNode;
  switch (row.kind) {
    case 'enum':
      control = (
        <Select
          label={label}
          moreHelp={row.help}
          value={value === undefined || value === null ? NONE : String(value)}
          options={[
            { label: 'Not detected', value: NONE },
            ...(row.options ?? []).map((option) => ({
              label: option,
              value: option,
            })),
          ]}
          onValueChange={(next) =>
            setOverride(row.key, next === NONE ? '' : next)
          }
          className="w-full"
        />
      );
      break;
    case 'enumList':
      control = (
        <Combobox
          label={label}
          moreHelp={row.help}
          multiple
          value={toList(value)}
          onValueChange={(next) => setOverride(row.key, next)}
          options={(row.options ?? []).map((option) => ({
            label: option,
            value: option,
          }))}
          emptyMessage="No matches"
          placeholder="None"
          className="w-full"
        />
      );
      break;
    case 'bool':
      control = (
        <Select
          label={label}
          moreHelp={row.help}
          value={overridden ? String(value ?? false) : AUTO}
          options={[
            {
              label: `Auto (${parsed?.[row.key] ? 'yes' : 'no'})`,
              value: AUTO,
            },
            { label: 'Yes', value: 'true' },
            { label: 'No', value: 'false' },
          ]}
          onValueChange={(next) =>
            setOverride(
              row.key,
              next === AUTO ? undefined : next === 'true',
              false
            )
          }
          className="w-full"
        />
      );
      break;
    case 'numberList':
      control = (
        <TextInput
          label={label}
          moreHelp={row.help ?? 'Comma separated'}
          value={toText(value)}
          placeholder="Not detected"
          onValueChange={(next) =>
            setOverride(
              row.key,
              splitList(next ?? '')
                .map(Number)
                .filter((entry) => !Number.isNaN(entry))
            )
          }
          className="w-full"
        />
      );
      break;
    case 'textList':
      control = (
        <TextInput
          label={label}
          moreHelp={row.help ?? 'Comma separated'}
          value={toText(value)}
          placeholder="Not detected"
          onValueChange={(next) => setOverride(row.key, splitList(next ?? ''))}
          className="w-full"
        />
      );
      break;
    default:
      control = (
        <TextInput
          label={label}
          moreHelp={row.help}
          value={toText(value)}
          placeholder="Not detected"
          onValueChange={(next) => setOverride(row.key, next ?? '')}
          className="w-full"
        />
      );
  }

  return (
    <div className="flex items-end gap-1.5">
      <div className="min-w-0 flex-1">{control}</div>
      <IconButton
        size="sm"
        rounded
        intent="gray-subtle"
        icon={<RotateCcw className="w-3.5 h-3.5" />}
        aria-label={`Reset ${row.label}`}
        className={overridden ? undefined : 'invisible'}
        onClick={() => setOverride(row.key, undefined)}
      />
    </div>
  );
}

export function ParsedFileTab({
  input,
  patch,
  parsed,
  effective,
}: {
  input: PreviewInput;
  patch: (partial: Partial<PreviewInput>) => void;
  /** straight from the parsers, before overrides */
  parsed: ParsedFile | undefined;
  /** what the format request actually carries */
  effective: ParsedFile | undefined;
}) {
  const [showJson, setShowJson] = useState(false);
  const overrides = input.parsedFileOverrides;
  const overrideCount = Object.keys(overrides).length;

  const setOverride: SetOverride = (key, value, collapseIfSame = true) => {
    const next = { ...overrides } as Record<string, unknown>;
    // an override is a *difference*: matching the parser records nothing, which
    // also absorbs the value every combobox emits on mount
    if (
      value === undefined ||
      (collapseIfSame && sameValue(value, parsed?.[key]))
    ) {
      // a present-but-undefined key would wipe the merged value, so reset deletes
      delete next[key];
    } else {
      next[key] = value;
    }
    const nextOverrides = next as Partial<ParsedFile>;
    if (sameOverrides(nextOverrides, overrides)) return;
    patch({ parsedFileOverrides: nextOverrides });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-[--muted]">
          {overrideCount > 0
            ? `${overrideCount} override${overrideCount === 1 ? '' : 's'} applied on top of the parser`
            : 'Straight from the parser. Editing any value overrides it.'}
        </p>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            intent="gray-subtle"
            onClick={() => setShowJson((value) => !value)}
          >
            {showJson ? 'Hide' : 'Show'} raw JSON
          </Button>
          <Button
            size="sm"
            intent="alert-subtle"
            disabled={overrideCount === 0}
            onClick={() => patch({ parsedFileOverrides: {} })}
          >
            Clear overrides
          </Button>
        </div>
      </div>

      {showJson && (
        <pre className="max-h-72 overflow-auto rounded-md border border-[--border] bg-[--subtle] p-3 text-xs">
          {JSON.stringify(effective ?? null, null, 2)}
        </pre>
      )}

      <FieldGrid cols={3}>
        {COMMON_ROWS.map((row) => (
          <ParsedFileRow
            key={row.key}
            row={row}
            parsed={parsed}
            overrides={overrides}
            setOverride={setOverride}
          />
        ))}
      </FieldGrid>

      <AdvancedFields fields={ADVANCED_ROWS.map((row) => row.field)}>
        <FieldGrid cols={3}>
          {ADVANCED_ROWS.map((row) => (
            <ParsedFileRow
              key={row.key}
              row={row}
              parsed={parsed}
              overrides={overrides}
              setOverride={setOverride}
            />
          ))}
        </FieldGrid>
      </AdvancedFields>

      <FieldNote>
        Overrides stand in for the media info the engine folds in at this same
        point, which is the only source for subtitles and chapters.
      </FieldNote>
    </div>
  );
}
