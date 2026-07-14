import React from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { z } from 'zod';
import type { UseFormReturn } from 'react-hook-form';
import { toast } from 'sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Form } from '@/components/ui/form';
import { Alert } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { cn } from '@/components/ui/core/styling';
import { PageWrapper } from '@/components/shared/page-wrapper';
import { Spinner } from '@/components/ui/loading-spinner';
import { LuffyError } from '@/components/shared/luffy-error';
import { useSettings, useSaveSettings, type SettingsKey } from './queries';
import { tabFor, humanise } from './tabs.config';
import {
  SettingsCard,
  SettingsNavCard,
  SettingsPageHeader,
} from './_components/settings-card';
import {
  SettingsIsDirty,
  SettingsSubmitButton,
} from './_components/settings-submit-button';
import {
  SettingsField,
  toName,
  SECRET_CLEAR_SENTINEL,
} from './_components/settings-field';
import { SettingsActionsMenu } from './_components/settings-actions-menu';
import { useScrollToField } from '@/components/shared/command-palette/use-scroll-to-field';

interface TabModel {
  section: string;
  label: string;
  group: string;
  order: number;
  icon: ReturnType<typeof tabFor>['icon'];
  /** subsection path (joined by '.') → keys; '' = section root */
  groups: Map<string, SettingsKey[]>;
}

function buildTabs(keys: SettingsKey[]): TabModel[] {
  const bySection = new Map<string, SettingsKey[]>();
  for (const k of keys) {
    const section = k.key.split('.')[0];
    (bySection.get(section) ?? bySection.set(section, []).get(section)!).push(
      k
    );
  }
  const tabs: TabModel[] = [];
  for (const [section, sectionKeys] of bySection) {
    const meta = tabFor(section);
    const groups = new Map<string, SettingsKey[]>();
    for (const k of sectionKeys) {
      const parts = k.key.split('.');
      // parts[0] = section, last = leaf; middle = subsection path
      const sub = parts.slice(1, -1).join('.');
      (groups.get(sub) ?? groups.set(sub, []).get(sub)!).push(k);
    }
    tabs.push({ section, ...meta, groups });
  }
  return tabs.sort(
    (a, b) => a.order - b.order || a.label.localeCompare(b.label)
  );
}

function TabForm({
  tab,
  allKeys: allSettingsKeys,
}: {
  tab: TabModel;
  allKeys: SettingsKey[];
}) {
  const { mutateAsync, isPending } = useSaveSettings();
  // Hold the RHF methods captured from the Form's children render-prop so
  // `onSubmit` can call `reset(values)` after a successful save — otherwise
  // `formState.isDirty` stays true even though the persisted state matches,
  // leaving the "unsaved changes" alert stuck until the user re-enters the
  // tab.
  const methodsRef = React.useRef<UseFormReturn<any> | null>(null);

  const allKeys = React.useMemo(() => [...tab.groups.values()].flat(), [tab]);

  const { schema, defaults, byName } = React.useMemo(() => {
    const shape: Record<string, z.ZodTypeAny> = {};
    const defaults: Record<string, unknown> = {};
    const byName = new Map<string, SettingsKey>();
    for (const k of allKeys) {
      const n = toName(k.key);
      shape[n] = z.any();
      // Secrets start blank so an untouched field PATCHes nothing.
      if (k.secret) {
        defaults[n] = '';
      } else if (k.value === null && k.ui.kind === 'enum') {
        defaults[n] = '';
      } else {
        defaults[n] = k.value;
      }
      byName.set(n, k);
    }
    return { schema: z.object(shape), defaults, byName };
  }, [allKeys]);

  return (
    <Form
      schema={schema}
      defaultValues={defaults}
      stackClass="space-y-4 relative"
      onSubmit={async (data: Record<string, unknown>) => {
        const patch: Record<string, unknown> = {};
        for (const [n, val] of Object.entries(data)) {
          const k = byName.get(n);
          if (!k || k.source === 'environment') continue;
          if (k.secret) {
            if (val === SECRET_CLEAR_SENTINEL) {
              patch[k.key] = null;
            } else if (val !== '' && val != null) {
              patch[k.key] = val;
            }
            continue;
          }
          const isNullable = k.value === null || k.default === null;
          const normalised = isNullable && val === '' ? null : val;
          if (JSON.stringify(normalised) !== JSON.stringify(k.value))
            patch[k.key] = normalised;
        }
        if (Object.keys(patch).length === 0) {
          toast.info('No changes to save.');
          // Spurious dirtiness can come from env-locked / non-savable fields
          // (e.g. an env-set duration). Clear it so the "unsaved changes"
          // alert and pulsing Save don't get stuck with no way to dismiss.
          methodsRef.current?.reset(data, {
            keepValues: true,
            keepIsValid: true,
          });
          return;
        }
        try {
          const res = await mutateAsync(patch);
          toast.success(
            `Saved ${res.updated.length} setting${res.updated.length === 1 ? '' : 's'}.`
          );
          // Treat the just-submitted values as the new baseline so RHF
          // immediately reports `isDirty=false` and the "unsaved changes"
          // alert disappears. We pass `data` (current form values) rather
          // than `defaults` because secret fields default to '' and we want
          // them to stay clean even after the user typed a replacement.
          methodsRef.current?.reset(data, {
            keepValues: true,
            keepIsValid: true,
          });
          if (res.requiresRestart)
            toast.warning('Some changes require a restart to take effect.', {
              duration: 8000,
            });
        } catch (e: any) {
          const issues = e?.issues as Record<string, string> | undefined;
          if (issues)
            for (const [key, msg] of Object.entries(issues))
              toast.error(`${key}: ${msg}`);
          else toast.error(e?.message ?? 'Failed to save settings');
        }
      }}
    >
      {(methods) => {
        // Capture RHF instance so the submit handler can `reset` after save.
        methodsRef.current = methods;
        // Render subsections in schema (walk) order — `tab.groups` is a Map
        // built in that order, so we only need to float the section root
        // (`''`) to the top. This lets the core schema control card order
        // (e.g. Proxy → Encryption first) without per-section UI config.
        const subKeys = [...tab.groups.keys()];
        const subs = subKeys.includes('')
          ? ['', ...subKeys.filter((s) => s !== '')]
          : subKeys;
        return (
          <>
            <div className="flex items-start justify-between gap-2">
              <SettingsPageHeader
                title={tab.label}
                description={`${humanise(tab.section)} configuration`}
                icon={tab.icon}
              />
              <div className="pt-1">
                <SettingsActionsMenu
                  allKeys={allSettingsKeys}
                  sectionKeys={allKeys}
                  sectionLabel={tab.label}
                />
              </div>
            </div>
            {subs.map((sub) => (
              <SettingsCard
                key={sub || '_root'}
                title={
                  sub ? sub.split('.').map(humanise).join(' › ') : undefined
                }
              >
                {tab.groups.get(sub)!.map((k) => (
                  <div key={k.key} id={`setting-${k.key}`}>
                    <SettingsField k={k} />
                  </div>
                ))}
              </SettingsCard>
            ))}
            <div className="flex justify-end pt-2">
              <SettingsSubmitButton isPending={isPending} />
            </div>
            <SettingsIsDirty isPending={isPending} />
          </>
        );
      }}
    </Form>
  );
}

