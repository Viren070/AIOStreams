import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../../ui/modal';
import { Button } from '../../ui/button';
import { Alert } from '../../ui/alert';
import { toast } from 'sonner';
import { StatusResponse, Template, UserData } from '@aiostreams/core';
import { redactPresetOptions } from '../../../../../core/src/utils/template-sanitise';
import { useStatus } from '@/context/status';
import { MAX_COMMUNITY_TAGS, parseTags } from '@/lib/tags';
import { TextInput } from '../../ui/text-input';
import { Textarea } from '../../ui/textarea';

export interface TemplateExportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userData: UserData;
  filterCredentials: (data: UserData) => UserData;
}

const SUGGESTED_TAGS = ['debrid', 'p2p', 'usenet', 'anime', 'minimal', '4k'];

export interface TemplateMetaInput {
  name: string;
  description: string;
  author: string;
  tags: string[];
  /** Community updates must beat the published version; defaults to 1.0.0. */
  version?: string;
}

/**
 * Turn the current configuration into a shareable template: credentials
 * stripped, known secrets swapped for placeholders.
 */
export function buildTemplateFromUserData({
  userData,
  filterCredentials,
  presets,
  meta,
}: {
  userData: UserData;
  filterCredentials: (data: UserData) => UserData;
  presets: StatusResponse['settings']['presets'];
  meta: TemplateMetaInput;
}): Template {
  const templateData = filterCredentials(userData);

  if (userData.tmdbApiKey) {
    templateData.tmdbApiKey = '<template_placeholder>';
  }
  if (userData.tmdbAccessToken) {
    templateData.tmdbAccessToken = '<template_placeholder>';
  }
  if (userData.tvdbApiKey) {
    templateData.tvdbApiKey = '<template_placeholder>';
  }
  if (userData.rpdbApiKey) {
    templateData.rpdbApiKey = '<template_placeholder>';
  }

  if (userData.proxy?.enabled) {
    templateData.proxy = {
      ...templateData.proxy,
      url: userData.proxy.url ? '<template_placeholder>' : undefined,
      publicUrl: userData.proxy.publicUrl
        ? '<template_placeholder>'
        : undefined,
      credentials: userData.proxy.credentials
        ? '<template_placeholder>'
        : undefined,
      publicIp: userData.proxy.publicIp ? '<template_placeholder>' : undefined,
    };
  }

  if (templateData.presets && templateData.presets.length > 0) {
    templateData.presets = templateData.presets.map((preset) => {
      const presetMeta = presets.find((p) => p.ID === preset.type);
      const presetInUserData = userData.presets?.find(
        (p) => p.instanceId == preset.instanceId
      );
      return {
        ...preset,
        options: redactPresetOptions(
          presetInUserData?.options ?? preset.options,
          presetMeta?.OPTIONS,
          '<template_placeholder>'
        ),
      };
    });
  }

  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const formattedDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  return {
    metadata: {
      id: `${meta.name.toLowerCase().replace(/\s+/g, '-')}-${formattedDate}-${Math.random().toString(36).slice(2, 9)}`,
      name: meta.name.trim(),
      description: meta.description.trim(),
      source: 'external',
      author: meta.author.trim(),
      version: meta.version ?? '1.0.0',
      category: meta.tags[0] ?? 'general',
      tags: meta.tags,
      services: undefined,
      serviceRequired: false,
      setToSaveInstallMenu: true,
    },
    config: templateData,
  };
}

export function TemplateExportModal({
  open,
  onOpenChange,
  userData,
  filterCredentials,
}: TemplateExportModalProps) {
  const { status } = useStatus();
  const [templateName, setTemplateName] = useState('');
  const [description, setDescription] = useState('');
  const [author, setAuthor] = useState('');
  const [tagsText, setTagsText] = useState('');

  useEffect(() => {
    if (open) {
      // Reset fields when modal opens
      setTemplateName('');
      setDescription('');
      setAuthor('');
      setTagsText('');
    }
  }, [open]);

  const tags = useMemo(() => parseTags(tagsText), [tagsText]);
  const toggleTag = (tag: string) => {
    const next = tags.includes(tag)
      ? tags.filter((t) => t !== tag)
      : [...tags, tag];
    setTagsText(next.join(', '));
  };

  const validate = (): boolean => {
    if (!templateName.trim()) {
      toast.error('Please enter a template name');
      return false;
    }
    if (!description.trim()) {
      toast.error('Please enter a description');
      return false;
    }
    if (!author.trim()) {
      toast.error('Please enter an author name');
      return false;
    }
    if (tags.length === 0) {
      toast.error('Please add at least one tag');
      return false;
    }
    return true;
  };

  const buildTemplate = (): Template =>
    buildTemplateFromUserData({
      userData,
      filterCredentials,
      presets: status?.settings.presets ?? [],
      meta: {
        name: templateName,
        description,
        author,
        tags,
      },
    });

  const handleExport = () => {
    if (!validate()) return;
    try {
      const template = buildTemplate();
      const dataStr = JSON.stringify(template, null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${template.metadata.id}-template.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Template exported successfully');
      onOpenChange(false);
    } catch (err) {
      toast.error('Failed to export template');
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Export as Template"
      description="Configure your template metadata and settings"
    >
      <div className="space-y-4">
        <Alert
          intent="info"
          description={
            <div className="space-y-2 text-sm">
              <p>
                A template is a configuration file that others can use as a
                starting point. Service credentials, API keys and addon
                passwords are replaced with placeholders; variant scripts and
                other free text are kept as written.
              </p>
              <p>
                <strong>Want more control?</strong> Edit the exported JSON
                manually to add advanced features like:
              </p>
              <ul className="list-disc list-inside ml-2 space-y-1">
                <li>Conditional inputs and fields based on user selections</li>
                <li>Template placeholders for dynamic values</li>
                <li>Service filtering and smart service selection</li>
                <li>Custom validation and input grouping</li>
              </ul>
              <p>
                See the{' '}
                <a
                  href="https://docs.aiostreams.viren070.me/guides/templates"
                  target="_blank"
                  className="text-[--brand] hover:text-[--brand]/80 hover:underline"
                  rel="noopener noreferrer"
                >
                  Templates docs
                </a>{' '}
                for detailed documentation.
              </p>
            </div>
          }
        />

        <div className="space-y-3">
          <TextInput
            label="Template Name"
            placeholder="e.g. My AIOStreams setup"
            value={templateName}
            onValueChange={setTemplateName}
            required
          />

          <Textarea
            label="Description"
            placeholder="Describe what makes this template useful..."
            value={description}
            onValueChange={setDescription}
            required
            rows={3}
          />

          <TextInput
            label="Author"
            placeholder="Your name or username"
            value={author}
            onValueChange={setAuthor}
            required
          />

          <div className="space-y-2">
            <TextInput
              label="Tags"
              placeholder={`Comma separated, up to ${MAX_COMMUNITY_TAGS}`}
              value={tagsText}
              onValueChange={setTagsText}
              required
            />
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTED_TAGS.map((tag) => (
                <Button
                  key={tag}
                  intent={tags.includes(tag) ? 'primary' : 'gray-outline'}
                  size="sm"
                  onClick={() => toggleTag(tag)}
                  type="button"
                >
                  {tag}
                </Button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-gray-700">
          <Button intent="primary-outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button intent="white" rounded onClick={handleExport}>
            Export Template
          </Button>
        </div>
      </div>
    </Modal>
  );
}
