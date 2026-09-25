import React from 'react';
import { BiHistory, BiSearch, BiX } from 'react-icons/bi';
import { Button, IconButton } from '@aiostreams/ui/button';
import { TextInput } from '@aiostreams/ui/text-input';
import { useDebounce } from '@aiostreams/ui/hooks/debounce';
import { useSession } from '../lib/session';
import { useSearch } from '../lib/queries';
import { useSearchHistory } from '../lib/search-history';
import { navigate, to } from '../lib/paths';
import { PageBody } from '../components/layout';
import { MixedGrid } from '../components/mixed-grid';

export function SearchPage({ initialTerm }: { initialTerm: string }) {
  const { client, user } = useSession();
  const [term, setTerm] = React.useState(initialTerm);
  const debounced = useDebounce(term.trim(), 400);
  const results = useSearch(debounced);
  const history = useSearchHistory(user.Id!);

  // Keeps the term in the address, so back returns to the same results.
  React.useEffect(() => {
    if (debounced !== initialTerm) {
      navigate(to.search(debounced), { replace: true });
    }
  }, [debounced, initialTerm]);

  const items = results.data?.Items ?? [];
  const searching = debounced.length >= 2;

  return (
    <PageBody>
      <h1 className="text-3xl font-bold">Search</h1>
      <TextInput
        autoFocus
        type="search"
        autoComplete="off"
        enterKeyHint="search"
        value={term}
        onValueChange={setTerm}
        onKeyDown={(e) => {
          if (e.key === 'Enter') history.add(term);
        }}
        placeholder="Movies and shows"
        leftIcon={<BiSearch className="text-xl" />}
        className="max-w-xl"
      />
      {!term.trim() && history.terms.length > 0 && (
        <section className="max-w-xl space-y-1">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-[--muted]">
              Recent searches
            </h2>
            <Button size="sm" intent="gray-link" onClick={history.clear}>
              Clear all
            </Button>
          </div>
          <ul className="-mx-2">
            {history.terms.map((t) => (
              <li
                key={t}
                className="flex items-center rounded-lg transition-colors hover:bg-white/[0.04]"
              >
                <button
                  type="button"
                  onClick={() => {
                    setTerm(t);
                    history.add(t);
                  }}
                  className="flex min-w-0 flex-1 items-center gap-3 px-2 py-2 text-left"
                >
                  <BiHistory className="flex-none text-lg text-[--muted]" />
                  <span className="truncate">{t}</span>
                </button>
                <IconButton
                  size="sm"
                  intent="gray-basic"
                  className="mr-1 flex-none rounded-full"
                  icon={<BiX className="text-lg" />}
                  aria-label={`Remove ${t}`}
                  onClick={() => history.remove(t)}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
      {searching && (
        <div
          onClickCapture={(e) => {
            if ((e.target as HTMLElement).closest('a')) history.add(debounced);
          }}
        >
          <MixedGrid
            items={items}
            client={client}
            loading={results.isLoading}
          />
        </div>
      )}
      {searching && !results.isLoading && !items.length && (
        <p className="text-[--muted]">Nothing found for “{debounced}”.</p>
      )}
    </PageBody>
  );
}
