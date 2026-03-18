import React, {
  useMemo,
  useState,
  useRef,
  useEffect,
  useCallback,
} from 'react';
import { DiffItem, formatValue } from '../../utils/diff/diff';
import { calculateLineDiff, LineDiff } from '../../utils/diff/text';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs/tabs';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

export interface DiffAnnotation {
  /** Badge label shown next to the diff type badge. */
  label: string;
  /** Tailwind colour classes for the badge, e.g. 'bg-blue-500/10 text-blue-400 border-blue-500/20' */
  className?: string;
  /** Optional tooltip / description shown as a small line below the path. */
  description?: string;
  /** Severity controls sort order and summary emphasis. */
  severity?: 'critical' | 'warning' | 'info';
}

/** Pulls the first `text-{color}-{shade}` token out of a badge className string. */
function extractTextClass(className?: string): string {
  const match = className?.match(/\btext-\S+-\d+\b/);
  return match ? match[0] : 'text-gray-400';
}

interface DiffViewerProps {
  diffs: DiffItem[];
  valueFormatter?: (value: any) => string;
  oldValue?: any;
  newValue?: any;
  /** Map from dotted path string (same format as `diff.path.join('.')`) to an annotation. */
  annotations?: Map<string, DiffAnnotation>;
  /**
   * Optional formatter for the path label shown in the visual tab.
   * Receives the raw path segment array; return a human-readable string.
   * Defaults to `path.join('.').replace(/\.\[/g, '[')` when omitted.
   */
  pathFormatter?: (path: string[]) => string;
}

