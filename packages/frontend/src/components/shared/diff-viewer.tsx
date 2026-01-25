import React, { useMemo, useState, useRef, useEffect } from 'react';
import { DiffItem, formatValue } from '@/utils/diff';
import { calculateLineDiff, LineDiff } from '@/utils/text-diff';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs/tabs';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface DiffViewerProps {
  diffs: DiffItem[];
  valueFormatter?: (value: any) => string;
  oldValue?: any;
  newValue?: any;
}

export function DiffViewer({ diffs, valueFormatter, oldValue, newValue }: DiffViewerProps) {
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
    const oldJson = oldValue ? JSON.stringify(oldValue, null, 2) : '';
    const newJson = newValue ? JSON.stringify(newValue, null, 2) : '';
    return calculateLineDiff(oldJson, newJson);
  }, [oldValue, newValue]);

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

        <TabsContent value="visual" className="max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
          <div className="space-y-3">
            {diffs.map((diff, idx) => (
              <div
                  key={`${diff.path.join('.')}-${diff.type}-${idx}`}
                className="p-3 bg-gray-800/50 rounded-lg border border-gray-700 relative group"
              >
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                        <Badge type={diff.type} />
                        <span className="font-mono text-sm text-gray-300">
                            {diff.path.join('.').replace(/\.\[/g, '[')}
                        </span>
                    </div>
                </div>
                <div
                  className={`grid gap-4 text-sm ${
                    diff.type === 'CHANGE' ? 'grid-cols-2' : 'grid-cols-1'
                  }`}
                >
                  {diff.type !== 'ADD' && (
                    <div className="space-y-1">
                      <div className="text-xs text-[--muted] uppercase">Old</div>
                      <div className="p-2 bg-red-900/20 text-red-200 rounded break-all border border-red-900/30 font-mono text-xs whitespace-pre-wrap">
                        {format(diff.oldValue)}
                      </div>
                    </div>
                  )}
                  {diff.type !== 'REMOVE' && (
                    <div className="space-y-1">
                      <div className="text-xs text-[--muted] uppercase">New</div>
                      <div className="p-2 bg-green-900/20 text-green-200 rounded break-all border border-green-900/30 font-mono text-xs whitespace-pre-wrap">
                        {format(diff.newValue)}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="json" className="relative max-h-[60vh] overflow-hidden rounded-md border border-gray-800 bg-gray-950/50 flex flex-col group">
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
        return textDiffs
            .map((line, idx) => (line.type !== 'same' ? idx : -1))
            .filter((idx) => idx !== -1);
    }, [textDiffs]);

    const scrollToChange = (index: number) => {
        const lineIndex = changeIndices[index];
        if (lineIndex !== undefined && lineRefs.current[lineIndex] && scrollContainerRef.current) {
            const element = lineRefs.current[lineIndex];
            if (element) {
                element.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center',
                });
            }
        }
        setCurrentChangeIndex(index);
    };

    const handleNext = () => {
        const nextIndex = (currentChangeIndex + 1) % changeIndices.length;
        scrollToChange(nextIndex);
    };

    const handlePrev = () => {
        const prevIndex = (currentChangeIndex - 1 + changeIndices.length) % changeIndices.length;
        scrollToChange(prevIndex);
    };

    // Reset index when diffs change
    useEffect(() => {
        setCurrentChangeIndex(0);
        // Reset refs array sizing
        lineRefs.current = lineRefs.current.slice(0, textDiffs.length);
    }, [textDiffs]);

    return (
        <>
            {changeIndices.length > 0 && (
                <div className="absolute top-4 right-4 z-10 flex items-center gap-2 bg-gray-900/90 border border-gray-700 rounded-md p-1 shadow-lg backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                    <span className="text-[10px] text-gray-400 font-mono px-2 select-none">
                        {currentChangeIndex + 1} / {changeIndices.length}
                    </span>
                    <div className="h-4 w-px bg-gray-700 mx-1" />
                    <Button
                        className="h-6 w-6 p-0 hover:bg-gray-800 bg-transparent"
                        onClick={handlePrev}
                        title="Previous Change"
                    >
                        <ChevronUp className="h-3 w-3" />
                    </Button>
                    <Button
                        className="h-6 w-6 p-0 hover:bg-gray-800 bg-transparent"
                        onClick={handleNext}
                        title="Next Change"
                    >
                        <ChevronDown className="h-3 w-3" />
                    </Button>
                </div>
            )}
            
            <div ref={scrollContainerRef} className="overflow-y-auto custom-scrollbar p-4 flex-1">
                <div className="flex flex-col">
                    {textDiffs.map((line, idx) => (
                    <div 
                        key={idx}
                        ref={(el) => { lineRefs.current[idx] = el; }}
                        className={`flex ${
                        line.type === 'add' ? 'bg-green-900/20 text-green-300' : 
                        line.type === 'remove' ? 'bg-red-900/20 text-red-300' : 
                        'text-gray-400'
                        } ${changeIndices.includes(idx) && changeIndices.indexOf(idx) === currentChangeIndex ? 'ring-1 ring-blue-500/50' : ''}`}
                    >
                        <div className="w-8 shrink-0 text-right pr-3 select-none text-gray-600 border-r border-gray-800 mr-2">
                            {line.oldLineNumber || ' '}
                        </div>
                        <div className="w-8 shrink-0 text-right pr-3 select-none text-gray-600 border-r border-gray-800 mr-2">
                            {line.newLineNumber || ' '}
                        </div>
                        <pre className="whitespace-pre-wrap break-all flex-1">
                        {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '} {line.content}
                        </pre>
                    </div>
                    ))}
                    {textDiffs.length === 0 && (
                        <div className="text-center p-4 text-[--muted]">No raw JSON available for comparison.</div>
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
  const colorClass = colors[type as keyof typeof colors] || 'bg-gray-500/10 text-gray-500 border-gray-500/20';
  return (
    <span
      className={`px-2 py-0.5 text-[10px] font-bold rounded border ${colorClass}`}
    >
      {type}
    </span>
  );
}
