import { Modal } from '@/components/ui/modal';
import { PasswordInput } from '@/components/ui/password-input';
import { Button } from '@/components/ui/button';

interface AddonPasswordModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  onSubmit: () => void;
  submitText: string;
  value: string;
  onValueChange: (value: string) => void;
}

export function AddonPasswordModal({
  open,
  onOpenChange,
  loading,
  onSubmit,
  submitText,
  value,
  onValueChange,
}: AddonPasswordModalProps) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Addon Password"
      description={`This instance is protected with a password. You must enter the password for this instance (NOT your user password you set earlier) to ${submitText.toLowerCase()} a configuration here.`}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <PasswordInput
          label="Addon Password"
          value={value}
          required
          placeholder="Enter the password for this instance"
          onValueChange={onValueChange}
        />
        <Button type="submit" intent="white" loading={loading} rounded>
          {submitText}
        </Button>
      </form>
    </Modal>
  );
}
