import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
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
import { cn } from '@aiostreams/ui/core/styling';
import { useDebounce } from '@aiostreams/ui/hooks/debounce';
import { currentHost, type Hearing } from '../lib/hosts';
import { useAction } from '../lib/input';
import { useSession } from '../lib/session';
import type { JellyfinClient } from '../lib/client';
import { useSearch, useSearchSuggestions } from '../lib/queries';
import { settings, useSetting } from '../lib/settings';
import { useSearchHistory } from '../lib/search-history';
import { cardImages, cardShape, animatedPosterOf } from '../lib/images';
import { itemSubtitle, progressOf } from '../lib/format';
import { href, itemPath, navigate, to } from '../lib/paths';
import type { BaseItemDto } from '../lib/types';
import { PageBody } from '../components/layout';
import { MixedGrid } from '../components/mixed-grid';
import { MediaRow } from '../components/media-row';
import { PosterCard } from '../components/cards';
import { ItemMenu } from '../components/item-menu';
import { PeopleRow } from '../components/people';

const SUGGESTIONS = 5;

function nameWords(text: string): string[] {
  return (
    text
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

export function SearchPage({ initialTerm }: { initialTerm: string }) {
  const { client, user } = useSession();
  const [term, setTerm] = React.useState(initialTerm);
  // A term picked rather than typed, which searches at once and suggests nothing.
  const [chosen, setChosen] = React.useState(initialTerm);
  const typed = term.trim();
  const debounced = useDebounce(typed, 400);
  const query = typed === chosen ? typed : debounced;
  const [combine] = useSetting(settings.interface.combineSearch);
  // One search per kind, so neither fills the other's result limit.
  const mixed = useSearch(query, 'Movie,Series', combine);
  const movies = useSearch(query, 'Movie', !combine);
  const shows = useSearch(query, 'Series', !combine);
  const people = useSearch(query, 'Person');
  const suggesting = typed !== chosen;
  const suggestions = useSearchSuggestions(
    useDebounce(typed, 200),
    SUGGESTIONS,
    suggesting
  );
  const history = useSearchHistory(user.Id!);
  const choose = (picked: string) => {
    const next = picked.trim();
    setTerm(next);
    setChosen(next);
    history.add(next);
  };
  const voice = useVoice(choose, setTerm);
  // A remote reaches the microphone in one press, and the keyboard only on Select.
  const voiceFirst = !!voice && !!currentHost().tv;

  // Keeps the term in the address, so back returns to the same results.
  React.useEffect(() => {
    if (query !== initialTerm) {
      navigate(to.search(query), { replace: true });
    }
  }, [query, initialTerm]);

  const hints =
    suggesting && typed.length >= 2
      ? (suggestions.data?.SearchHints ?? [])
      : [];
  useKeyboardCompletions(hints.map((h) => h.Name ?? '').filter(Boolean));
  const searching = query.length >= 2;
  // The kinds answer at different speeds, so a row never shows the last term.
  const movieItems = movies.isPlaceholderData ? [] : (movies.data?.Items ?? []);
  const showItems = shows.isPlaceholderData ? [] : (shows.data?.Items ?? []);
  const moviesLoading = movies.isLoading || movies.isPlaceholderData;
  const showsLoading = shows.isLoading || shows.isPlaceholderData;
  // Only people the term names; a search also matches aliases and near spellings.
  const queryWords = nameWords(query);
  const named = (people.isPlaceholderData ? [] : (people.data?.Items ?? []))
    .map((person) => ({ person, words: nameWords(person.Name ?? '') }))
    .filter(({ words }) =>
      queryWords.every((q) => words.some((w) => w.startsWith(q)))
    );
  const peopleFirst = named.some(
    ({ words }) => words.join(' ') === queryWords.join(' ')
  );
  const peopleRow = (
    <PeopleRow
      id="search:people"
      title={t`People`}
      people={named.map(({ person }) => ({
        person: {
          Id: person.Id,
          Name: person.Name,
          PrimaryImageTag: person.ImageTags?.Primary,
        },
      }))}
    />
  );
  const loading =
    (combine ? mixed.isLoading : moviesLoading || showsLoading) ||
    people.isLoading ||
    people.isPlaceholderData;
  const found = combine
    ? !!mixed.data?.Items?.length || !!named.length
    : !!movieItems.length || !!showItems.length || !!named.length;

  return (
    <PageBody>
      <h1 data-ui="page-title" className="text-3xl font-bold">
        <Trans>Search</Trans>
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
            if (e.key === 'Enter') choose(term);
          }}
          placeholder={
            voice?.hearing ? t`Listening…` : t`Movies, shows and people`
          }
          leftIcon={<BiSearch className="text-xl" />}
          data-ui="search-input"
          fieldClass="flex-1"
        />
        {!voiceFirst && voice?.button}
      </div>
      {hints.length > 0 && (
        <ul data-ui="search-suggestions" className="-mx-2 max-w-xl">
          {hints.map((hint) => (
            <li
              key={hint.Id}
              data-ui="search-suggestion"
              className="flex rounded-lg transition-colors hover:bg-white/[0.04]"
            >
              <TermButton
                icon={<BiSearch />}
                label={hint.Name ?? ''}
                detail={hint.ProductionYear?.toString()}
                onClick={() => choose(hint.Name ?? '')}
              />
            </li>
          ))}
        </ul>
      )}
      {!typed && history.terms.length > 0 && (
        <section data-ui="search-history" className="max-w-xl space-y-1">
          <div className="flex items-center justify-between gap-3">
            <h2
              data-ui="section-title"
              className="text-sm font-semibold text-[--muted]"
            >
              <Trans>Recent searches</Trans>
            </h2>
            <Button size="sm" intent="gray-link" onClick={history.clear}>
              <Trans>Clear all</Trans>
            </Button>
          </div>
          <ul className="-mx-2">
            {history.terms.map((term) => (
              <li
                key={term}
                data-ui="search-history-item"
                className="flex items-center rounded-lg transition-colors hover:bg-white/[0.04]"
              >
                {/* A TV, with no remove button, holds Select for it. */}
                <ContextMenu>
                  <ContextMenuTrigger asChild>
                    <TermButton
                      icon={<BiHistory />}
                      label={term}
                      onClick={() => choose(term)}
                    />
                  </ContextMenuTrigger>
                  <ContextMenuContent data-ui="search-history-menu">
                    <ContextMenuItem onClick={() => history.remove(term)}>
                      <BiX />
                      <Trans>Remove</Trans>
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
                {!currentHost().tv && (
                  <IconButton
                    size="sm"
                    intent="gray-basic"
                    className="me-1 flex-none rounded-full"
                    icon={<BiX className="text-lg" />}
                    aria-label={t`Remove ${term}`}
                    onClick={() => history.remove(term)}
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
          className="space-y-8"
          onClickCapture={(e) => {
            if ((e.target as HTMLElement).closest('a')) history.add(query);
          }}
        >
          {peopleFirst && peopleRow}
          {combine ? (
            <MixedGrid
              items={mixed.data?.Items ?? []}
              client={client}
              loading={mixed.isLoading}
            />
          ) : (
            <>
              <ResultRow
                id="search:movies"
                title={t`Movies`}
                items={movieItems}
                loading={moviesLoading}
                client={client}
              />
              <ResultRow
                id="search:shows"
                title={t`Shows`}
                items={showItems}
                loading={showsLoading}
                client={client}
              />
            </>
          )}
          {!peopleFirst && peopleRow}
        </div>
      )}
      {searching && !loading && !found && (
        <p className="text-[--muted]">
          <Trans>Nothing found for “{query}”.</Trans>
        </p>
      )}
    </PageBody>
  );
}

/** Offers the suggestions on the on-screen keyboard too, where a remote can reach them while typing. */
function useKeyboardCompletions(names: string[]) {
  const show = currentHost().keyboardCompletions;
  const key = names.join('\n');
  React.useEffect(() => {
    show?.(key ? key.split('\n') : []);
  }, [show, key]);
  React.useEffect(() => () => show?.([]), [show]);
}

const TermButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    icon: React.ReactElement<{ className?: string }>;
    label: string;
    detail?: string;
  }
>(function TermButton({ icon, label, detail, className, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      data-focus="own"
      className={cn(
        'flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2 text-start focus-visible:bg-white/10 [[data-tv]_&]:py-3',
        className
      )}
      {...props}
    >
      {React.cloneElement(icon, {
        className: 'flex-none text-lg text-[--muted]',
      })}
      <span className="truncate">{label}</span>
      {detail && (
        <span className="flex-none text-sm text-[--muted]">{detail}</span>
      )}
    </button>
  );
});

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
            image={(width) =>
              cardImages(
                client,
                item,
                landscape ? 'landscape' : cardShape(item),
                { maxWidth: width }
              )
            }
            animated={animatedPosterOf(item)}
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
        aria-label={hearing ? t`Stop listening` : t`Search by voice`}
        aria-pressed={!!hearing}
        onClick={toggle}
      />
    </div>
  );
  return { hearing, button };
}
