import { formatCompact, formatPercent } from '@aiostreams/ui/core/format';
import type { UsenetIndexerSearchRollup } from '../queries';

/** Per-indexer usenet search results across all users. */
export function IndexerSearchTable({
  rows,
}: {
  rows: UsenetIndexerSearchRollup[];
}) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-[--muted]">
        No usenet searches recorded in this window yet.
      </p>
    );
  }
  return (
    <>
      <p className="text-xs text-[--muted] mb-3 max-w-prose">
        Usenet results per indexer across all users, after each user's filters
        (including title and episode matching). Searches count requests where
        the indexer returned results. Unique is the share of its results no
        other indexer returned in the same request, matched by filename.
      </p>
      <div className="overflow-x-auto -mx-4 px-4 lg:mx-0 lg:px-0">
        <table className="w-full text-sm min-w-[480px]">
          <thead className="text-[--muted] text-xs uppercase">
            <tr className="text-left border-b border-[--border]">
              <th className="py-2 pr-3">Indexer</th>
              <th className="py-2 px-3 text-right">Searches</th>
              <th className="py-2 px-3 text-right">Avg results</th>
              <th className="py-2 pl-3 text-right">Unique</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.indexer} className="border-b border-[--border]/50">
                <td className="py-2 pr-3 font-medium">{r.indexer}</td>
                <td className="py-2 px-3 text-right tabular-nums">
                  {formatCompact(r.searches)}
                </td>
                <td className="py-2 px-3 text-right tabular-nums">
                  {(r.results / r.searches).toFixed(1)}
                </td>
                <td
                  className="py-2 pl-3 text-right tabular-nums"
                  title={`${r.unique} of ${r.results} results`}
                >
                  {formatPercent(r.unique / r.results)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
