import React from 'react';
import { toast } from 'sonner';
import { LuPlus, LuUndo2, LuX } from 'react-icons/lu';
import { Button, IconButton } from '@aiostreams/ui/button';
import { currentHost } from '../lib/hosts';
import {
  GROUP_LABELS,
  action,
  clashWith,
  groupActions,
  inputLabels,
  keysOf,
  record,
  setKeys,
  type ActionGroup,
  type ActionId,
} from '../lib/input';
import { settings, useSetting } from '../lib/settings';
import { KeyCaps } from './key-caps';
import { SettingsCard, SettingsRow } from './settings-card';

const GROUPS: { group: ActionGroup; description: string }[] = [
  {
    group: 'general',
    description:
      'Kept on this device. Select + and press a key to add it; a remote, a gamepad or the scroll wheel works too.',
  },
  {
    group: 'navigation',
    description:
      "Moves between what's on screen, and to Search and Home. A gamepad's d-pad and left stick move too.",
  },
  {
    group: 'player',
    description:
      'Once one of the controls is selected, the arrow keys move between the controls instead.',
  },
  { group: 'sync', description: 'While syncing subtitles by ear.' },
];

function ShortcutRow({
  id,
  keys,
  changed,
  recording,
  onRecord,
}: {
  id: ActionId;
  keys: readonly string[];
  changed: boolean;
  recording: boolean;
  onRecord(on: boolean): void;
}) {
  const { label, help, fixed, summary } = action(id);
  const chips = summary
    ? keys.length
      ? [{ input: summary, rest: [] }]
      : []
    : keys.map((key) => ({ input: key, rest: keys.filter((k) => k !== key) }));
  return (
    <SettingsRow label={label} help={help}>
      <div
        data-ui="shortcut-keys"
        className="flex flex-wrap items-center gap-2 sm:justify-end"
      >
        {chips.map(({ input, rest }) => (
          <span key={input} className="inline-flex items-center gap-0.5">
            <KeyCaps input={input} />
            <button
              type="button"
              aria-label={`Remove ${inputLabels(input).join(' ')}`}
              onClick={() => setKeys(id, rest)}
              className="flex size-5 items-center justify-center rounded-full text-[--muted] transition-colors hover:bg-white/10 hover:text-white"
            >
              <LuX className="size-3" />
            </button>
          </span>
        ))}
        {!fixed &&
          (recording ? (
            <Button
              autoFocus
              size="sm"
              intent="white-subtle"
              rounded
              className="animate-pulse"
              onClick={() => onRecord(false)}
              onBlur={() => onRecord(false)}
            >
              Press a key
            </Button>
          ) : (
            <IconButton
              size="sm"
              intent="gray-subtle"
              className="size-7 rounded-full"
              icon={<LuPlus />}
              aria-label={`Add a key for ${label}`}
              onClick={() => onRecord(true)}
            />
          ))}
        {changed && (
          <IconButton
            size="sm"
            intent="gray-basic"
            className="size-7 rounded-full"
            icon={<LuUndo2 />}
            aria-label={`Reset ${label}`}
            onClick={() => setKeys(id, [...action(id).keys])}
          />
        )}
      </div>
    </SettingsRow>
  );
}

export function ShortcutSettings() {
  const [overrides, setOverrides] = useSetting(settings.shortcuts);
  const [recording, setRecording] = React.useState<ActionId | null>(null);

  React.useEffect(() => {
    if (!recording) return;
    return record((input) => {
      setRecording(null);
      // Esc cancels, so it can only be bound by resetting Back.
      if (input === 'Escape') return;
      const clash = clashWith(recording, input);
      if (clash) {
        toast.error(
          `${inputLabels(input).join(' ')} is taken by ${action(clash).label}`
        );
        return;
      }
      const keys = keysOf(recording);
      if (!keys.includes(input)) setKeys(recording, [...keys, input]);
    });
  }, [recording]);

  const host = currentHost();
  return (
    <>
      {GROUPS.map(({ group, description }) => {
        const ids = groupActions(group, host);
        return (
          ids.length > 0 && (
            <SettingsCard
              key={group}
              title={GROUP_LABELS[group]}
              description={description}
            >
              {ids.map((id) => (
                <ShortcutRow
                  key={id}
                  id={id}
                  keys={keysOf(id, overrides)}
                  changed={!!overrides[id]}
                  recording={recording === id}
                  onRecord={(on) =>
                    setRecording((current) =>
                      on ? id : current === id ? null : current
                    )
                  }
                />
              ))}
            </SettingsCard>
          )
        );
      })}
      <SettingsCard>
        <SettingsRow
          label="Reset all shortcuts"
          help="Puts every key back the way it came."
        >
          <Button
            intent="gray-outline"
            size="sm"
            rounded
            className="max-sm:w-full"
            disabled={!Object.keys(overrides).length}
            onClick={() => setOverrides({})}
          >
            Reset all
          </Button>
        </SettingsRow>
      </SettingsCard>
    </>
  );
}
