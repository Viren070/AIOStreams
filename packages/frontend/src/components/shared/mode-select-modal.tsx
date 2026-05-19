import React from 'react';
import { Modal } from '../ui/modal';
import { ModeSwitch } from '../ui/mode-switch/mode-switch';
import { useMode } from '@/context/mode';
import { Button } from '../ui/button';

interface ModeSelectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ModeSelectModal({ open, onOpenChange }: ModeSelectModalProps) {
  const { mode, setMode, setIsFirstTime } = useMode();

  const handleContinue = () => {
    setIsFirstTime(false);
    onOpenChange(false);
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Welcome to AIOStreams!"
      hideCloseButton
    >
      <div className="flex flex-col gap-6">
        <div className="space-y-4">
          <p className="text-gray-300">
            Choose your preferred mode to customize your experience:
          </p>
          <div className="space-y-4 p-4 rounded-lg bg-gray-900/40 border border-gray-800">
            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-[--brand]">Simple</h3>
              <p className="text-sm text-gray-400">
                Perfect for beginners! Essential options only.
              </p>
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-[--brand]">Advanced</h3>
              <p className="text-sm text-gray-400">
                For advanced users who want full control. Access all
                configuration options and advanced features for maximum
                customisation of your streaming setup.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <ModeSwitch
            value={mode}
            onChange={setMode}
            size="lg"
            className="w-full"
          />
          <div className="flex justify-center">
            <Button intent="primary" onClick={handleContinue}>
              Continue
            </Button>
          </div>
          <p className="text-xs text-center text-gray-500">
            Don't worry! You can always change this later in the About menu.
          </p>
        </div>
      </div>
    </Modal>
  );
}
