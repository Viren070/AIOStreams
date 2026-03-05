'use client';
import { useState, useEffect } from 'react';
import { Modal } from '../../ui/modal';
import { Button } from '../../ui/button';
import { Alert } from '../../ui/alert';
import { toast } from 'sonner';
import { Template, UserData } from '@aiostreams/core';
import { useStatus } from '@/context/status';
import { TextInput } from '../../ui/text-input';
import { Textarea } from '../../ui/textarea';

export interface TemplateExportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userData: UserData;
  filterCredentials: (data: UserData) => UserData;
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
  const [category, setCategory] = useState('Debrid');
  const [customCategory, setCustomCategory] = useState('');

  useEffect(() => {
    if (open) {
      // Reset fields when modal opens
      setTemplateName('');
      setDescription('');
      setAuthor('');
      setCategory('Debrid');
      setCustomCategory('');
    }
  }, [open]);

  const handleExport = () => {
    // Validate required fields
    if (!templateName.trim()) {
      toast.error('Please enter a template name');
      return;
    }
    if (!description.trim()) {
      toast.error('Please enter a description');
      return;
    }
    if (!author.trim()) {
      toast.error('Please enter an author name');
      return;
    }
    if (category === 'Custom' && !customCategory.trim()) {
      toast.error('Please enter a custom category name');
      return;
    }

    try {
      // Start with filtered userData (credentials always removed for templates)
      const templateData = filterCredentials(userData);

      // Smart handling for services - collect unique service IDs from enabled services
      const enabledServiceIds =
        userData.services
          ?.filter((service) => service.enabled)
          .map((service) => service.id) || [];

      // Add template placeholders to top-level API keys
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

      // // Handle services - add template placeholders to credentials
      // if (templateData.services && templateData.services.length > 0) {
      //   templateData.services = templateData.services.map((service) => {
      //     const newCredentials: Record<string, string> = {};

      //     // Replace all credential values with template placeholders
      //     Object.keys(service.credentials || {}).forEach((key) => {
      //       newCredentials[key] = '<template_placeholder>';
      //     });

      //     return {
      //       ...service,
      //       credentials: newCredentials,
      //     };
      //   });
      // }

      // Handle proxy - if proxy was enabled, keep id and add template placeholders
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
          publicIp: userData.proxy.publicIp
            ? '<template_placeholder>'
            : undefined,
        };
      }

      // Handle preset password options
      if (templateData.presets && templateData.presets.length > 0) {
        templateData.presets = templateData.presets.map((preset) => {
          const presetMeta = status?.settings.presets.find(
            (p) => p.ID === preset.type
          );
          const newOptions = { ...(preset.options || {}) };
          const presetInUserData = userData.presets?.find(
            (p) => p.instanceId == preset.instanceId
          );

          // Replace password type options with template placeholders
          presetMeta?.OPTIONS?.filter((opt) => opt.type === 'password').forEach(
            (passwordOption) => {
              if (presetInUserData?.options?.[passwordOption.id]) {
                newOptions[passwordOption.id] = '<template_placeholder>';
              }
            }
          );

          return {
            ...preset,
            options: newOptions,
          };
        });
      }

      const finalCategory =
        category === 'Custom' ? customCategory.trim() : category;

      // Create template with new structure
      const now = new Date();
      const pad = (n: number) => n.toString().padStart(2, '0');
      const formattedDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
      const template: Template = {
        metadata: {
          id: `${templateName.toLowerCase().replace(/\s+/g, '-')}-${formattedDate}-${Math.random().toString(36).slice(2, 9)}`,
          name: templateName,
          description: description,
          source: 'external',
          author: author,
          version: '1.0.0',
          category: finalCategory,
          services: undefined,
          serviceRequired: false,
          setToSaveInstallMenu: true,
        },
        config: templateData,
      };

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

  const categories = ['Debrid', 'P2P', 'Custom'] as const;

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
                starting point. All personal credentials will be replaced with
                placeholders.
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
                  href="https://github.com/Viren070/AIOStreams/wiki/Templates"
                  target="_blank"
                  className="text-[--brand] hover:text-[--brand]/80 hover:underline"
                  rel="noopener noreferrer"
                >
                  Templates wiki
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

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Category
            </label>
            <div className="flex gap-2">
              {categories.map((cat) => (
                <Button
                  key={cat}
                  intent={category === cat ? 'primary' : 'gray-outline'}
                  size="sm"
                  onClick={() => setCategory(cat)}
                  type="button"
                >
                  {cat}
                </Button>
              ))}
            </div>
          </div>

          {category === 'Custom' && (
            <TextInput
              label="Custom Category"
              placeholder="Enter category name (max 20 characters)"
              value={customCategory}
              onValueChange={(value) => {
                if (value.length <= 20) {
                  setCustomCategory(value);
                }
              }}
              required
            />
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-700">
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
