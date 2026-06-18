import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  BiSearch,
  BiDownload,
  BiDownArrowAlt,
  BiDotsVerticalRounded,
  BiCopy,
} from 'react-icons/bi';
import { toast } from 'sonner';
import { TextInput } from '@/components/ui/text-input';
import { Switch } from '@/components/ui/switch';
import { Button, IconButton } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Popover } from '@/components/ui/popover';
import { Card } from '@/components/ui/card';
import { cn } from '@/components/ui/core/styling';
import {
  useLogStream,
  exportUrl,
  type LogFilters,
  type LogRow,
} from './use-log-stream';
import { useDebounce } from '@/hooks/debounce';
import { PageWrapper } from '@/components/shared/page-wrapper';
import { Spinner } from '@/components/ui/loading-spinner';
import { LuffyError } from '@/components/shared/luffy-error';
import { copyToClipboard } from '@/utils/clipboard';
import { formatDateTime } from '@/lib/format';

const LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;

const LEVEL_STYLES: Record<string, string> = {
  trace: 'text-[--muted]',
  debug: 'text-sky-500',
  info: 'text-emerald-500',
  warn: 'text-amber-500',
  error: 'text-red-500',
  fatal: 'text-red-600 font-bold',
};

const LEVEL_DOT: Record<string, string> = {
  trace: 'bg-gray-400',
  debug: 'bg-sky-500',
  info: 'bg-emerald-500',
  warn: 'bg-amber-500',
  error: 'bg-red-500',
  fatal: 'bg-red-600',
};

const ALL_MODULES = '__all__';
const PREFS_KEY = 'aiostreams.logs.prefs';

interface Prefs {
  autoscroll: boolean;
  wrap: boolean;
  levels: string[];
}

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { ...defaultPrefs, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return defaultPrefs;
}

const defaultPrefs: Prefs = {
  autoscroll: true,
  wrap: false,
  levels: [],
};

function LogLine({
  row,
  wrap,
  expanded,
  onToggle,
}: {
  row: LogRow;
  wrap: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const time = formatDateTime(row.time);
  const hasFields = Object.keys(row.obj).length > 0;
  const [hovered, setHovered] = useState(false);

  const copyText = expanded
    ? JSON.stringify(JSON.parse(row.raw))
    : [
        time,
        row.level,
        row.module ? `[${row.module}]` : '',
        row.msg,
        hasFields
          ? Object.entries(row.obj)
              .map(
                ([k, v]) =>
                  `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`
              )
              .join(' ')
          : '',
      ]
        .filter(Boolean)
        .join(' ');

  return (
    <div
      className={cn(
        'relative px-3 py-1.5 border-b border-[--border] cursor-pointer hover:bg-[--subtle] font-mono text-xs leading-relaxed group',
        wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'
      )}
      onClick={onToggle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span className="inline-block px-2 py-0.5 rounded-full bg-brand/15 text-brand font-medium tabular-nums">
        {time}
      </span>{' '}
      <span
        className={cn(
          'inline-block w-2 h-2 rounded-full align-middle',
          LEVEL_DOT[row.level] ?? 'bg-[--muted]'
        )}
        title={row.level}
      />{' '}
      {row.module && (
        <span className="text-[--muted-highlight]">[{row.module}]</span>
      )}{' '}
      <span className="text-[--foreground]">{row.msg}</span>
      {hasFields && !expanded && (
        <span className="text-[--muted]">
          {' '}
          {Object.entries(row.obj)
            .map(([k, v]) => `${k}=${typeof v === 'object' ? '{…}' : v}`)
            .join(' ')}
        </span>
      )}
      {expanded && (
        <pre className="mt-1 p-2 rounded bg-[--subtle] text-[--foreground] whitespace-pre-wrap break-all">
          {JSON.stringify(JSON.parse(row.raw), null, 2)}
        </pre>
      )}
      {hovered && (
        <button
          type="button"
          aria-label="Copy log line"
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-[--muted] hover:text-[--foreground] hover:bg-[--paper] transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            copyToClipboard(copyText, {
              onSuccess: () => toast.success('Copied log line'),
              onError(error) {
                toast.error('Failed to copy: ' + error);
                console.error('Failed to copy log line:', error);
              },
            });
          }}
        >
          <BiCopy className="text-sm" />
        </button>
      )}
    </div>
  );
}

