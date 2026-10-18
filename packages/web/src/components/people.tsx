import { t } from '@lingui/core/macro';
import { formatLocale } from '../lib/i18n';
import { useSession } from '../lib/session';
import { personImageUrl } from '../lib/images';
import { href, to } from '../lib/paths';
import { MediaRow } from './media-row';
import type { BaseItemPerson } from '../lib/types';
import { CachedImage } from './cached-image';
import { Anchor } from './anchor';

const PERSON_WIDTH = 'basis-[6.5rem] sm:basis-[7.5rem]';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : ''))
    .toUpperCase()
    .trim();
}

export function PersonCard({
  person,
  detail,
}: {
  person: BaseItemPerson;
  detail?: string | null;
}) {
  const { client } = useSession();
  const image = personImageUrl(client, person);
  const body = (
    <>
      <div
        data-ui="person-card-image"
        data-focus-frame
        className="relative mx-auto size-20 overflow-hidden rounded-full bg-gray-900 ring-1 ring-white/10 transition group-hover:ring-white/40 sm:size-24"
      >
        {image ? (
          <CachedImage
            src={image}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-lg font-semibold text-[--muted]">
            {initials(person.Name ?? '?')}
          </span>
        )}
      </div>
      <p
        data-ui="person-card-name"
        className="mt-2 line-clamp-2 text-xs font-medium group-hover:underline"
      >
        {person.Name}
      </p>
      {detail && (
        <p
          data-ui="person-card-role"
          className="line-clamp-2 text-xs text-[--muted]"
        >
          {detail}
        </p>
      )}
    </>
  );
  return person.Id ? (
    <Anchor
      data-ui="person-card"
      href={href(to.person(person.Id))}
      data-focus="own"
      className="group block text-center"
    >
      {body}
    </Anchor>
  ) : (
    <div data-ui="person-card" className="text-center">
      {body}
    </div>
  );
}

export function PeopleRow({
  id,
  title,
  people,
}: {
  id: string;
  title: string;
  people: { person: BaseItemPerson; detail?: string | null }[];
}) {
  return (
    <MediaRow id={id} title={title} shape="square" itemClass={PERSON_WIDTH}>
      {people.map(({ person, detail }) => (
        <PersonCard
          key={person.Id ?? person.Name}
          person={person}
          detail={detail}
        />
      ))}
    </MediaRow>
  );
}

// eslint-disable-next-line lingui/no-unlocalized-strings -- Jellyfin's person kinds
const CAST = new Set(['Actor', 'GuestStar']);

/** A crew job by the kinds AIOStreams sends; any other shows as the server names it. */
function jobLabel(kind: string): string {
  switch (kind) {
    case 'Director':
      return t`Director`;
    case 'Writer':
      return t`Writer`;
    case 'Producer':
      return t`Producer`;
    case 'Composer':
      return t`Composer`;
    case 'Creator':
      return t`Creator`;
    default:
      return kind;
  }
}

/** The cast with their characters, then the crew with every job they held. */
export function CastAndCrew({
  people,
}: {
  people: BaseItemPerson[] | null | undefined;
}) {
  const all = people ?? [];
  const cast = all.filter((p) => CAST.has(String(p.Type)));
  const crew = new Map<string, { person: BaseItemPerson; jobs: string[] }>();
  for (const person of all) {
    if (CAST.has(String(person.Type))) continue;
    const key = person.Id ?? person.Name ?? '';
    const entry = crew.get(key) ?? { person, jobs: [] };
    const job = String(person.Type ?? '');
    if (job && !entry.jobs.includes(job)) entry.jobs.push(job);
    crew.set(key, entry);
  }
  const list = new Intl.ListFormat(formatLocale(), {
    style: 'narrow',
    type: 'unit',
  });
  return (
    <>
      <PeopleRow
        id="cast"
        title={t`Cast`}
        people={cast
          .slice(0, 40)
          .map((person) => ({ person, detail: person.Role }))}
      />
      <PeopleRow
        id="crew"
        title={t`Crew`}
        people={[...crew.values()].map(({ person, jobs }) => ({
          person,
          detail: list.format(jobs.map(jobLabel)),
        }))}
      />
    </>
  );
}
