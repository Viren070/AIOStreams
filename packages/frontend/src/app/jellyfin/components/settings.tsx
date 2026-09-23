import React from 'react';
import { Modal } from '@/components/ui/modal';
import { Combobox } from '@/components/ui/combobox';
import { Select } from '@/components/ui/select';
import { TextInput } from '@/components/ui/text-input';
import { Button } from '@/components/ui/button';
import { useViews } from '../lib/queries';
import { libraryLabel } from '../lib/format';
import {
  MAX_FEATURED,
  useFeatured,
  usePosterSize,
  usePosterLines,
  type PosterLine,
  type PosterSize,
} from '../lib/settings';
import {
  externalPlayerTemplate,
  setExternalPlayerTemplate,
} from '../lib/playback';

const NOTHING = 'none';

const PRESETS = [
  { name: 'VLC', template: 'vlc://{url}' },
  { name: 'Infuse', template: 'infuse://x-callback-url/play?url={encodedUrl}' },
  { name: 'Outplayer', template: 'outplayer://{url}' },
  { name: 'IINA', template: 'iina://weblink?url={encodedUrl}' },
];

/** The web app's settings; none of them are saved to the configuration. */
export function SettingsModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const views = useViews();
  const [featured, setFeatured] = useFeatured();
  const [posterSize, setPosterSize] = usePosterSize();
  const [posterLines, setPosterLines] = usePosterLines();
  const [template, setTemplate] = React.useState('');
  React.useEffect(() => {
    if (open) setTemplate(externalPlayerTemplate());
  }, [open]);

  const featuredOptions = [
    {
      value: 'resume',
      label: 'Continue watching',
      textValue: 'Continue watching',
    },
    ...(views.data?.Items ?? []).map((v) => {
      const label = [v.Name, libraryLabel(v)].filter(Boolean).join(' · ');
      return { value: `view:${v.Id}`, label, textValue: label };
    }),
    { value: NOTHING, label: 'Nothing', textValue: 'Nothing' },
  ];
  // Catalogs since removed would count towards the limit without showing.
  const known = new Set(featuredOptions.map((o) => o.value));
  const featuredValue =
    featured === 'auto'
      ? []
      : !featured.length
        ? [NOTHING]
        : views.data
          ? featured.filter((s) => known.has(s))
          : featured;
  // Nothing excludes every other choice.
  const changeFeatured = (next: string[]) => {
    const added = next.filter((v) => !featuredValue.includes(v));
    if (added.includes(NOTHING)) setFeatured([]);
    else {
      const sources = next.filter((v) => v !== NOTHING);
      setFeatured(sources.length ? sources : 'auto');
    }
  };

  const save = () => {
    setExternalPlayerTemplate(template);
    onOpenChange(false);
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Settings"
      description="These follow you to every device, except the external player, which stays on this one."
      contentClass="max-w-lg"
    >
      <div className="space-y-6">
        <Combobox
          multiple
          label="Featured on home"
          help={`Up to ${MAX_FEATURED}, mixed together. Left empty, your first movie and series catalogs are featured.`}
          placeholder="Automatic"
          emptyMessage="Nothing matches."
          options={featuredOptions}
          maxItems={MAX_FEATURED}
          value={featuredValue}
          onValueChange={changeFeatured}
        />
        <Select
          label="Poster size"
          help="How large cards are in a grid."
          options={[
            { value: 'small', label: 'Small' },
            { value: 'medium', label: 'Medium' },
            { value: 'large', label: 'Large' },
          ]}
          value={posterSize}
          onValueChange={(value) => setPosterSize(value as PosterSize)}
        />
        <Combobox
          multiple
          label="Under posters"
          help="Left empty, posters stand alone. A poster without artwork still shows its title."
          placeholder="Nothing"
          emptyMessage="Nothing matches."
          options={[
            { value: 'title', label: 'Title', textValue: 'Title' },
            { value: 'year', label: 'Year', textValue: 'Year' },
          ]}
          value={posterLines}
          onValueChange={(value) => setPosterLines(value as PosterLine[])}
        />
        <div className="space-y-3">
          <TextInput
            label="External player"
            placeholder="vlc://{url}"
            value={template}
            onValueChange={setTemplate}
            help="Adds an open-in-player button to each version. {url} is the stream address, {encodedUrl} the same address URL-encoded."
          />
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <Button
                key={p.name}
                size="sm"
                intent="gray-outline"
                className="rounded-full"
                onClick={() => setTemplate(p.template)}
              >
                {p.name}
              </Button>
            ))}
            <Button
              size="sm"
              intent="gray-subtle"
              className="rounded-full"
              onClick={() => setTemplate('')}
            >
              None
            </Button>
          </div>
        </div>
        <div className="flex justify-end">
          <Button
            intent="white"
            className="w-full rounded-full sm:w-auto"
            onClick={save}
          >
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}