export function SettingsPage() {
  const { data, isLoading, error, refetch } = useSettings();
  const tabs = React.useMemo(() => (data ? buildTabs(data.keys) : []), [data]);
  const search = useSearch({ from: '/dashboard/settings' });
  const navigate = useNavigate({ from: '/dashboard/settings' });

  const [tab, setTab] = React.useState<string>('');
  React.useEffect(() => {
    if (!tabs.length) return;
    if (search.tab && tabs.some((t) => t.section === search.tab))
      setTab(search.tab);
    else if (!tab) setTab(tabs[0].section);
  }, [tabs, search.tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const clearField = React.useCallback(() => {
    navigate({
      to: '.',
      search: (prev) => ({ ...prev, field: undefined }),
      replace: true,
      resetScroll: false,
    });
  }, [navigate]);

  // A field only exists in the DOM once its tab is the active one.
  useScrollToField(search.field, Boolean(tab) && tabs.length > 0, clearField);

  const onTabChange = (v: string) => {
    setTab(v);
    navigate({
      to: '.',
      search: (prev) => ({ ...prev, tab: v }),
      replace: true,
      resetScroll: false,
    });
  };

  if (isLoading)
    return (
      <PageWrapper className="p-8 flex items-center justify-center">
        <Spinner className="w-8 h-8" />
      </PageWrapper>
    );
  if (error || !data)
    return (
      <PageWrapper className="p-8">
        <LuffyError title="Failed to load settings" reset={() => refetch()}>
          <p className="text-sm text-[--muted]">{String(error)}</p>
        </LuffyError>
      </PageWrapper>
    );

  // group tabs by `group` for the nav rail
  const groups = new Map<string, TabModel[]>();
  for (const t of tabs)
    (groups.get(t.group) ?? groups.set(t.group, []).get(t.group)!).push(t);

  return (
    <PageWrapper className="p-4 sm:p-8 space-y-4 relative">
      <Tabs
        value={tab}
        onValueChange={onTabChange}
        className={cn(
          'w-full grid grid-cols-1 lg:grid lg:grid-cols-[280px,1fr] gap-4'
        )}
        triggerClass={cn(
          'text-base px-6 rounded-[--radius-md] w-fit lg:w-full rounded-lg border-0',
          'data-[state=active]:bg-[--subtle] data-[state=active]:text-white',
          'dark:hover:text-white',
          'h-9 lg:justify-start px-3 transition-all duration-200 hover:bg-[--subtle]/50 hover:transform'
        )}
        listClass={cn(
          'w-full flex flex-wrap lg:flex-nowrap h-fit',
          'lg:block p-2 lg:p-0'
        )}
      >
        <TabsList className="flex-wrap max-w-full lg:space-y-2 lg:sticky lg:top-4">
          <SettingsNavCard>
            <div className="overflow-x-none overflow-y-hidden rounded-[--radius-md] space-y-1 lg:space-y-3 flex justify-center flex-wrap lg:block">
              {[...groups.entries()].map(([groupName, groupTabs]) => (
                <Card
                  key={groupName}
                  className="lg:p-2 contents lg:block border-0 bg-transparent lg:border lg:bg-gray-950/5 dark:lg:bg-gray-950/40"
                >
                  <p className="hidden lg:block px-3 py-1 text-[10px] uppercase tracking-wider text-[--muted] font-semibold">
                    {groupName}
                  </p>
                  {groupTabs.map((t) => (
                    <TabsTrigger
                      key={t.section}
                      value={t.section}
                      className="group"
                    >
                      <t.icon className="text-xl mr-3 transition-transform duration-200 group-hover:translate-x-0.5" />
                      {t.label}
                    </TabsTrigger>
                  ))}
                </Card>
              ))}
            </div>
          </SettingsNavCard>
        </TabsList>

        <div>
          {tabs.map((t) => (
            <TabsContent
              key={t.section}
              value={t.section}
              className="space-y-4 animate-in fade-in-0 slide-in-from-bottom-2 duration-300"
            >
              {tab === t.section && <TabForm tab={t} allKeys={data.keys} />}
            </TabsContent>
          ))}
        </div>
      </Tabs>
    </PageWrapper>
  );
}
