import * as constants from '../../../../../../../core/src/utils/constants';
import { formatBytes, formatBitrate } from '@/lib/format';
import { deriveBitrate, isValidUrl, PreviewInput } from '../state';
import {
  AdvancedFields,
  FieldGrid,
  NumberField,
  SelectField,
  SwitchField,
  SwitchRow,
  TextField,
} from '../fields';

const SERVICE_FIELDS = ['service.id', 'service.name', 'service.shortName'];

const ADVANCED = [
  'stream.infoHash',
  'stream.bitrate',
  'addon.presetId',
  'addon.manifestUrl',
];

export function StreamTab({
  input,
  patch,
}: {
  input: PreviewInput;
  patch: (partial: Partial<PreviewInput>) => void;
}) {
  const noService = input.serviceId === 'none';
  const derivedBitrate = deriveBitrate(input);
  return (
    <div className="space-y-4">
      <FieldGrid cols={3}>
        <SelectField
          field="stream.type"
          label="Stream type"
          value={input.type}
          onChange={(type) => patch({ type: type as PreviewInput['type'] })}
          options={constants.STREAM_TYPES.map((type) => ({
            label: type.charAt(0).toUpperCase() + type.slice(1),
            value: type,
          }))}
        />
        <SelectField
          field={SERVICE_FIELDS}
          label="Service"
          value={input.serviceId}
          onChange={(serviceId) =>
            patch({ serviceId: serviceId as PreviewInput['serviceId'] })
          }
          options={[
            { label: 'None', value: 'none' },
            ...Object.values(constants.SERVICE_DETAILS).map((service) => ({
              label: service.name,
              value: service.id,
            })),
          ]}
        />
        <TextField
          field="addon.name"
          label="Addon name"
          value={input.addonName}
          onChange={(addonName) => patch({ addonName })}
        />
        <TextField
          field="stream.indexer"
          label="Indexer"
          value={input.indexer}
          onChange={(indexer) => patch({ indexer })}
        />
        <NumberField
          field="stream.seeders"
          label="Seeders"
          value={input.seeders}
          onChange={(seeders) => patch({ seeders })}
          min={0}
        />
        <TextField
          field={['stream.age', 'stream.ageHours']}
          label="Age"
          help="e.g. 30m, 12h, 10d, 2y"
          value={input.age}
          onChange={(age) => patch({ age })}
        />
        <NumberField
          field="stream.duration"
          label="Duration (seconds)"
          value={input.duration ? input.duration / 1000 : undefined}
          onChange={(seconds) =>
            patch({
              duration: seconds === undefined ? undefined : seconds * 1000,
            })
          }
          min={0}
          step={60}
        />
        <NumberField
          field="stream.size"
          label="Size (bytes)"
          help={input.size ? formatBytes(input.size) : undefined}
          value={input.size}
          onChange={(size) => patch({ size })}
          min={0}
          step={1000000000}
        />
        <NumberField
          field="stream.folderSize"
          label="Folder size (bytes)"
          help={input.folderSize ? formatBytes(input.folderSize) : undefined}
          value={input.folderSize}
          onChange={(folderSize) => patch({ folderSize })}
          min={0}
          step={1000000000}
        />
      </FieldGrid>

      <TextField
        field="stream.message"
        label="Message"
        value={input.message}
        onChange={(message) => patch({ message })}
        placeholder="This is a message"
      />

      <SwitchRow>
        <SwitchField
          field="service.cached"
          label="Cached"
          disabled={noService}
          help={noService ? 'Needs a service' : undefined}
          value={input.cached}
          onChange={(cached) => patch({ cached })}
        />
        <SwitchField
          field="stream.library"
          label="Library"
          value={input.library}
          onChange={(library) => patch({ library })}
        />
        <SwitchField
          field="stream.private"
          label="Private"
          value={input.private}
          onChange={(value) => patch({ private: value })}
        />
        <SwitchField
          field="stream.freeleech"
          label="Freeleech"
          value={input.freeleech}
          onChange={(freeleech) => patch({ freeleech })}
        />
        <SwitchField
          field="stream.proxied"
          label="Proxied"
          value={input.proxied}
          onChange={(proxied) => patch({ proxied })}
        />
        <SwitchField
          field="stream.preloading"
          label="Preloading"
          value={input.preloading}
          onChange={(preloading) => patch({ preloading })}
        />
      </SwitchRow>

      <AdvancedFields fields={ADVANCED}>
        <FieldGrid cols={2}>
          <TextField
            field="stream.infoHash"
            label="Info hash"
            help="Only sent for p2p streams"
            value={input.infoHash}
            onChange={(infoHash) => patch({ infoHash })}
          />
          <NumberField
            field="stream.bitrate"
            label="Bitrate (bps)"
            help="Blank derives it from size and duration"
            value={input.bitrate}
            onChange={(bitrate) => patch({ bitrate })}
            min={0}
            step={1000000}
            placeholder={
              derivedBitrate ? `Auto: ${formatBitrate(derivedBitrate)}` : 'Auto'
            }
          />
          <TextField
            field="addon.presetId"
            label="Preset ID"
            value={input.presetId}
            onChange={(presetId) => patch({ presetId })}
          />
          <TextField
            field="addon.manifestUrl"
            label="Manifest URL"
            value={input.manifestUrl}
            onChange={(manifestUrl) => patch({ manifestUrl })}
            error={
              isValidUrl(input.manifestUrl) ? undefined : 'Must be a valid URL'
            }
          />
        </FieldGrid>
      </AdvancedFields>
    </div>
  );
}