export function LogsPage() {
  const initialPrefs = useMemo(loadPrefs, []);
  const [autoscroll, setAutoscroll] = useState(initialPrefs.autoscroll);
  const [wrap, setWrap] = useState(initialPrefs.wrap);
  const [levels, setLevels] = useState<string[]>(initialPrefs.levels);
  const [module, setModule] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [regex, setRegex] = useState(false);
  const debouncedSearch = useDebounce(search, 250);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const regexError = useMemo(() => {
    if (!regex || !search) return null;
    try {
      new RegExp(search);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'Invalid regex';
    }
  }, [regex, search]);

  useEffect(() => {
    const prefs: Prefs = { autoscroll, wrap, levels };
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  }, [autoscroll, wrap, levels]);

  const filters: LogFilters = useMemo(
    () => ({ q: debouncedSearch, regex: regex && !regexError, levels, module }),
    [debouncedSearch, regex, regexError, levels, module]
  );

  const { rows, loading, connected, error, retry } = useLogStream(filters);

  // Defer rendering the heavy virtualizer until the page-entry animation settles (~400ms spring)
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 400);
    return () => clearTimeout(t);
  }, []);

  const moduleOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => r.module && set.add(r.module));
    return [
      { value: ALL_MODULES, label: 'All modules' },
      ...[...set].sort().map((m) => ({ value: m, label: m })),
    ];
  }, [rows]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const [pinned, setPinned] = useState(true);
  const lastScrollTopRef = useRef(0);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 30,
    overscan: 20,
  });

  // Rows are virtualized and measured asynchronously, so a single
  // scrollToIndex lands short while sizes are still settling. Re-apply over
  // the next couple of frames so we reliably reach the true bottom even when
  // logs stream in quickly.
  const stickToBottom = useCallback(() => {
    const jump = () => {
      const el = scrollRef.current;
      if (!el || !rows.length) return;
      virtualizer.scrollToIndex(rows.length - 1, { align: 'end' });
      el.scrollTop = el.scrollHeight;
      lastScrollTopRef.current = el.scrollTop;
    };
    jump();
    requestAnimationFrame(() => {
      jump();
      requestAnimationFrame(jump);
    });
  }, [rows.length, virtualizer]);

  useEffect(() => {
    if (ready && !loading && !error && autoscroll && pinnedRef.current)
      stickToBottom();
  }, [rows.length, ready, loading, error, autoscroll, stickToBottom]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const top = el.scrollTop;
    const distance = el.scrollHeight - top - el.clientHeight;
    const atBottom = distance < 80;
    // Only the user ever scrolls up; programmatic sticking only scrolls down.
    // Re-pin as soon as they return to the bottom, and unpin only on a
    // deliberate upward scroll so a fast log flood never fights them.
    const scrolledUp = top < lastScrollTopRef.current - 2;
    lastScrollTopRef.current = top;
    if (atBottom) {
      if (!pinnedRef.current) {
        pinnedRef.current = true;
        setPinned(true);
      }
    } else if (scrolledUp && pinnedRef.current) {
      pinnedRef.current = false;
      setPinned(false);
    }
  }, []);

  const toggleLevel = (lvl: string) =>
    setLevels((prev) =>
      prev.includes(lvl) ? prev.filter((l) => l !== lvl) : [...prev, lvl]
    );

  const toggleExpanded = (seq: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(seq) ? next.delete(seq) : next.add(seq);
      return next;
    });

  const renderOptions = () => (
    <>
      <Switch
        label="Auto-scroll"
        labelClass="whitespace-nowrap"
        side="right"
        value={autoscroll}
        onValueChange={(v) => {
          setAutoscroll(v);
          if (v) {
            pinnedRef.current = true;
            setPinned(true);
            stickToBottom();
          }
        }}
      />
      <Switch label="Wrap" side="right" value={wrap} onValueChange={setWrap} />
    </>
  );

  const items = virtualizer.getVirtualItems();

  return (
    <PageWrapper className="space-y-4 p-4 sm:p-8">
      <div className="flex flex-col h-[calc(100vh-6rem)]">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2>Logs</h2>
            <p className="text-[--muted]">
              Live tail of recent logs.{' '}
              <span
                className={cn(
                  'inline-block w-2 h-2 rounded-full align-middle',
                  connected ? 'bg-emerald-500' : 'bg-[--muted]'
                )}
              />{' '}
              <span className="text-xs">
                {connected ? 'streaming' : 'disconnected'} · {rows.length} shown
              </span>
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              intent="gray-outline"
              leftIcon={<BiDownload />}
              onClick={() => window.open(exportUrl(filters, 'log'), '_blank')}
            >
              .log
            </Button>
            <Button
              size="sm"
              intent="gray-outline"
              leftIcon={<BiDownload />}
              onClick={() => window.open(exportUrl(filters, 'json'), '_blank')}
            >
              .json
            </Button>
          </div>
        </div>

        <Card className="p-3 mb-3 flex flex-col gap-3">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="flex-1 min-w-[240px] flex flex-col gap-1">
              <div className="flex items-center gap-1">
                <TextInput
                  leftIcon={<BiSearch />}
                  placeholder={
                    regex ? 'Regex pattern…' : 'Search all retained logs…'
                  }
                  value={search}
                  onValueChange={setSearch}
                  className={cn(
                    'flex-1',
                    regexError && 'border-red-500 focus-within:border-red-500'
                  )}
                />
                <button
                  type="button"
                  title="Toggle regex search"
                  onClick={() => setRegex((r) => !r)}
                  className={cn(
                    'shrink-0 h-9 px-2 rounded-md border text-xs font-mono transition-colors',
                    regex && !regexError
                      ? 'border-brand bg-brand/10 text-brand'
                      : regex && regexError
                        ? 'border-red-500 bg-red-500/10 text-red-500'
                        : 'border-[--border] text-[--muted] hover:text-[--foreground] hover:border-[--foreground]'
                  )}
                >
                  .*
                </button>
              </div>
              {regexError && (
                <p className="text-xs text-red-500 pl-1">{regexError}</p>
              )}
            </div>
            <div className="flex flex-1 md:flex-none items-center gap-2">
              <div className="flex-1 md:min-w-[180px]">
                <Select
                  options={moduleOptions}
                  value={module ?? ALL_MODULES}
                  onValueChange={(v) =>
                    setModule(v === ALL_MODULES ? undefined : v)
                  }
                />
              </div>
              <div className="lg:hidden shrink-0">
                <Popover
                  trigger={
                    <IconButton
                      size="sm"
                      intent="gray-outline"
                      icon={<BiDotsVerticalRounded />}
                      aria-label="Log view options"
                    />
                  }
                >
                  <div className="flex flex-col gap-4 p-1 min-w-[180px]">
                    {renderOptions()}
                  </div>
                </Popover>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            {LEVELS.map((lvl) => (
              <button
                key={lvl}
                onClick={() => toggleLevel(lvl)}
                className={cn(
                  'px-2 py-0.5 rounded text-xs uppercase font-semibold border transition-colors',
                  levels.includes(lvl)
                    ? 'border-brand bg-brand/10'
                    : 'border-[--border] text-[--muted] hover:text-[--foreground]',
                  levels.includes(lvl) && LEVEL_STYLES[lvl]
                )}
              >
                {lvl}
              </button>
            ))}
            <div className="flex-1" />
            <div className="hidden lg:flex items-center gap-5">
              {renderOptions()}
            </div>
          </div>
        </Card>

        <Card className="flex-1 relative overflow-hidden p-0">
          {(!ready || loading) && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10">
              <Spinner className="w-8 h-8" />
              <p className="text-[--muted] text-sm">Loading logs…</p>
            </div>
          )}
          {error && ready && !loading && (
            <div className="absolute inset-0 flex items-center justify-center z-10">
              <LuffyError title="Failed to load logs" reset={retry}>
                <p className="text-sm text-[--muted]">{error}</p>
              </LuffyError>
            </div>
          )}
          {ready && !loading && !error && rows.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-[--muted] text-sm">
              No logs match the current filters.
            </div>
          )}
          <div
            ref={scrollRef}
            onScroll={onScroll}
            className="h-full overflow-auto"
          >
            {ready && !loading && !error && (
              <div
                style={{
                  height: virtualizer.getTotalSize(),
                  position: 'relative',
                }}
              >
                {items.map((vi) => {
                  const row = rows[vi.index];
                  return (
                    <div
                      key={row.seq}
                      data-index={vi.index}
                      ref={virtualizer.measureElement}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${vi.start}px)`,
                      }}
                    >
                      <LogLine
                        row={row}
                        wrap={wrap}
                        expanded={expanded.has(row.seq)}
                        onToggle={() => toggleExpanded(row.seq)}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          {autoscroll && !pinned && (
            <Button
              size="sm"
              intent="primary"
              className="absolute bottom-4 right-4 shadow-lg"
              leftIcon={<BiDownArrowAlt />}
              onClick={() => {
                pinnedRef.current = true;
                setPinned(true);
                stickToBottom();
              }}
            >
              Jump to latest
            </Button>
          )}
        </Card>
      </div>
    </PageWrapper>
  );
}
