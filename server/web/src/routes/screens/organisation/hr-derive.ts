import { dateLabel } from '../../../api/date-only.ts';
import type { HrPerson, HrSource, HrSyncResult, OrgHoliday } from '../../../api/hr.ts';

/**
 * The words and lists the Organisation screen's *HR system* and *Holidays*
 * facts draw from LAI-1181's answers (D-149). Pure, so every sentence here is
 * tested without a browser; the components only lay them out.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The value a picker row holds for "Not on Laika": an owner's explicit no. */
export const NOT_ON_LAIKA = 'not-on-laika';

/** `1 holiday`, `2 holidays`. */
function count(n: number, one: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

/**
 * The window the Holidays list reads: this year and next, in the reader's own
 * calendar. `1 Jan` to `31 Dec` the year after is at most 731 days, the
 * server's limit.
 */
export function holidayWindow(now: number): {
  readonly from: string;
  readonly to: string;
  readonly years: readonly [number, number];
} {
  const year = new Date(now).getFullYear();
  return {
    from: `${String(year)}-01-01`,
    to: `${String(year + 1)}-12-31`,
    years: [year, year + 1],
  };
}

/** `Thu 24 Sep` — a holiday's day, read as the calendar date it is (no zone). */
export function holidayDayLabel(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return day;
  return `${DAYS[d.getUTCDay()] ?? ''} ${String(d.getUTCDate())} ${MONTHS[d.getUTCMonth()] ?? ''}`;
}

/** The reader's today as `YYYY-MM-DD`, to tell a past holiday from one to come. */
export function localDay(now: number): string {
  const d = new Date(now);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${String(d.getFullYear())}-${mm}-${dd}`;
}

/** The holidays of each year asked, by day then label; a year with none is kept, empty. */
export function holidaysByYear(
  holidays: readonly OrgHoliday[],
  years: readonly number[],
): readonly { readonly year: number; readonly holidays: readonly OrgHoliday[] }[] {
  const sorted = [...holidays].sort((a, b) =>
    a.day === b.day ? a.label.localeCompare(b.label) : a.day < b.day ? -1 : 1,
  );
  return years.map((year) => ({
    year,
    holidays: sorted.filter((h) => h.day.startsWith(`${String(year)}-`)),
  }));
}

/** A new holiday, put where the list would have it. */
export function withHoliday(
  holidays: readonly OrgHoliday[],
  added: OrgHoliday,
): readonly OrgHoliday[] {
  return [...holidays.filter((h) => h.id !== added.id), added].sort((a, b) =>
    a.day === b.day ? a.label.localeCompare(b.label) : a.day < b.day ? -1 : 1,
  );
}

/** `Connected as hr@kvelld.co.za · token …a1b2, renews by 12 Jul 2027`. */
export function connectedLine(view: HrSource): string {
  const who = view.account_email ?? 'Clan';
  const token = view.token_last4 === null ? '' : ` · token …${view.token_last4}`;
  const renews =
    view.token_expires_at === null ? '' : `, renews by ${dateLabel(view.token_expires_at)}`;
  return `Connected as ${who}${token}${renews}`;
}

/** `12 holidays · 340 leave days · 9 of 11 people matched`. */
export function countsLine(result: HrSyncResult): string {
  return [
    count(result.holidays, 'holiday', 'holidays'),
    count(result.leave_days, 'leave day', 'leave days'),
    `${String(result.matched)} of ${String(result.people)} people matched`,
  ].join(' · ');
}

type MethodKind = 'email' | 'app' | 'text' | 'other';

/** Clan's name for how a code is sent, read loosely: its API does not list them. */
function methodKind(method: string): MethodKind {
  const m = method.toLowerCase();
  if (m.includes('mail')) return 'email';
  if (m.includes('google') || m.includes('authenticator') || m.includes('totp') || m === 'app') {
    return 'app';
  }
  if (m.includes('sms') || m.includes('phone')) return 'text';
  return 'other';
}

/** `the code Clan emailed you`, `the code from your authenticator app`, or Clan's own name. */
export function twoFactorWords(method: string): string {
  switch (methodKind(method)) {
    case 'email':
      return 'the code Clan emailed you';
    case 'app':
      return 'the code from your authenticator app';
    case 'text':
      return 'the code Clan texted you';
    case 'other':
      return `the code from ${method}`;
  }
}

/** A method's name on its button: `Email`, `Authenticator app`, `Text message`, or Clan's. */
export function twoFactorMethodName(method: string): string {
  switch (methodKind(method)) {
    case 'email':
      return 'Email';
    case 'app':
      return 'Authenticator app';
    case 'text':
      return 'Text message';
    case 'other':
      return method;
  }
}

/** The people an owner has a say on: unmatched, and those already mapped by hand. */
export function peopleToReview(people: readonly HrPerson[]): readonly HrPerson[] {
  return people.filter((p) => p.matched_by !== 'email');
}

/** What a picker row shows before anybody touches it. */
export function initialChoice(person: HrPerson): string {
  if (person.matched_by === 'none') return '';
  return person.user?.id ?? NOT_ON_LAIKA;
}

/**
 * The body of `PUT /org/hr/people`: each row whose choice differs from what
 * the server holds. An untouched unmatched row (`''`) sends nothing.
 */
export function mappingChanges(
  people: readonly HrPerson[],
  choices: Readonly<Record<string, string>>,
): readonly { readonly external_id: string; readonly user_id: string | null }[] {
  const out: { external_id: string; user_id: string | null }[] = [];
  for (const person of people) {
    const chosen = choices[person.external_id];
    if (chosen === undefined || chosen === '' || chosen === initialChoice(person)) continue;
    out.push({
      external_id: person.external_id,
      user_id: chosen === NOT_ON_LAIKA ? null : chosen,
    });
  }
  return out;
}

/** Who holds a Laika member, and whether picking them elsewhere is refused. */
export interface Holder {
  readonly name: string;
  /**
   * An owner's mapping, or a choice made in this form: the server refuses a
   * second (`user_mapped_elsewhere`, `duplicate_user`). An email match is not
   * locked — the owner's word moves it.
   */
  readonly locked: boolean;
}

/**
 * Each Laika member held by a Clan person other than `except`, counting this
 * form's unsaved choices, with that person's name — so a row's picker can say
 * whose a member is, and grey out the ones it may not take.
 */
export function heldBy(
  people: readonly HrPerson[],
  choices: Readonly<Record<string, string>>,
  except: string,
): ReadonlyMap<string, Holder> {
  const out = new Map<string, Holder>();
  for (const p of people) {
    if (p.external_id === except) continue;
    const chosen = choices[p.external_id];
    if (chosen === undefined || chosen === '') {
      if (p.user !== null) out.set(p.user.id, { name: p.name, locked: p.matched_by === 'owner' });
    } else if (chosen !== NOT_ON_LAIKA) {
      out.set(chosen, { name: p.name, locked: true });
    }
  }
  return out;
}

/**
 * The company address an owner typed, from the one the server keeps: it
 * normalises to `…/api/v1`, which is Clan's API and not the page anyone
 * signs in at.
 */
export function companyAddress(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '').replace(/\/api\/v1$/, '');
}

/** The address Clan is signed in at: `https:` only, as the server requires. */
export function isHttpsAddress(text: string): boolean {
  try {
    const url = new URL(text.trim());
    return url.protocol === 'https:' && url.hostname !== '';
  } catch {
    return false;
  }
}
