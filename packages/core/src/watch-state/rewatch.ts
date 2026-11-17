/**
 * Where Next Up goes on to with Jellyfin's `EnableRewatching`: from the
 * episode played most recently rather than the furthest one watched.
 *
 * Next Up goes on from the furthest episode watched, so a show watched up to
 * its newest episode has nothing to offer while someone watches it again, or
 * goes back to earlier episodes they never saw. Either way it goes on from the
 * episode played most recently, found by its own play date as Jellyfin does:
 * an import can give every row of a show one timestamp, so the row order says
 * nothing about which was played last. The answer is the first episode after
 * it that has aired, whether it was watched before or not, or that episode
 * itself while it was stopped part-way through. An episode started and left
 * unfinished counts as a play from the date it was left.
 *
 * Only a play behind the furthest episode watched changes anything. Otherwise,
 * or with no dated play, this is -1 and the usual Next Up applies.
 */
export function rewatchNextIndex(
  episodes: readonly {
    played: boolean;
    aired: boolean;
    lastPlayedAt?: number | null;
    inProgress?: boolean;
  }[]
): number {
  let anchor = -1;
  let furthest = -1;
  episodes.forEach((episode, i) => {
    if (episode.played) furthest = i;
    else if (!episode.inProgress) return;
    const at = episode.lastPlayedAt ?? 0;
    // `>=`: plays sharing a date go on from the furthest of them.
    if (at > 0 && (anchor < 0 || at >= (episodes[anchor].lastPlayedAt ?? 0)))
      anchor = i;
  });
  if (anchor < 0 || anchor >= furthest) return -1;
  if (episodes[anchor].inProgress) return anchor;
  for (let i = anchor + 1; i < episodes.length; i++) {
    if (episodes[i].aired) return i;
  }
  return -1;
}

/**
 * Whether an aired episode was played after the last aired one, given each
 * one's last play date in order: a show watched to the end can only be
 * rewatched from such a play, so without one Next Up needn't look further.
 */
export function playedBackSince(
  lastPlayedAt: readonly (number | null | undefined)[]
): boolean {
  if (!lastPlayedAt.length) return false;
  const last = lastPlayedAt[lastPlayedAt.length - 1] ?? 0;
  return lastPlayedAt.slice(0, -1).some((at) => (at ?? 0) > last);
}
