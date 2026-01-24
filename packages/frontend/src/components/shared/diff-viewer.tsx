import React from 'react';
import { DiffItem, formatValue } from '@/utils/diff';

interface DiffViewerProps {
  diffs: DiffItem[];
  valueFormatter?: (value: any) => string;
}

export function DiffViewer({ diffs, valueFormatter }: DiffViewerProps) {
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

  if (diffs.length === 0) {
    return (
      <div className="text-center p-4 text-[--muted]">No changes detected.</div>
    );
  }

  return (
    <div className="w-full mt-4 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
      <div className="space-y-3">
        {diffs.map((diff, idx) => (
          <div
              key={`${diff.path.join('.')}-${diff.type}`}
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
    </div>
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