export function DiffViewer({
  diffs,
  valueFormatter,
  oldValue,
  newValue,
  annotations,
  pathFormatter,
}: DiffViewerProps) {
  const format = (val: any) => {
    if (valueFormatter) {
      const formatted = valueFormatter(val);
      if (formatted !== undefined && formatted !== null) {
        return formatted;
      }
    }
    if (val === undefined) return '(undefined)';
    if (val === null) return '(null)';
    return formatValue(val);
  };

  const textDiffs = useMemo(() => {
    if (!oldValue && !newValue) return [];
    try {
      const oldJson = oldValue ? JSON.stringify(oldValue, null, 2) : '';
      const newJson = newValue ? JSON.stringify(newValue, null, 2) : '';
      return calculateLineDiff(oldJson, newJson);
    } catch (e) {
      console.error('Failed to stringify JSON for diff:', e);
      return calculateLineDiff('', '');
    }
  }, [oldValue, newValue]);

  const sortedDiffs = useMemo(() => {
    if (!annotations || annotations.size === 0) return diffs;
    const severityOrder: Record<string, number> = {
      critical: 0,
      warning: 1,
      info: 2,
    };
    return [...diffs].sort((a, b) => {
      const keyA = a.path.join('.').replace(/\.\[/g, '[');
      const keyB = b.path.join('.').replace(/\.\[/g, '[');
      const annA = annotations.get(keyA);
      const annB = annotations.get(keyB);
      if (annA && !annB) return -1;
      if (!annA && annB) return 1;
      if (annA && annB) {
        const sA = severityOrder[annA.severity ?? 'info'] ?? 3;
        const sB = severityOrder[annB.severity ?? 'info'] ?? 3;
        return sA - sB;
      }
      return 0;
    });
  }, [diffs, annotations]);

  if (diffs.length === 0) {
    return (
      <div className="text-center p-4 text-[--muted]">No changes detected.</div>
    );
  }

  return (
    <div className="w-full mt-4">
      <Tabs defaultValue="visual" className="w-full">
        <TabsList className="mb-4 grid w-full grid-cols-2">
          <TabsTrigger value="visual">Visual</TabsTrigger>
          <TabsTrigger value="json">Raw JSON</TabsTrigger>
        </TabsList>

        <TabsContent
          value="visual"
          className="max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar"
        >
          <div className="space-y-3">
            {sortedDiffs.map((diff, idx) => {
              const pathKey = diff.path.join('.').replace(/\.\[/g, '[');
              const pathLabel = pathFormatter
                ? pathFormatter(diff.path)
                : pathKey;
              const annotation = annotations?.get(pathKey);
              return (
                <div
                  key={`${diff.path.join('.')}-${diff.type}-${idx}`}
                  className="p-3 bg-gray-800/50 rounded-lg border border-gray-700 relative group"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge type={diff.type} />
                      {annotation && (
                        <span
                          className={`px-2 py-0.5 text-[10px] font-semibold rounded border ${annotation.className ?? 'bg-blue-500/10 text-blue-400 border-blue-500/20'}`}
                        >
                          {annotation.label}
                        </span>
                      )}
                      <span className="font-mono text-sm text-gray-300">
                        {pathLabel}
                      </span>
                    </div>
                  </div>
                  {annotation?.description && (
                    <div
                      className={`mb-2 text-xs pl-2 border-l-2 border-current/50 italic ${extractTextClass(annotation.className)}`}
                    >
                      {annotation.description}
                    </div>
                  )}
                  <div
                    className={`grid gap-4 text-sm ${
                      diff.type === 'CHANGE' ? 'grid-cols-2' : 'grid-cols-1'
                    }`}
                  >
                    {diff.type !== 'ADD' && (
                      <div className="space-y-1">
                        <div className="text-xs text-[--muted] uppercase">
                          Old
                        </div>
                        <div className="p-2 bg-red-900/20 text-red-200 rounded break-all border border-red-900/30 font-mono text-xs whitespace-pre-wrap">
                          {format(diff.oldValue)}
                        </div>
                      </div>
                    )}
                    {diff.type !== 'REMOVE' && (
                      <div className="space-y-1">
                        <div className="text-xs text-[--muted] uppercase">
                          New
                        </div>
                        <div className="p-2 bg-green-900/20 text-green-200 rounded break-all border border-green-900/30 font-mono text-xs whitespace-pre-wrap">
                          {format(diff.newValue)}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent
          value="json"
          className="relative max-h-[60vh] overflow-hidden rounded-md border border-gray-800 bg-gray-950/50 flex flex-col group"
        >
          <JsonDiffContent textDiffs={textDiffs} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function JsonDiffContent({ textDiffs }: { textDiffs: LineDiff[] }) {
  const [currentChangeIndex, setCurrentChangeIndex] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);

  const changeIndices = useMemo(() => {
    const indices: number[] = [];
    let inChangeBlock = false;

    textDiffs.forEach((line, idx) => {
      if (line.type !== 'same') {
        if (!inChangeBlock) {
          indices.push(idx);
          inChangeBlock = true;
        }
      } else {
        inChangeBlock = false;
      }
    });

    return indices;
  }, [textDiffs]);

  const scrollToChange = useCallback(
    (index: number) => {
      const lineIndex = changeIndices[index];
      if (
        lineIndex !== undefined &&
        lineRefs.current[lineIndex] &&
        scrollContainerRef.current
      ) {
        const element = lineRefs.current[lineIndex];
        element.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      }
      setCurrentChangeIndex(index);
    },
    [changeIndices]
  );

  const handleNext = () => {
    const nextIndex = (currentChangeIndex + 1) % changeIndices.length;
    scrollToChange(nextIndex);
  };

  const handlePrev = () => {
    const prevIndex =
      (currentChangeIndex - 1 + changeIndices.length) % changeIndices.length;
    scrollToChange(prevIndex);
  };

  // Reset index when diffs change
  useEffect(() => {
    setCurrentChangeIndex(0);
    // Reset refs array sizing
    lineRefs.current = lineRefs.current.slice(0, textDiffs.length);

    // Auto-scroll to first change if exists
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (changeIndices.length > 0) {
      // Small timeout to ensure rendering is complete before scrolling
      timeoutId = setTimeout(() => scrollToChange(0), 100);
    }

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [textDiffs, changeIndices, scrollToChange]);

  // Check for truncation and show toast
  useEffect(() => {
    if (textDiffs.some((diff) => diff.truncated)) {
      toast.warning('Large File Detected: Diff simplified for performance.', {
        id: 'large-file-warning',
      });
    }
  }, [textDiffs]);

  return (
    <>
      {changeIndices.length > 0 && (
        <div className="absolute top-4 right-4 z-10 flex items-center gap-2 bg-gray-900/90 border border-gray-700 rounded-md p-1.5 shadow-lg backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          <span className="text-xs text-gray-400 font-mono px-2 select-none">
            {currentChangeIndex + 1} / {changeIndices.length}
          </span>
          <div className="h-4 w-px bg-gray-700 mx-1" />
          <Button
            className="h-7 w-7 p-0 hover:bg-gray-800 bg-transparent"
            onClick={handlePrev}
            title="Previous Change"
            aria-label="Previous Change"
          >
            <ChevronUp className="h-4 w-4" />
          </Button>
          <Button
            className="h-7 w-7 p-0 hover:bg-gray-800 bg-transparent"
            onClick={handleNext}
            title="Next Change"
            aria-label="Next Change"
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
        </div>
      )}

      <div
        ref={scrollContainerRef}
        className="overflow-y-auto custom-scrollbar p-4 flex-1 font-mono text-xs"
      >
        <div className="flex flex-col">
          {textDiffs.map((line, idx) => (
            <div
              key={idx}
              ref={(el) => {
                lineRefs.current[idx] = el;
              }}
              className={`flex ${
                line.type === 'add'
                  ? 'bg-green-900/20 text-green-300'
                  : line.type === 'remove'
                    ? 'bg-red-900/20 text-red-300'
                    : 'text-gray-400'
              } ${idx === changeIndices[currentChangeIndex] ? 'ring-1 ring-blue-500/50' : ''}`}
            >
              <div className="w-8 shrink-0 text-right pr-3 select-none text-gray-600 border-r border-gray-800 mr-2">
                {line.oldLineNumber || ' '}
              </div>
              <div className="w-8 shrink-0 text-right pr-3 select-none text-gray-600 border-r border-gray-800 mr-2">
                {line.newLineNumber || ' '}
              </div>
              <pre className="whitespace-pre-wrap break-all flex-1">
                {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}{' '}
                {line.content}
              </pre>
            </div>
          ))}
          {textDiffs.length === 0 && (
            <div className="text-center p-4 text-[--muted]">
              No raw JSON available for comparison.
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function Badge({ type }: { type: string }) {
  const colors = {
    CHANGE: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
    ADD: 'bg-green-500/10 text-green-500 border-green-500/20',
    REMOVE: 'bg-red-500/10 text-red-500 border-red-500/20',
  };
  const colorClass =
    colors[type as keyof typeof colors] ||
    'bg-gray-500/10 text-gray-500 border-gray-500/20';
  return (
    <span
      className={`px-2 py-0.5 text-[10px] font-bold rounded border ${colorClass}`}
    >
      {type}
    </span>
  );
}
