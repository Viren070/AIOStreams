import React from 'react';
import { toast } from 'sonner';
import { BiHistory, BiMicrophone, BiSearch, BiX } from 'react-icons/bi';
import { Button, IconButton } from '@aiostreams/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@aiostreams/ui/context-menu';
import { TextInput } from '@aiostreams/ui/text-input';
import { useDebounce } from '@aiostreams/ui/hooks/debounce';
import { currentHost, type Hearing } from '../lib/hosts';
import { useAction } from '../lib/input';
import { useSession } from '../lib/session';
import type { JellyfinClient } from '../lib/client';
import { useSearch } from '../lib/queries';
import { settings, useSetting } from '../lib/settings';
import { useSearchHistory } from '../lib/search-history';
import { cardShape, posterUrl } from '../lib/images';
import { itemSubtitle, progressOf } from '../lib/format';
import { href, itemPath, navigate, to } from '../lib/paths';
import type { BaseItemDto } from '../lib/types';
import { PageBody } from '../components/layout';
import { MixedGrid } from '../components/mixed-grid';
import { MediaRow } from '../components/media-row';
import { PosterCard } from '../components/cards';
import { ItemMenu } from '../components/item-menu';

export function SearchPage({ initialTerm }: { initialTerm: string }) {
  const { client, user } = useSession();
  const [term, setTerm] = React.useState(initialTerm);
  const debounced = useDebounce(term.trim(), 400);
  const [combine] = useSetting(settings.combineSearch);
  // One search per kind, so neither fills the other's result limit.
  const mixed = useSearch(debounced, 'Movie,Series', combine);
  const movies = useSearch(debounced, 'Movie', !combine);
  const shows = useSearch(debounced, 'Series', !combine);
  const history = useSearchHistory(user.Id!);
  const voice = useVoice((heard) => {
    setTerm(heard);
    history.add(heard);
  }, setTerm);
  // A remote reaches the microphone in one press, and the keyboard only on Select.
  const voiceFirst = !!voice && !!currentHost().tv;

  // Keeps the term in the address, so back returns to the same results.
  React.useEffect(() => {
    if (debounced !== initialTerm) {
      navigate(to.search(debounced), { replace: true });
    }
  }, [debounced, initialTerm]);

  const searching = debounced.length >= 2;
  // The kinds answer at different speeds, so a row never shows the last term.
  const movieItems = movies.isPlaceholderData ? [] : (movies.data?.Items ?? []);
  const showItems = shows.isPlaceholderData ? [] : (shows.data?.Items ?? []);
  const moviesLoading = movies.isLoading || movies.isPlaceholderData;
  const showsLoading = shows.isLoading || shows.isPlaceholderData;
  const loading = combine ? mixed.isLoading : moviesLoading || showsLoading;
  const found = combine
    ? !!mixed.data?.Items?.length
    : !!movieItems.length || !!showItems.length;

  return (
    <PageBody>
      <h1 data-ui="page-title" className="text-3xl font-bold">
        Search
      </h1>
      <div className="flex max-w-xl items-center gap-2">
        {voiceFirst && voice.button}
        <TextInput
          autoFocus={!voiceFirst}
          type="search"
          autoComplete="off"
          enterKeyHint="search"
          value={term}
          onValueChange={setTerm}
          onKeyDown={(e) => {
            if (e.key === 'Enter') history.add(term);
          }}
          placeholder={voice?.hearing ? 'Listening…' : 'Movies and shows'}
          leftIcon={<BiSearch className="text-xl" />}
          data-ui="search-input"
          fieldClass="flex-1"
        />
        {!voiceFirst && voice?.button}
      </div>
      {!term.trim() && history.terms.length > 0 && (
        <section data-ui="search-history" className="max-w-xl space-y-1">
          <div className="flex items-center justify-between gap-3">
            <h2
              data-ui="section-title"
              className="text-sm font-semibold text-[--muted]"
            >
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
                data-ui="search-history-item"
                className="flex items-center rounded-lg transition-colors hover:bg-white/[0.04]"
              >
                {/* A TV, with no remove button, holds Select for it. */}
                <ContextMenu>
                  <ContextMenuTrigger asChild>
                    <button
                      type="button"
                      onClick={() => {
                        setTerm(t);
                        history.add(t);
                      }}
                      data-focus="own"
                      className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2 text-left focus-visible:bg-white/10 [[data-tv]_&]:py-3"
                    >
                      <BiHistory className="flex-none text-lg text-[--muted]" />
                      <span className="truncate">{t}</span>
                    </button>
                  </ContextMenuTrigger>
                  <ContextMenuContent data-ui="search-history-menu">
                    <ContextMenuItem onClick={() => history.remove(t)}>
                      <BiX />
                      Remove
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
                {!currentHost().tv && (
                  <IconButton
                    size="sm"
                    intent="gray-basic"
                    className="mr-1 flex-none rounded-full"
                    icon={<BiX className="text-lg" />}
                    aria-label={`Remove ${t}`}
                    onClick={() => history.remove(t)}
                  />
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {searching && (
        <div
          data-ui="search-results"
          onClickCapture={(e) => {
            if ((e.target as HTMLElement).closest('a')) history.add(debounced);
          }}
        >
          {combine ? (
            <MixedGrid
              items={mixed.data?.Items ?? []}
              client={client}
              loading={mixed.isLoading}
            />
          ) : (
            <div className="space-y-8">
              <ResultRow
                id="search:movies"
                title="Movies"
                items={movieItems}
                loading={moviesLoading}
                client={client}
              />
              <ResultRow
                id="search:shows"
                title="Shows"
                items={showItems}
                loading={showsLoading}
                client={client}
              />
            </div>
          )}
        </div>
      )}
      {searching && !loading && !found && (
        <p className="text-[--muted]">Nothing found for “{debounced}”.</p>
      )}
    </PageBody>
  );
}

function ResultRow({
  id,
  title,
  items,
  loading,
  client,
}: {
  id: string;
  title: string;
  items: BaseItemDto[];
  loading: boolean;
  client: JellyfinClient;
}) {
  const landscape =
    items.length > 0 &&
    items.filter((i) => cardShape(i) === 'landscape').length > items.length / 2;
  return (
    <MediaRow
      id={id}
      title={title}
      shape={landscape ? 'wide' : 'poster'}
      loading={loading}
    >
      {items.map((item) => (
        <ItemMenu key={item.Id} item={item}>
          <PosterCard
            href={href(itemPath(item))}
            shape={landscape ? 'landscape' : cardShape(item)}
            image={(width) => posterUrl(client, item, { maxWidth: width })}
            title={item.Name ?? ''}
            subtitle={itemSubtitle(item)}
            watched={item.UserData?.Played}
            unwatched={item.UserData?.UnplayedItemCount ?? undefined}
            progress={progressOf(item)}
          />
        </ItemMenu>
      ))}
    </MediaRow>
  );
}

function useVoice(
  onHeard: (heard: string) => void,
  onWords: (words: string) => void
) {
  const listen = currentHost().listen;
  const [hearing, setHearing] = React.useState<Hearing | null>(null);
  const listening = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => listening.current?.abort(), []);
  useAction(
    'back',
    () => {
      listening.current?.abort();
    },
    !!hearing
  );
  if (!listen) return null;
  const toggle = () => {
    if (listening.current) return listening.current.abort();
    const current = new AbortController();
    listening.current = current;
    setHearing({ level: 0, text: null });
    listen({
      hearing: (heard) => {
        setHearing(heard);
        if (heard.text) onWords(heard.text);
      },
      signal: current.signal,
    })
      .then((heard) => heard && onHeard(heard))
      .catch((e: Error) => toast(e.message))
      .finally(() => {
        listening.current = null;
        setHearing(null);
      });
  };
  const button = (
    <div className="relative flex-none">
      {hearing && (
        <span
          aria-hidden
          className="absolute inset-0 rounded-full bg-brand-500/40 transition-transform duration-100"
          style={{ transform: `scale(${1 + hearing.level * 0.6})` }}
        />
      )}
      <IconButton
        data-ui="search-voice"
        data-listening={!!hearing || undefined}
        autoFocus={!!currentHost().tv}
        intent={hearing ? 'primary' : 'gray-subtle'}
        className="relative rounded-full"
        icon={<BiMicrophone className="text-xl" />}
        aria-label={hearing ? 'Stop listening' : 'Search by voice'}
        aria-pressed={!!hearing}
        onClick={toggle}
      />
    </div>
  );
  return { hearing, button };
}
