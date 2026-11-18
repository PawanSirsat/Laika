import type {
  Leaver,
  LeaverReview,
  PeopleSync,
  PeopleSyncError,
  PeopleSyncResult,
} from '../../../api/people-sync.ts';

/**
 * The words the Microsoft 365 card says about the people sync (D-161,
 * LAI-1330), as plain functions `node --test` can pin. The server's own
 * failure text is Laika's words already; these add the counts, the leaver
 * review and what each switch does.
 */

const plural = (n: number, one: string, many = `${one}s`): string =>
  `${String(n)} ${n === 1 ? one : many}`;

/** Why the last run stopped, in a sentence. */
export function peopleSyncErrorWords(error: PeopleSyncError): string {
  return error.message.replace(/\.$/, '');
}

/** What a complete run read and kept: "9 people read: 8 found, 1 not in Microsoft; 2 photos updated". */
export function peopleCountsLine(result: PeopleSyncResult): string {
  const missed = [
    result.not_found > 0 ? `${String(result.not_found)} not in Microsoft` : null,
    result.denied > 0 ? `${String(result.denied)} Microsoft would not show` : null,
    result.refused > 0 ? `${String(result.refused)} Microsoft would not look up` : null,
    result.changed > 0 ? `${String(result.changed)} whose Microsoft account changed` : null,
  ].filter((part): part is string => part !== null);
  const read = `${plural(result.people, 'person', 'people')} read: ${String(result.found)} found${
    missed.length === 0 ? '' : `, ${missed.join(', ')}`
  }`;
  const photos = [
    result.photos_fetched > 0 ? `${plural(result.photos_fetched, 'photo')} updated` : null,
    result.photos_removed > 0 ? `${plural(result.photos_removed, 'photo')} removed` : null,
    result.photos_refused > 0 ? `${plural(result.photos_refused, 'photo')} refused` : null,
    result.photos_deferred > 0 ? `${plural(result.photos_deferred, 'photo')} next time` : null,
  ].filter((part): part is string => part !== null);
  return photos.length === 0 ? read : `${read}; ${photos.join(', ')}`;
}

/** Why someone is on the list. */
export function leaverReasonWords(leaver: Leaver): string {
  return leaver.reason === 'disabled'
    ? 'account turned off in Microsoft'
    : 'no longer in Microsoft for over an hour';
}

/** Why the sync never deactivates them, or that it tried and failed; null for neither. */
export function protectionWords(leaver: Leaver): string | null {
  if (leaver.protected === 'owner') return 'never deactivated: the owner';
  if (leaver.protected === 'last_admin') return 'never deactivated: the last admin';
  if (leaver.failed) return 'could not be deactivated: do it by hand on People';
  return null;
}

/** The heading over accounts to check, or null when there are none. */
export function changedHeadline(count: number): string | null {
  if (count === 0) return null;
  return count === 1
    ? 'Microsoft account changed — check this person by hand. Nothing of theirs was changed:'
    : 'Microsoft accounts changed — check these people by hand. Nothing of theirs was changed:';
}

/** The breaker, in the card's words. */
export const BREAKER_RULE = 'more than 3 people, or more than a tenth of the members, within a day';

/** The leaver review's headline, or null when there is nothing to say. */
export function leaverHeadline(review: LeaverReview): string | null {
  switch (review.state) {
    case 'none':
      return null;
    case 'dry_run':
      return review.breaker
        ? `Leavers is off. Turned on, the next sync would deactivate nobody and hold these for you to check — ${BREAKER_RULE}:`
        : 'Leavers is off. Turned on, the next sync would deactivate:';
    case 'held':
      return `Held for you to check — ${BREAKER_RULE}. Nobody was deactivated; deactivate anyone who has left from People.`;
    case 'deactivated':
      return 'Deactivated by the last sync:';
  }
}

/** What *Photos and profile* says under its switch. */
export function profileNote(view: PeopleSync): string {
  if (!view.connected) return 'Save the app’s tenant, client ID and secret first.';
  const photos = view.photos_stored
    ? 'Photos are kept on this board, so Microsoft is never asked when a face is shown.'
    : 'This board has no file store, so photos are left out; titles and managers are still read.';
  return view.profile_enabled
    ? `On: every ${String(view.sync_every_minutes)} minutes. ${photos}`
    : `Off: nothing is read. Needs User.Read.All granted to the app. ${photos}`;
}

/** What *Leavers* says under its switch. */
export function leaversNote(view: PeopleSync, mayDeactivate: boolean): string {
  if (!view.profile_enabled) return 'Turn on Photos and profile first: it is what finds leavers.';
  if (!mayDeactivate && !view.leavers_enabled) {
    return 'Only someone who may deactivate people can turn this on.';
  }
  return view.leavers_enabled
    ? `On: someone whose account Microsoft turned off, or who has gone from it, for over an hour, is deactivated — never the owner or the last admin, and nobody past ${BREAKER_RULE}.`
    : 'Off: each sync lists who would be deactivated, below, and nobody is.';
}
