import { TextInput } from '../ui/text-input';
import { NumberInput } from '../ui/number-input';
import { Switch } from '../ui/switch';
import { Select } from '../ui/select';
import { Combobox } from '../ui/combobox';
import { Option, NNTPServers } from '@aiostreams/core';
import React, { useState, useEffect } from 'react';
import MarkdownLite from './markdown-lite';
import { Alert } from '../ui/alert';
import { SocialIcon } from './social-icon';
import { PasswordInput } from '../ui/password-input';
import { Button } from '../ui/button';
import { IconButton } from '../ui/button';
import {
  FaKey,
  FaChevronUp,
  FaChevronDown,
  FaArrowLeft,
  FaGear,
  FaPlus,
  FaServer,
  FaTrashCan,
} from 'react-icons/fa6';
import { Modal } from '../ui/modal';
// this component, accepts an option and returns a component that renders the option.
// string - TextInput
// number - NumberInput
// boolean - Checkbox
// select - Select
// multi-select - ComboBox
// url - TextInput (with url validation)

// Props for the template option component
interface TemplateOptionProps {
  option: Option;
  value: any;
  disabled?: boolean;
  onChange: (value: any) => void;
}

const TemplateOption: React.FC<TemplateOptionProps> = ({
  option,
  value,
  onChange,
  disabled,
}) => {
  const {
    id,
    name,
    description,
    type,
    required,
    options,
    constraints,
    forced,
    default: defaultValue,
    intent,
    socials,
    oauth,
    emptyIsUndefined = false,
  } = option;

  const isDisabled = disabled || !(forced === undefined || forced === null);
  const forcedValue =
    forced !== undefined && forced !== null ? forced : undefined;

  switch (type) {
    case 'socials':
      return (
        <div className="flex items-center justify-center w-full gap-6 mt-2">
          {socials?.map((social) => (
            <SocialIcon key={social.id} id={social.id} url={social.url} />
          ))}
        </div>
      );
    case 'alert':
      return (
        <Alert
          intent={intent}
          title={name}
          description={<MarkdownLite>{description}</MarkdownLite>}
        />
      );
    case 'password':
      return (
        <div>
          <PasswordInput
            label={name}
            value={forcedValue ?? value ?? defaultValue}
            onValueChange={(value: string) =>
              onChange(emptyIsUndefined ? value || undefined : value)
            }
            required={required}
            disabled={isDisabled}
            minLength={
              constraints?.forceInUi !== false ? constraints?.min : undefined
            }
            maxLength={
              constraints?.forceInUi !== false ? constraints?.max : undefined
            }
          />
          {description && (
            <div className="text-xs text-[--muted] mt-1">
              <MarkdownLite>{description}</MarkdownLite>
            </div>
          )}
        </div>
      );
    case 'string':
      return (
        <div>
          <TextInput
            label={name}
            value={forcedValue ?? value ?? defaultValue}
            onValueChange={(value: string) =>
              onChange(emptyIsUndefined ? value || undefined : value)
            }
            required={required}
            minLength={
              constraints?.forceInUi !== false ? constraints?.min : undefined
            }
            maxLength={
              constraints?.forceInUi !== false ? constraints?.max : undefined
            }
            disabled={isDisabled}
          />
          {description && (
            <div className="text-xs text-[--muted] mt-1">
              <MarkdownLite>{description}</MarkdownLite>
            </div>
          )}
        </div>
      );
    case 'number':
      return (
        <div>
          <NumberInput
            value={forcedValue ?? value ?? defaultValue}
            label={name}
            onValueChange={(value: number, valueAsString: string) =>
              onChange(value)
            }
            required={required}
            step={
              constraints?.max
                ? Math.floor(constraints?.max / 100) > 0
                  ? Math.floor(constraints?.max / 100)
                  : 1
                : 1
            }
            disabled={isDisabled}
            min={
              constraints?.forceInUi !== false ? constraints?.min : undefined
            }
            max={
              constraints?.forceInUi !== false ? constraints?.max : undefined
            }
          />
          {description && (
            <div className="text-xs text-[--muted] mt-1">
              <MarkdownLite>{description}</MarkdownLite>
            </div>
          )}
        </div>
      );
    case 'boolean':
      return (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="font-medium text-sm">{name}</span>
            <Switch
              disabled={isDisabled}
              value={!!(forcedValue ?? value ?? defaultValue)}
              onValueChange={onChange}
            />
          </div>
          {description && (
            <div className="text-xs text-[--muted] mt-1">
              <MarkdownLite>{description}</MarkdownLite>
            </div>
          )}
        </div>
      );
    case 'select':
      return (
        <div>
          <Select
            label={name}
            value={forcedValue ?? value ?? defaultValue}
            onValueChange={onChange}
            options={
              options?.map((opt) => ({ label: opt.label, value: opt.value })) ??
              []
            }
            required={required}
            disabled={isDisabled}
          />
          {description && (
            <div className="text-xs text-[--muted] mt-1">
              <MarkdownLite>{description}</MarkdownLite>
            </div>
          )}
        </div>
      );
    case 'select-with-custom': {
      const isExistingOption = (val: string) => {
        return options?.some((opt) => opt.value === val);
      };

      const onValueChange = (val: string) => {
        if (val === 'undefined') {
          onChange(undefined);
        } else {
          onChange(val);
        }
      };

      const effectiveValue = forcedValue ?? value ?? defaultValue;
      const isCustom = !isExistingOption(effectiveValue);

      // When a user selects from the dropdown
      const handleSelectChange = (val: string) => {
        if (val === 'Custom') {
          // When "Custom" is selected, we clear the value to allow for new input.
          onValueChange('');
        } else {
          onValueChange(val);
        }
      };

      // When a user types in the custom input
      const handleCustomInputChange = (val: string) => {
        onValueChange(val);
      };

      const optionsWithCustom = [
        ...(options?.map((opt) => ({ label: opt.label, value: opt.value })) ??
          []),
        { label: 'Custom', value: 'Custom' },
      ];

      // The select's value is 'Custom' if the effectiveValue is not an existing option.
      const selectValue = isCustom ? 'Custom' : effectiveValue;

      // The custom text input should be shown if the mode is 'Custom'.
      const showCustomInput = selectValue === 'Custom';

      return (
        <div>
          <Select
            label={name}
            value={selectValue}
            onValueChange={handleSelectChange}
            options={optionsWithCustom}
            required={required}
            disabled={isDisabled}
          />
          {showCustomInput && (
            <TextInput
              label="Custom"
              // The text input shows the custom value.
              value={effectiveValue}
              onValueChange={handleCustomInputChange}
              required={required}
              disabled={isDisabled}
            />
          )}
          {description && (
            <div className="text-xs text-[--muted] mt-1">
              <MarkdownLite>{description}</MarkdownLite>
            </div>
          )}
        </div>
      );
    }
    case 'multi-select':
      return (
        <div>
          <Combobox
            label={name}
            value={(forcedValue ?? Array.isArray(value)) ? value : defaultValue}
            onValueChange={(value: any) =>
              onChange(
                emptyIsUndefined
                  ? value?.length === 0
                    ? undefined
                    : value
                  : value
              )
            }
            options={
              options?.map((opt) => ({
                label: opt.label,
                value: opt.value,
                textValue: opt.label,
              })) ?? []
            }
            multiple
            emptyMessage="No options"
            disabled={isDisabled}
            required={required}
            maxItems={
              constraints?.forceInUi !== false ? constraints?.max : undefined
            }
          />
          {description && (
            <div className="text-xs text-[--muted] mt-1">
              <MarkdownLite>{description}</MarkdownLite>
            </div>
          )}
        </div>
      );
    case 'url':
      return (
        <div>
          <TextInput
            label={name}
            value={forcedValue ?? value ?? defaultValue}
            onValueChange={(value: string) =>
              onChange(emptyIsUndefined ? value || undefined : value)
            }
            required={required}
            type="url"
            disabled={isDisabled}
            minLength={
              constraints?.forceInUi !== false ? constraints?.min : undefined
            }
            maxLength={
              constraints?.forceInUi !== false ? constraints?.max : undefined
            }
          />
          {description && (
            <div className="text-xs text-[--muted] mt-1">
              <MarkdownLite>{description}</MarkdownLite>
            </div>
          )}
        </div>
      );
    case 'oauth': {
      const [showInput, setShowInput] = useState(!!value);

      if (!showInput) {
        return (
          <div>
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3 bg-[--subtle] p-4 rounded-lg">
                <div className="flex-1">
                  <h4 className="font-medium mb-1">{name}</h4>
                  <p className="text-sm text-[--muted]">
                    <MarkdownLite>{description}</MarkdownLite>
                  </p>
                </div>
                <IconButton
                  icon={<FaKey />}
                  intent="primary-outline"
                  onClick={() => {
                    window.open(oauth?.authorisationUrl || '', '_blank');
                    setShowInput(true);
                  }}
                  className="shrink-0"
                />
              </div>
            </div>
          </div>
        );
      }

      return (
        <div>
          <div className="flex flex-col gap-3">
            <div className="bg-[--subtle] p-4 rounded-lg">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-medium">
                  Enter {oauth?.oauthResultField?.name || 'Authorization Code'}
                </h4>
                <IconButton
                  icon={<FaArrowLeft className="w-4 h-4" />}
                  intent="primary-subtle"
                  size="sm"
                  onClick={() => setShowInput(false)}
                  aria-label="Go back to authorization"
                />
              </div>
              <PasswordInput
                value={forcedValue ?? value ?? defaultValue}
                onValueChange={(value: string) =>
                  onChange(emptyIsUndefined ? value || undefined : value)
                }
                required={required}
                disabled={isDisabled}
              />
              {oauth?.oauthResultField?.description && (
                <div className="text-sm text-[--muted] mt-2">
                  <MarkdownLite>
                    {oauth.oauthResultField.description}
                  </MarkdownLite>
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }
    case 'subsection': {
      const [modalOpen, setModalOpen] = useState(false);
      const subOptions = (option.subOptions ?? []) as Option[];
      const currentValue = (forcedValue ??
        value ??
        defaultValue ??
        {}) as Record<string, any>;

      // Local state for editing within the modal
      const [localValue, setLocalValue] =
        useState<Record<string, any>>(currentValue);

      // Reset local state when modal opens
      const handleOpenModal = () => {
        setLocalValue(currentValue);
        setModalOpen(true);
      };

      const handleLocalChange = (subOptionId: string, subValue: any) => {
        setLocalValue((prev) => ({
          ...prev,
          [subOptionId]: subValue,
        }));
      };

      const handleSave = () => {
        onChange(localValue);
        setModalOpen(false);
      };

      const handleCancel = () => {
        setLocalValue(currentValue);
        setModalOpen(false);
      };

      return (
        <div>
          <div className="flex items-center gap-3 bg-gray-100 dark:bg-gray-800 p-4 rounded-lg">
            <div className="flex-1">
              <h4 className="font-medium mb-1">{name}</h4>
              {description && (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  <MarkdownLite>{description}</MarkdownLite>
                </p>
              )}
            </div>
            <IconButton
              icon={<FaGear />}
              intent="primary-outline"
              onClick={handleOpenModal}
              // className="shrink-0"
              disabled={isDisabled}
              title={`Configure ${name}`}
            />
          </div>
          <Modal
            open={modalOpen}
            onOpenChange={(open) => !open && handleCancel()}
            title={name}
          >
            <div className="space-y-4">
              {subOptions.map(
                (subOption: Option): React.JSX.Element => (
                  <TemplateOption
                    key={subOption.id}
                    option={subOption}
                    value={localValue[subOption.id]}
                    onChange={(subValue) =>
                      handleLocalChange(subOption.id, subValue)
                    }
                    disabled={isDisabled}
                  />
                )
              )}
              <Button
                type="button"
                intent="primary"
                className="w-full"
                onClick={handleSave}
              >
                Save
              </Button>
            </div>
          </Modal>
        </div>
      );
    }
    case 'custom-nntp-servers': {
      return (
        <NNTPServersInput
          name={name}
          description={description}
          value={forcedValue ?? value ?? defaultValue}
          onChange={onChange}
          disabled={isDisabled}
        />
      );
    }
    default:
      return null;
  }
};

// Default empty server template
const createEmptyServer = (): NNTPServers[number] => ({
  username: '',
  password: '',
  host: '',
  port: 563,
  ssl: true,
  connections: 5,
});

// Decode base64 value to servers array
const decodeServers = (value: string | undefined): NNTPServers => {
  if (!value) return [];
  try {
    const decoded = Buffer.from(value, 'base64').toString('utf-8');
    return JSON.parse(decoded) as NNTPServers;
  } catch {
    return [];
  }
};

// Encode servers array to base64
const encodeServers = (servers: NNTPServers): string | undefined => {
  if (servers.length === 0) return undefined;
  return Buffer.from(JSON.stringify(servers)).toString('base64');
};

interface NNTPServersInputProps {
  name: string;
  description?: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  disabled?: boolean;
}

function NNTPServersInput({
  name,
  description,
  value,
  onChange,
  disabled,
}: NNTPServersInputProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [servers, setServers] = useState<NNTPServers>([]);

  // Sync servers state when modal opens
  useEffect(() => {
    if (modalOpen) {
      setServers(decodeServers(value));
    }
  }, [modalOpen, value]);

  const serverCount = decodeServers(value).length;

  const handleAddServer = () => {
    setServers((prev) => [...prev, createEmptyServer()]);
  };

  const handleRemoveServer = (index: number) => {
    setServers((prev) => prev.filter((_, i) => i !== index));
  };

  const handleMoveServer = (index: number, direction: 'up' | 'down') => {
    setServers((prev) => {
      const newServers = [...prev];
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= newServers.length) return prev;
      [newServers[index], newServers[targetIndex]] = [
        newServers[targetIndex],
        newServers[index],
      ];
      return newServers;
    });
  };

  const handleServerChange = (
    index: number,
    field: keyof NNTPServers[number],
    fieldValue: any
  ) => {
    setServers((prev) =>
      prev.map((server, i) =>
        i === index ? { ...server, [field]: fieldValue } : server
      )
    );
  };

  const handleSave = () => {
    // Filter out servers with empty required fields
    const validServers = servers.filter((s) => s.host.trim() !== '');
    onChange(encodeServers(validServers));
    setModalOpen(false);
  };

  const handleCancel = () => {
    setModalOpen(false);
  };

  return (
    <div>
      <div className="flex items-center gap-3 bg-[--subtle] p-4 rounded-lg">
        <div className="flex-1">
          <h4 className="font-medium mb-1">{name}</h4>
          {description && (
            <p className="text-sm text-[--muted]">
              <MarkdownLite>{description}</MarkdownLite>
            </p>
          )}
          {serverCount > 0 && (
            <p className="text-sm text-[--brand] mt-1">
              {serverCount} server{serverCount !== 1 ? 's' : ''} configured
            </p>
          )}
        </div>
        <IconButton
          icon={<FaServer />}
          intent="primary-outline"
          onClick={() => setModalOpen(true)}
          disabled={disabled}
          className="shrink-0"
        />
      </div>

      <Modal
        open={modalOpen}
        onOpenChange={setModalOpen}
        title="Configure NNTP Servers"
        contentClass="max-w-4xl"
      >
        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
          {servers.length === 0 ? (
            <div className="text-center py-8 text-[--muted]">
              <FaServer className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No servers configured</p>
              <p className="text-sm">Click the button below to add a server</p>
            </div>
          ) : (
            servers.map((server, index) => (
              <div
                key={index}
                className="border border-[--border] rounded-lg p-4 bg-[--subtle]"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="font-medium text-sm">
                    Server {index + 1}
                  </span>
                  <div className="flex items-center gap-1">
                    <IconButton
                      icon={<FaChevronUp className="w-4 h-4" />}
                      intent="gray-subtle"
                      size="sm"
                      onClick={() => handleMoveServer(index, 'up')}
                      disabled={index === 0}
                    />
                    <IconButton
                      icon={<FaChevronDown className="w-4 h-4" />}
                      intent="gray-subtle"
                      size="sm"
                      onClick={() => handleMoveServer(index, 'down')}
                      disabled={index === servers.length - 1}
                    />
                    <IconButton
                      icon={<FaTrashCan className="w-4 h-4" />}
                      intent="alert-subtle"
                      size="sm"
                      onClick={() => handleRemoveServer(index)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <TextInput
                    label="Host"
                    value={server.host}
                    onValueChange={(v) => handleServerChange(index, 'host', v)}
                    placeholder="news.example.com"
                    required
                  />
                  <NumberInput
                    label="Port"
                    value={server.port}
                    onValueChange={(v) => handleServerChange(index, 'port', v)}
                    min={1}
                    max={65535}
                    required
                  />
                  <TextInput
                    label="Username"
                    value={server.username}
                    onValueChange={(v) =>
                      handleServerChange(index, 'username', v)
                    }
                    placeholder="username"
                    required
                  />
                  <PasswordInput
                    label="Password"
                    value={server.password}
                    onValueChange={(v) =>
                      handleServerChange(index, 'password', v)
                    }
                    placeholder="password"
                    required
                  />
                  <NumberInput
                    label="Connections"
                    value={server.connections}
                    onValueChange={(v) =>
                      handleServerChange(index, 'connections', v)
                    }
                    min={1}
                    max={500}
                    required
                  />
                  <div className="flex items-end pb-1">
                    <Switch
                      label="Use SSL"
                      value={server.ssl}
                      onValueChange={(v) => handleServerChange(index, 'ssl', v)}
                      side="right"
                    />
                  </div>
                </div>
              </div>
            ))
          )}

          <Button
            type="button"
            intent="primary-outline"
            className="w-full"
            leftIcon={<FaPlus className="w-4 h-4" />}
            onClick={handleAddServer}
          >
            Add Server
          </Button>
        </div>

        <div className="flex gap-2 mt-4 pt-4 border-t border-[--border]">
          <Button
            type="button"
            className="w-full"
            intent="primary-outline"
            onClick={handleCancel}
          >
            Cancel
          </Button>
          <Button type="button" className="w-full" onClick={handleSave}>
            Save
          </Button>
        </div>
      </Modal>
    </div>
  );
}

export default TemplateOption;
