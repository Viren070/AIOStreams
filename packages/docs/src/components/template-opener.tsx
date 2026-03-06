'use client';

import { useState } from 'react';
import { instances } from '@/lib/instances';
import { CodeBlock, Pre } from 'fumadocs-ui/components/codeblock';
import { Steps, Step } from 'fumadocs-ui/components/steps';
import { FaExternalLinkAlt } from 'react-icons/fa';
import { Callout } from 'fumadocs-ui/components/callout';

const SELF_HOSTED_ID = '__self_hosted__';

interface TemplateOpenerProps {
  /** Absolute URL pointing to the template JSON file */
  templateUrl: string;
  /**
   * Which channel to default to when an instance supports both.
   * Also shown as a recommendation callout when set to 'nightly'.
   * @default 'stable'
   */
  defaultChannel?: 'stable' | 'nightly';
  /** Optional content rendered above the manual import instructions when "My Own Instance" is selected */
  children?: React.ReactNode;
}

export function TemplateOpener({
  templateUrl,
  defaultChannel = 'stable',
  children,
}: TemplateOpenerProps) {
  // Pick the first instance that has the preferred channel, falling back to the first instance overall
  const firstInstance =
    instances.find((i) =>
      defaultChannel === 'nightly' ? i.nightly : i.stable
    ) ?? instances[0];

  const [selectedId, setSelectedId] = useState(firstInstance.id);
  const [channel, setChannel] = useState<'stable' | 'nightly'>(
    firstInstance.nightly && defaultChannel === 'nightly'
      ? 'nightly'
      : firstInstance.stable
        ? 'stable'
        : 'nightly'
  );

  const isSelfHosted = selectedId === SELF_HOSTED_ID;
  const selected = isSelfHosted
    ? null
    : instances.find((i) => i.id === selectedId)!;

  const hasStable = Boolean(selected?.stable);
  const hasNightly = Boolean(selected?.nightly);

  const baseUrl =
    selected == null
      ? null
      : channel === 'nightly' && hasNightly
        ? selected.nightly!
        : (selected.stable ?? selected.nightly!);

  const openUrl =
    baseUrl != null
      ? `${baseUrl}/stremio/configure?menu=about&template=${encodeURIComponent(templateUrl)}`
      : null;

  function handleSelect(id: string) {
    setSelectedId(id);
    if (id === SELF_HOSTED_ID) return;
    const inst = instances.find((i) => i.id === id)!;
    // Prefer defaultChannel if available, otherwise use whatever the instance has
    if (defaultChannel === 'nightly' && inst.nightly) {
      setChannel('nightly');
    } else if (defaultChannel === 'stable' && inst.stable) {
      setChannel('stable');
    } else if (inst.stable) {
      setChannel('stable');
    } else {
      setChannel('nightly');
    }
  }

  return (
    <div className="not-prose my-6 space-y-4">
      {defaultChannel === 'nightly' && (
        <Callout type="warning">
          <strong>Nightly recommended:</strong> This template is developed and
          tested against nightly builds. It will generally work on stable too,
          but is not guaranteed — nightly instances are recommended. In practice
          nightly is very stable and rarely causes issues.
        </Callout>
      )}

      <p className="text-sm text-fd-muted-foreground">
        Select an instance to open the setup template on:
      </p>

      {/* Instance grid */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {instances.map((instance) => (
          <button
            key={instance.id}
            onClick={() => handleSelect(instance.id)}
            className={[
              'rounded-lg border px-3 py-2 text-left text-sm transition-colors',
              selectedId === instance.id
                ? 'border-fd-primary bg-fd-primary/10 text-fd-primary'
                : 'border-fd-border bg-fd-card hover:border-fd-primary/50 hover:bg-fd-accent',
            ].join(' ')}
          >
            <div className="font-medium leading-tight">{instance.name}</div>
            {instance.hostedBy && (
              <div className="mt-0.5 truncate text-xs text-fd-muted-foreground">
                {instance.hostedBy}
              </div>
            )}
          </button>
        ))}

        {/* Self-hosted tile */}
        <button
          onClick={() => handleSelect(SELF_HOSTED_ID)}
          className={[
            'rounded-lg border px-3 py-2 text-left text-sm transition-colors',
            selectedId === SELF_HOSTED_ID
              ? 'border-fd-primary bg-fd-primary/10 text-fd-primary'
              : 'border-fd-border bg-fd-card hover:border-fd-primary/50 hover:bg-fd-accent',
          ].join(' ')}
        >
          <div className="font-medium leading-tight">My Own Instance</div>
          <div className="mt-0.5 truncate text-xs text-fd-muted-foreground">
            Self-hosted
          </div>
        </button>
      </div>

      {/* Channel selector — always visible for non-self-hosted; unavailable channel is disabled */}
      {!isSelfHosted && (
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-fd-muted-foreground">Channel:</span>
          {(['stable', 'nightly'] as const).map((ch) => {
            const available = ch === 'stable' ? hasStable : hasNightly;
            return (
              <button
                key={ch}
                onClick={() => available && setChannel(ch)}
                disabled={!available}
                title={
                  !available
                    ? `${selected?.name} does not have a ${ch} build`
                    : undefined
                }
                className={[
                  'rounded px-3 py-1 text-xs font-medium capitalize transition-colors',
                  channel === ch && available
                    ? 'bg-fd-primary text-fd-primary-foreground'
                    : available
                      ? 'bg-fd-muted text-fd-muted-foreground hover:bg-fd-accent'
                      : 'cursor-not-allowed bg-fd-muted/40 text-fd-muted-foreground/40 line-through',
                ].join(' ')}
              >
                {ch}
              </button>
            );
          })}
        </div>
      )}

      {/* Self-hosted manual instructions */}
      {isSelfHosted ? (
        <div className="space-y-3 rounded-lg border border-fd-border bg-fd-card p-4">
          <p className="text-sm font-medium">Import the template manually</p>
          {children && <div className="text-sm">{children}</div>}
          <Steps>
            <Step>
              Open your AIOStreams configure page, go to the{' '}
              <strong>About</strong> menu and click{' '}
              <strong>Use a Template</strong>.
            </Step>

            <Step>
              Click the <strong>import icon</strong> (bottom-right of the
              template list).
            </Step>

            <Step>
              Paste in the template URL below and click <strong>Go</strong>.
            </Step>
          </Steps>
          <CodeBlock lang="sh">
            <Pre className="px-4">
              <code>{templateUrl}</code>
            </Pre>
          </CodeBlock>
        </div>
      ) : (
        /* CTA */
        <div className="space-y-2">
          <a
            href={openUrl!}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-fd-primary px-4 py-2 text-sm font-semibold text-fd-primary-foreground transition-opacity hover:opacity-90"
          >
            Open Template on {selected!.name}
            <FaExternalLinkAlt size={12} />
          </a>
          <p className="text-xs text-fd-muted-foreground">
            Opens{' '}
            <code className="rounded bg-fd-muted px-1 py-0.5 font-mono text-[0.7rem]">
              {baseUrl}/stremio/configure
            </code>{' '}
            with the template pre-loaded.
          </p>
        </div>
      )}
    </div>
  );
}
