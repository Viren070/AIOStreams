import React from 'react';
import { plural, t } from '@lingui/core/macro';
import { LuArrowDown, LuArrowUp, LuX } from 'react-icons/lu';
import { Trans } from '@lingui/react/macro';
import { toast } from 'sonner';
import { Select } from '@aiostreams/ui/select';
import { Button, IconButton } from '@aiostreams/ui/button';
import { BasicField } from '@aiostreams/ui/basic-field';
import { cn } from '@aiostreams/ui/core/styling';
import { LANGUAGES, languageName } from '@/lib/languages';
import { focusOn } from '@/lib/input';
import { SettingsRow } from './settings-card';

export const onDevice = () => t`Kept on this device.`;
export const onAccount = (locked?: boolean) =>
  locked
    ? t`This server doesn't let your account change these.`
    : t`Saved to your account, so your other devices and Jellyfin apps use it too.`;
export const followsYou = () =>
  t`Saved to your account, so it follows you to every device.`;

export const DOCS_URL = 'https://aiostreams.org';

export const seconds = (count: number) =>
  plural(count, { one: '# second', other: '# seconds' });

export const languageOptions = () =>
  LANGUAGES.map((l) => ({ value: l.code, label: languageName(l) }));

/** Languages in order, each movable, with a picker for another. */
export function LanguageList({
  label,
  help,
  options,
  value,
  max,
  fixed,
  onChange,
}: {
  label: string;
  help: string;
  options: { value: string; label: string }[];
  value: string[];
  /** One for a server that keeps only Jellyfin's single language. */
  max?: number;
  /** Every option always listed, only reordered. */
  fixed?: boolean;
  onChange: (next: string[]) => void;
}) {
  const list = React.useRef<HTMLOListElement>(null);
  const add = React.useRef<HTMLButtonElement>(null);
  const nameOf = (code: string) =>
    options.find((o) => o.value === code)?.label ?? code;
  const move = (from: number, to: number) => {
    if (to < 0 || to >= value.length) return;
    const next = [...value];
    next.splice(to, 0, ...next.splice(from, 1));
    onChange(next);
  };
  // A removed row takes focus with it, so the next row's button takes it over.
  const removed = React.useRef<number | null>(null);
  React.useLayoutEffect(() => {
    const at = removed.current;
    if (at === null) return;
    removed.current = null;
    const left =
      list.current?.querySelectorAll<HTMLElement>('[data-name=remove]');
    const next = left?.[Math.min(at, left.length - 1)] ?? add.current;
    if (next) focusOn(next);
  }, [value]);
  const remove = (at: number) => {
    removed.current = at;
    onChange(value.filter((_, i) => i !== at));
  };
  const button = (
    name: string,
    label: string,
    icon: React.ReactElement,
    onClick: () => void,
    dim = false
  ) => (
    <IconButton
      data-name={name}
      size="sm"
      intent={name === 'remove' ? 'alert-subtle' : 'gray-subtle'}
      // Enabled at the ends, as a remote's focus can't rest on a disabled button.
      className={cn('size-8 rounded-full', dim && 'opacity-40')}
      icon={icon}
      aria-label={label}
      aria-disabled={dim || undefined}
      onClick={onClick}
    />
  );
  return (
    <BasicField label={label} help={help}>
      {value.length > 0 && (
        <ol ref={list} data-ui="language-list" className="space-y-1">
          {value.map((code, i) => {
            const name = nameOf(code);
            return (
              <li
                key={code}
                className="flex items-center gap-2 rounded-xl bg-[--subtle] py-1 ps-3 pe-1"
              >
                <span className="w-4 text-sm tabular-nums text-[--muted]">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">{name}</span>
                {button(
                  'up',
                  t`Move ${name} up`,
                  <LuArrowUp />,
                  () => move(i, i - 1),
                  i === 0
                )}
                {button(
                  'down',
                  t`Move ${name} down`,
                  <LuArrowDown />,
                  () => move(i, i + 1),
                  i === value.length - 1
                )}
                {!fixed &&
                  button('remove', t`Remove ${name}`, <LuX />, () => remove(i))}
              </li>
            );
          })}
        </ol>
      )}
      {!fixed && (max === undefined || value.length < max) && (
        <Select
          ref={add}
          // Required leaves the placeholder out of the list it opens.
          required
          placeholder={
            value.length ? t`Add another language` : t`Add a language`
          }
          options={options.filter((o) => !value.includes(o.value))}
          value=""
          onValueChange={(v) => v && onChange([...value, v])}
        />
      )}
    </BasicField>
  );
}

export function ShaderFilesRow({
  help,
  accept,
  read,
  add,
  remove,
}: {
  help: string;
  accept: string;
  read(): Promise<string[]>;
  add(name: string, text: string): Promise<string[]>;
  remove(name: string): Promise<string[]>;
}) {
  const [names, setNames] = React.useState<string[] | null>(null);
  const picker = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    read().then(setNames, () => setNames([]));
  }, [read]);
  const failed = (e: Error) => toast.error(e.message);
  return (
    <div className="flex flex-col gap-3">
      <SettingsRow label={t`Shaders`} help={help}>
        <input
          ref={picker}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            file
              .text()
              .then((text) => add(file.name, text))
              .then(setNames, failed);
          }}
        />
        <Button
          intent="gray-outline"
          className="w-full rounded-full sm:w-auto"
          disabled={names === null}
          onClick={() => picker.current?.click()}
        >
          <Trans>Add a shader</Trans>
        </Button>
      </SettingsRow>
      {names?.map((name) => (
        <div key={name} className="flex items-center justify-between gap-3">
          <span className="min-w-0 truncate font-mono text-sm">{name}</span>
          <Button
            intent="gray-outline"
            size="sm"
            className="flex-none rounded-full"
            onClick={() => remove(name).then(setNames, failed)}
          >
            <Trans>Remove</Trans>
          </Button>
        </div>
      ))}
    </div>
  );
}
