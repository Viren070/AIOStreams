import React from 'react';
import { Modal } from '@/components/ui/modal';
import { TextInput } from '@/components/ui/text-input';
import { Button } from '@/components/ui/button';
import { UserConfigAPI } from '@/services/api';
import { useUserData } from '@/context/userData';
import { toast } from 'sonner';
import { PasswordInput } from './ui/password-input';

interface ConfigModalProps {
  open: boolean;
  onSuccess: () => void;
  onOpenChange: (v: boolean) => void;
  initialUuid?: string;
}

export function ConfigModal({
  open,
  onSuccess,
  onOpenChange,
  initialUuid,
}: ConfigModalProps) {
  const { setUserData, setUuid, setPassword, setEncryptedPassword } =
    useUserData();
  const [uuid, setUuidInput] = React.useState(initialUuid || '');
  const [password, setPasswordInput] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  console.log(`received initialUuid: ${initialUuid}`);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);

    try {
      const result = await UserConfigAPI.loadConfig(uuid, password);

      if (!result.success || !result.data) {
        toast.error(result.error?.message || 'Failed to load configuration');
        return;
      }

      setUserData((prev) => ({
        ...prev,
        ...result.data!.config, // we just checked that this is not null
      }));
      setUuid(uuid);
      setPassword(password);
      setEncryptedPassword(result.data.encryptedPassword);
      onSuccess();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to load configuration'
      );
    } finally {
      setLoading(false);
    }
  };

  // Reset form when modal opens/closes
  React.useEffect(() => {
    if (!open) {
      setPasswordInput('');
    }
  }, [open]);

  // Handle initialUuid changes
  React.useEffect(() => {
    if (initialUuid) {
      setUuidInput(initialUuid);
    } else {
      setUuidInput('');
    }
  }, [initialUuid]);

  const handleCancel = () => {
    onOpenChange(false);
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Load Configuration">
      <form onSubmit={handleSubmit} className="space-y-4">
        <TextInput
          label="UUID"
          id="uuid"
          value={uuid}
          onValueChange={(value) => setUuidInput(value)}
          placeholder="Enter your configuration UUID"
          required
          disabled={!!initialUuid}
        />
        <PasswordInput
          label="Password"
          id="password"
          value={password}
          onValueChange={(value) => setPasswordInput(value)}
          placeholder="Enter your configuration password"
          required
        />
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={handleCancel}>
            Cancel
          </Button>
          <Button type="submit" loading={loading}>
            Load
          </Button>
        </div>
      </form>
    </Modal>
  );
}
