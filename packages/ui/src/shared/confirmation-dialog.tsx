import { Button, ButtonProps } from '../button';
import { Modal } from '../modal';
import { useDisclosure, UseDisclosureReturn } from '../hooks/disclosure';
import React from 'react';
import { uiText } from '../core/text';

type ConfirmationDialogHookProps = {
  title: string;
  description?: string | React.ReactNode;
  actionText?: string;
  actionIntent?: ButtonProps['intent'];
  onConfirm: () => void;
};

export function useConfirmationDialog(props: ConfirmationDialogHookProps) {
  const api = useDisclosure(false);
  return {
    ...api,
    ...props,
  };
}

export const ConfirmationDialog: React.FC<
  ConfirmationDialogHookProps & UseDisclosureReturn
> = (props) => {
  const {
    isOpen,
    close,
    onConfirm,
    title,
    description = uiText.areYouSure,
    actionText = uiText.confirm,
    actionIntent = 'alert-subtle',
  } = props;

  return (
    <>
      <Modal
        title={title}
        titleClass="text-center"
        open={isOpen}
        onOpenChange={close}
      >
        <div className="space-y-4">
          <p className="text-center break-words">{description}</p>
          <div className="flex gap-2 justify-center items-center">
            <Button
              intent={actionIntent}
              onClick={() => {
                onConfirm();
                close();
              }}
            >
              {actionText}
            </Button>
            <Button intent="white" onClick={close}>
              {uiText.cancel}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
};
