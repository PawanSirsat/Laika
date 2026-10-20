/**
 * Old addresses, and where each one lives now (LAI-796).
 *
 * The owner's reorganisation folded six pages into three: Review and Unlisted
 * work are the tabs of **Inbox**, Capacity and Usage the tabs of **Insights**,
 * and Connect and Tokens are **Developer access** — the wizard keeping its own
 * address under it. A bookmark, a link an agent printed or a URL a teammate
 * pasted still names the old page, so each answers with its new home.
 *
 * **The query travels with it.** `?agent=` on Connect is how a lead sends the
 * page already set to the team's agent (LAI-737); dropping it would land the
 * link on the right page with the wrong agent. The one exception is
 * Capacity's `?project=`, which LAI-754 already threw away when Capacity
 * stopped being a space tab.
 *
 * Applied by `useRoute` before anything renders, as a `replace` — Back must not
 * return to an address that only bounces forward again.
 */

interface Redirect {
  readonly to: string;
  /** The tab the old page was, written into the new address. */
  readonly tab?: string;
  /** Parameters the new page does not read and the old one did. */
  readonly drop?: readonly string[];
}

export const REDIRECTS: Readonly<Record<string, Redirect>> = {
  '/review': { to: '/inbox', tab: 'review' },
  '/unlisted': { to: '/inbox', tab: 'unlisted' },
  '/capacity': { to: '/insights', tab: 'capacity', drop: ['project'] },
  '/usage': { to: '/insights', tab: 'usage' },
  '/tokens': { to: '/developer' },
  '/connect': { to: '/developer/connect' },
};

/**
 * The new address for an old one, or `undefined` for a path that has not moved.
 *
 * `search` may carry its `?` or not. The tab comes first in the result so the
 * address reads as *where*, then *what*.
 */
export function redirectFor(path: string, search: string): string | undefined {
  const normalised = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  const redirect = REDIRECTS[normalised];
  if (redirect === undefined) return undefined;

  const given = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const next = new URLSearchParams();
  if (redirect.tab !== undefined) next.set('tab', redirect.tab);
  for (const [key, value] of given) {
    if (key === 'tab' && redirect.tab !== undefined) continue;
    if (redirect.drop?.includes(key) === true) continue;
    next.append(key, value);
  }

  const query = next.toString();
  return query === '' ? redirect.to : `${redirect.to}?${query}`;
}
