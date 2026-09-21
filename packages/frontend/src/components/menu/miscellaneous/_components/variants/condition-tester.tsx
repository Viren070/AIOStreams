import React, { useEffect, useState } from 'react';
import { useUserData } from '@/context/userData';
import { SettingsCard } from '../../../../shared/settings-card';
import { Button } from '@/components/ui/button';
import { TextInput } from '@/components/ui/text-input';
import { Select } from '@/components/ui/select';
import { Alert } from '@/components/ui/alert';
import { toast } from 'sonner';
import { FiCheck, FiPlay, FiX } from 'react-icons/fi';
import type { UserData } from '@aiostreams/core';
import {
  evaluateVariantConditions,
  loadClientAgents,
  type ClientAgent,
  type VariantEvaluation,
} from '@/lib/api';

type Variant = NonNullable<UserData['variants']>[number];

const RESOURCES = [
  'stream',
  'manifest.json',
  'catalog',
  'meta',
  'subtitles',
  'addon_catalog',
];

interface Props {
  variants: Variant[];
  healthChecks: UserData['healthChecks'];
}

/**
 * Answers "why did my TV get this config". Conditions are evaluated server
 * side against a request you describe, using the variants as currently edited.
 */
export function ConditionTester({ variants, healthChecks }: Props) {
  const { uuid, password } = useUserData();
  const [userAgent, setUserAgent] = useState('');
  const [resource, setResource] = useState('stream');
  const [type, setType] = useState('movie');
  const [id, setId] = useState('tt0111161');
  const [queryString, setQueryString] = useState('');
  const [result, setResult] = useState<VariantEvaluation | null>(null);
  const [agents, setAgents] = useState<ClientAgent[]>([]);
  const [running, setRunning] = useState(false);

  const saved = Boolean(uuid);

  useEffect(() => {
    setUserAgent(navigator.userAgent);
  }, []);

  useEffect(() => {
    if (!uuid) return;
    loadClientAgents(uuid, password)
      .then(setAgents)
      .catch(() => setAgents([]));
  }, [uuid, password]);

  const run = async () => {
    if (!uuid) return;
    setRunning(true);
    try {
      const query: Record<string, string> = {};
      for (const [key, value] of new URLSearchParams(queryString)) {
        query[key] = value;
      }
      setResult(
        await evaluateVariantConditions(uuid, password, {
          variants,
          healthChecks,
          userAgent,
          resource,
          type: type || undefined,
          id: id || undefined,
          query,
        })
      );
    } catch (error: any) {
      setResult(null);
      toast.error(error?.message ?? 'Could not evaluate the conditions');
    } finally {
      setRunning(false);
    }
  };

  return (
    <SettingsCard
      title="Test conditions"
      description="Describe a request and see which variants would activate for it."
    >
      {!saved && (
        <Alert
          intent="info-basic"
          title="Save this configuration first"
          description="Conditions are evaluated on the server, against the configuration you have saved."
        />
      )}

      {agents.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Recently seen clients</p>
          <p className="text-xs text-[--muted]">
            The last {agents.length} user agent
            {agents.length === 1 ? '' : 's'} seen on stream and catalogue
            requests. Installing does not count: a client can install with one
            user agent and play with another. Select one to test against it.
          </p>
          <div className="flex flex-col gap-1">
            {agents.map((agent) => (
              <button
                key={agent.userAgent}
                type="button"
                onClick={() => setUserAgent(agent.userAgent)}
                className="text-left text-xs px-2 py-1.5 rounded bg-[--subtle] hover:bg-[--subtle-highlight] break-all"
              >
                <span className="font-mono">{agent.userAgent}</span>
                <span className="text-[--muted]">
                  {' '}
                  · {agent.requests} request{agent.requests === 1 ? '' : 's'} ·
                  last {new Date(agent.lastSeen).toLocaleString()}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <TextInput
        label="User agent"
        value={userAgent}
        onValueChange={setUserAgent}
      />

      <div className="grid gap-3 md:grid-cols-2">
        <Select
          label="Resource"
          value={resource}
          onValueChange={setResource}
          options={RESOURCES.map((value) => ({ label: value, value }))}
        />
        <TextInput label="Type" value={type} onValueChange={setType} />
        <TextInput label="Id" value={id} onValueChange={setId} />
        <TextInput
          label="Query"
          help="As it would appear in the URL, e.g. profile=tv&hd=1"
          value={queryString}
          onValueChange={setQueryString}
        />
      </div>

      <div>
        <Button
          size="sm"
          intent="white"
          rounded
          leftIcon={<FiPlay />}
          onClick={run}
          disabled={!saved || running}
        >
          {running ? 'Evaluating...' : 'Evaluate'}
        </Button>
      </div>

      {result && (
        <div className="space-y-3">
          <div className="space-y-1">
            {result.variants.length === 0 && (
              <p className="text-sm text-[--muted]">
                No variant has an activation condition.
              </p>
            )}
            {result.variants.map((outcome) => (
              <div
                key={outcome.id}
                className="flex items-start gap-2 text-sm px-2 py-1.5 rounded bg-[--subtle]"
              >
                {outcome.matched ? (
                  <FiCheck className="mt-0.5 shrink-0 text-[--green]" />
                ) : (
                  <FiX className="mt-0.5 shrink-0 text-[--muted]" />
                )}
                <div className="min-w-0">
                  <span className="font-medium">{outcome.id}</span>
                  <span className="text-[--muted] font-mono text-xs break-all">
                    {' '}
                    {outcome.when}
                  </span>
                  {outcome.error && (
                    <p className="text-xs text-[--red]">{outcome.error}</p>
                  )}
                </div>
              </div>
            ))}
          </div>

          {Object.keys(result.health).length > 0 && (
            <div className="space-y-1">
              <p className="text-sm font-medium">Health checks</p>
              {Object.entries(result.health).map(([checkId, health]) => (
                <div
                  key={checkId}
                  className="flex items-start gap-2 text-sm px-2 py-1.5 rounded bg-[--subtle]"
                >
                  {health.ok ? (
                    <FiCheck className="mt-0.5 shrink-0 text-[--green]" />
                  ) : (
                    <FiX className="mt-0.5 shrink-0 text-[--red]" />
                  )}
                  <div className="min-w-0">
                    <span className="font-medium">{checkId}</span>
                    <span className="text-[--muted] text-xs">
                      {' '}
                      {health.status ? `HTTP ${health.status}` : ''}
                      {health.error ? ` ${health.error}` : ''} · checked{' '}
                      {new Date(health.checkedAt).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </SettingsCard>
  );
}
