import React from 'react';
import { BiSearch } from 'react-icons/bi';
import { TextInput } from '@/components/ui/text-input';
import { useDebounce } from '@/hooks/debounce';
import { useSession } from '../lib/session';
import { useSearch } from '../lib/queries';
import { navigate, to } from '../lib/paths';
import { PageBody } from '../components/layout';
import { MixedGrid } from '../components/mixed-grid';

export function SearchPage({ initialTerm }: { initialTerm: string }) {
  const { client } = useSession();
  const [term, setTerm] = React.useState(initialTerm);
  const debounced = useDebounce(term.trim(), 400);
  const results = useSearch(debounced);

  // Keeps the term in the address, so back returns to the same results.
  React.useEffect(() => {
    if (debounced !== initialTerm) {
      navigate(to.search(debounced), { replace: true });
    }
  }, [debounced, initialTerm]);

  const items = results.data?.Items ?? [];

  return (
    <PageBody>
      <h1 className="text-3xl font-bold">Search</h1>
      <TextInput
        autoFocus
        value={term}
        onValueChange={setTerm}
        placeholder="Movies and shows"
        leftIcon={<BiSearch className="text-xl" />}
        className="max-w-xl"
      />
      {debounced.length >= 2 && (
        <MixedGrid items={items} client={client} loading={results.isLoading} />
      )}
      {debounced.length >= 2 && !results.isLoading && !items.length && (
        <p className="text-[--muted]">Nothing found for “{debounced}”.</p>
      )}
    </PageBody>
  );
}
