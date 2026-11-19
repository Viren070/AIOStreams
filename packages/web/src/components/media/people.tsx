import { t } from '@lingui/core/macro';
import { formatLocale } from '@/lib/i18n';
import { useSession } from '@/lib/jellyfin/session';
import { useItem } from '@/lib/jellyfin/queries';
import { useNear } from '@/hooks/use-in-view';
import { personImageUrl } from '@/lib/artwork/urls';
import { href, to } from '@/lib/paths';
import { MediaRow } from './media-row';
import type { BaseItemPerson } from '@/lib/jellyfin/types';
import { CachedImage } from '@/components/cached-image';
import { Anchor } from '@/components/anchor';

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
  role,
}: {
  person: BaseItemPerson;
  detail?: string | null;
  /** The kind of work their page opens on, such as Director. */
  role?: string;
}) {
  const { client } = useSession();
  // A crew member often comes as a name only; their own item, which their
  // page loads too, has their photo. Asked once the card nears the screen.
  const [frame, near] = useNear<HTMLDivElement>();
  const lookUp = !person.PrimaryImageTag && near ? (person.Id ?? '') : '';
  const own = useItem(lookUp);
  const image = personImageUrl(client, {
    Id: person.Id,
    PrimaryImageTag: person.PrimaryImageTag ?? own.data?.ImageTags?.Primary,
  });
  const body = (
    <>
      <div
        ref={frame}
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
      href={href(to.person(person.Id, role))}
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
  people: { person: BaseItemPerson; detail?: string | null; role?: string }[];
}) {
  return (
    <MediaRow id={id} title={title} shape="square" itemClass={PERSON_WIDTH}>
      {people.map(({ person, detail, role }) => (
        <PersonCard
          key={person.Id ?? person.Name}
          person={person}
          detail={detail}
          role={role}
        />
      ))}
    </MediaRow>
  );
}

// eslint-disable-next-line lingui/no-unlocalized-strings -- Jellyfin's person kinds
const CAST = new Set(['Actor', 'GuestStar']);

/** The crew's jobs in the order a title's credits read; any other comes after. */
// eslint-disable-next-line lingui/no-unlocalized-strings -- Jellyfin's person kinds
const CREW_ORDER = ['Director', 'Creator', 'Writer', 'Composer', 'Producer'];

const crewRank = (job: string) => {
  const at = CREW_ORDER.indexOf(job);
  return at < 0 ? CREW_ORDER.length : at;
};

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
      return t({ comment: 'A crew member’s job: the score', message: 'Music' });
    case 'Creator':
      return t`Creator`;
    default:
      return kind;
  }
}

/**
 * The cast with their characters, then the crew by their main job, with every
 * job they held; each opens their page on the job they did here.
 */
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
    // By name: one job can come with the person's TMDB id and another with
    // their name alone, which gives the same person two ids.
    const key = (person.Name ?? person.Id ?? '').toLowerCase();
    const entry = crew.get(key) ?? { person, jobs: [] };
    if (person.PrimaryImageTag && !entry.person.PrimaryImageTag)
      entry.person = person;
    const job = String(person.Type ?? '');
    if (job && !entry.jobs.includes(job)) entry.jobs.push(job);
    crew.set(key, entry);
  }
  // Commas between jobs: a narrow list runs them together with spaces.
  const list = new Intl.ListFormat(formatLocale(), {
    style: 'short',
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
        people={[...crew.values()]
          .map(({ person, jobs }) => ({
            person,
            jobs: [...jobs].sort((a, b) => crewRank(a) - crewRank(b)),
          }))
          .sort((a, b) => crewRank(a.jobs[0]) - crewRank(b.jobs[0]))
          .map(({ person, jobs }) => ({
            person,
            detail: list.format(jobs.map(jobLabel)),
            role: jobs[0],
          }))}
      />
    </>
  );
}
