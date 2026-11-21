import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import React from 'react';
import { Button } from '@aiostreams/ui/button';
import { Modal } from '@aiostreams/ui/modal';
import { Switch } from '@aiostreams/ui/switch';
import { currentHost } from '@/lib/hosts';
import { useRestoreFocus } from '@/lib/input';
import { GESTURES, settings, useSetting, type Gesture } from '@/lib/settings';
import { SettingsRow } from './settings-card';

function gestureText(gesture: Gesture): { label: string; help?: string } {
  switch (gesture) {
    case 'seek':
      return {
        label: t`Double tap to skip`,
        help: t`On either side of the video, by the skip length.`,
      };
    case 'scrub':
      return { label: t`Swipe across to seek` };
    case 'volume':
      return { label: t`Swipe up or down on the right for volume` };
    case 'brightness':
      return { label: t`Swipe up or down on the left for brightness` };
    case 'hold':
      return {
        label: t`Hold to speed up`,
        help: t`With a finger or the mouse button, at the held speed.`,
      };
    case 'pinch':
      return { label: t`Pinch to fill the screen` };
  }
}

/** A mouse only holds; a touch screen has the rest, and brightness only in the app. */
function gesturesHere(): Gesture[] {
  if (!matchMedia('(any-pointer: coarse)').matches) return ['hold'];
  return GESTURES.filter((g) => g !== 'brightness' || !!currentHost().levels);
}

export function GestureSettings() {
  const [gestures, setGestures] = useSetting(settings.controls.gestures);
  const [open, setOpen] = React.useState(false);
  const restoreFocus = useRestoreFocus(open);
  const here = gesturesHere();
  const off = here.filter((g) => !gestures[g]).length;
  const toggle = (gesture: Gesture) => {
    const { label, help } = gestureText(gesture);
    return (
      <Switch
        key={gesture}
        side="right"
        label={label}
        help={help}
        value={gestures[gesture]}
        onValueChange={(value) =>
          setGestures({ ...gestures, [gesture]: value })
        }
      />
    );
  };
  if (here.length === 1) return toggle(here[0]);
  return (
    <>
      <SettingsRow
        label={t`Gestures`}
        help={t`What touching or holding the video does.`}
      >
        <Button
          intent="gray-outline"
          size="sm"
          className="w-full rounded-full sm:w-auto"
          onClick={() => setOpen(true)}
        >
          {off ? t`${off} off` : t`All on`}
        </Button>
      </SettingsRow>
      <Modal
        data-ui="dialog"
        data-name="gestures"
        open={open}
        onOpenChange={setOpen}
        onCloseAutoFocus={restoreFocus}
        title={t`Gestures`}
        contentClass="max-w-md"
      >
        {here.map(toggle)}
        <div className="flex justify-end">
          <Button
            intent="white"
            className="rounded-full"
            onClick={() => setOpen(false)}
          >
            <Trans>Done</Trans>
          </Button>
        </div>
      </Modal>
    </>
  );
}
