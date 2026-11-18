/**
 * What the one app header says (LAI-1188), kept apart from the component so
 * `node --test` can drive every rule: whether the reader is looking at
 * somebody else, and where each view of a person is.
 *
 * **No breadcrumb here since LAI-1227**: the top bar is Jira's and names no
 * page. Each page names itself once, in its own `h1`: a space's views by the
 * space's name and mark (`SpaceTopBar`, with no *Spaces /* above it since
 * LAI-1328), a member's profile under its *People /* trail (`ScreenHeader`'s
 * crumbs variant).
 */

/** The screens that already show another person's data (LAI-959, LAI-1138, LAI-1170). */
export type PersonViewKind = 'my-day' | 'work' | 'time';

/** A person view in effect: which screen, and whose. */
export interface PersonView {
  readonly kind: PersonViewKind;
  readonly userId: string;
}

/** A single id, not a list, `none` or blank: what *one person* means in each address. */
function onePerson(value: string | null, meId: string | undefined): string | undefined {
  if (value === null) return undefined;
  const id = value.trim();
  if (id === '' || id === 'none' || id.includes(',') || id === meId) return undefined;
  return id;
}

/**
 * Whether the address is a view of somebody other than the reader, on a
 * screen that shows one: My day's `?user=`, Work's `&person=`, Insights →
 * Time's `&member=` naming exactly one person. What each screen *draws* is
 * still the server's decision; this only says what the address asks for.
 */
export function personView(
  path: string,
  params: URLSearchParams,
  meId: string | undefined,
): PersonView | undefined {
  const as = (kind: PersonViewKind, id: string | undefined): PersonView | undefined =>
    id === undefined ? undefined : { kind, userId: id };
  if (path === '/my-day') return as('my-day', onePerson(params.get('user'), meId));
  if (path === '/organisation' && params.get('tab') === 'work') {
    return as('work', onePerson(params.get('person'), meId));
  }
  if (path === '/insights' && params.get('tab') === 'time') {
    return as('time', onePerson(params.get('member'), meId));
  }
  return undefined;
}

/** The query string, with a leading `?` when there is one. */
function query(params: URLSearchParams): string {
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
}

/**
 * The same screen as the reader's own: My day without `?user=`, Work and
 * Time filtered to the reader. Every other filter stays as it was.
 */
export function backToMeHref(
  view: PersonView,
  path: string,
  params: URLSearchParams,
  meId: string,
): string {
  const next = new URLSearchParams(params);
  if (view.kind === 'my-day') next.delete('user');
  if (view.kind === 'work') next.set('person', meId);
  if (view.kind === 'time') next.set('member', meId);
  return `${path}${query(next)}`;
}

/** One place a person can be looked at from the palette. */
export interface PersonTarget {
  readonly id: 'profile' | PersonViewKind;
  readonly label: string;
  readonly href: string;
}

/** Which screen a path is, as a person view, so the palette can offer it first. */
function currentKind(path: string, params: URLSearchParams): PersonTarget['id'] | undefined {
  if (path === '/people') return 'profile';
  if (path === '/my-day') return 'my-day';
  if (path === '/organisation' && params.get('tab') === 'work') return 'work';
  if (path === '/insights' && params.get('tab') === 'time') return 'time';
  return undefined;
}

/**
 * The views of one person a reader may open, each gated on the server's
 * answer exactly as the screen behind it is: the profile on `profile.read`
 * (the route's own `requires`), their day and their work on *See everyone's
 * analytics* (`people.analytics.read`, which My day's *Viewing* switch and
 * Work's *By person* ask), their time on `time.report.read` (the org report,
 * whose member filter it fills). A screen the reader cannot open is not
 * offered. The screen the reader is on comes first.
 */
export function personTargets(
  userId: string,
  holds: (permission: string) => boolean,
  path: string,
  params: URLSearchParams,
): readonly PersonTarget[] {
  const id = encodeURIComponent(userId);
  const all: PersonTarget[] = [];
  if (holds('profile.read')) {
    all.push({ id: 'profile', label: 'Open profile', href: `/people?user=${id}` });
  }
  if (holds('people.analytics.read')) {
    all.push({ id: 'my-day', label: 'View their day', href: `/my-day?user=${id}` });
    all.push({
      id: 'work',
      label: 'View their work',
      href: `/organisation?tab=work&person=${id}`,
    });
  }
  if (holds('time.report.read')) {
    all.push({ id: 'time', label: 'View their time', href: `/insights?tab=time&member=${id}` });
  }
  const here = currentKind(path, params);
  return [...all.filter((t) => t.id === here), ...all.filter((t) => t.id !== here)];
}

/** The permission that opens the People group and the person view at all. */
export const SEE_EVERYONE = 'people.analytics.read';

/** A person row the palette can match. */
export interface PersonRow {
  readonly id: string;
  readonly name: string;
  readonly email: string;
}

/** People whose name or email holds every word of the query, the reader left out. */
export function matchPeople<T extends PersonRow>(
  people: readonly T[],
  query: string,
  meId: string | undefined,
  limit = 6,
): readonly T[] {
  const words = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w !== '');
  if (words.length === 0) return [];
  return people
    .filter((p) => p.id !== meId)
    .filter((p) => {
      const hay = `${p.name} ${p.email}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .slice(0, limit);
}

/**
 * Whether `/` opens the header search (LAI-1188). A screen with its own search
 * field claims `/` for it by marking the field `aria-keyshortcuts="/"` — the
 * space toolbar and the board toolbar do — and there the key keeps focusing
 * that field, as it always did. Everywhere else `/` opens the palette.
 */
export function slashOpensSearch(doc: Pick<Document, 'querySelector'>): boolean {
  return doc.querySelector('[aria-keyshortcuts="/"]') === null;
}
