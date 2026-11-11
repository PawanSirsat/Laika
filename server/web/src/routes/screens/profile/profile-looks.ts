import type { WhoLooked } from '../../../api/people-analytics.ts';
import type { OrgRole } from '../../../api/invites.ts';
import { orgRoleLabel } from '../invite-roles.ts';

/**
 * *Who looked · last 30 days* on your own profile (D-139 item 3, SPEC
 * §11.4.2.1, LAI-1152): each look at you by an owner or admin, the tab it came
 * from, and when. **Every look**, not one line a person — the log is the
 * point. Pure; the reads are `ProfileWhoLooked`'s.
 */

/** The window the popover lists and counts. The log itself keeps 400 days (§4.59). */
export const LOOKS_WINDOW_MS = 30 * 86_400_000;

/**
 * The tab a look came from, in the profile's own words. `time` is read by Day
 * and by the Time report alike, and is named for the report; `local_activity`
 * is drawn on the Activity card.
 */
const LOOK_TABS: Readonly<Record<string, string>> = {
  profile: 'Overview',
  time: 'Time report',
  activity: 'Activity',
  local_activity: 'Activity',
  usage: 'LLM tokens',
  developer_setup: 'Developer access',
};

/** A kind this client has not heard of is said in words rather than dropped. */
export function lookTab(kind: WhoLooked['kind']): string {
  return LOOK_TABS[kind] ?? kind.replace(/_/g, ' ');
}

/** The looks inside the window ending at `now`, newest first as the server sent them. */
export function recentLooks(rows: readonly WhoLooked[], now: number): WhoLooked[] {
  const since = now - LOOKS_WINDOW_MS;
  return rows.filter((row) => row.viewed_at >= since);
}

/**
 * Whether a newest-first page reaches back past the window, so no older page
 * can add a look. An empty page reaches nothing and needs no more.
 */
export function pastWindow(rows: readonly WhoLooked[], now: number): boolean {
  const oldest = rows[rows.length - 1];
  return oldest === undefined || oldest.viewed_at < now - LOOKS_WINDOW_MS;
}

/**
 * The badge's number: the server's `total` when it sent one (LAI-1150 counts
 * `?since=` for us), else the looks read inside the window.
 */
export function lookCount(
  read: readonly WhoLooked[],
  total: number | undefined,
  now: number,
): number {
  return total ?? recentLooks(read, now).length;
}

/**
 * The viewer's org role, in the app's words — or `undefined` when the server
 * did not say (before LAI-1150 it sends no `org_role`).
 */
export function viewerRole(viewer: WhoLooked['viewer']): string | undefined {
  const role = (viewer as { readonly org_role?: unknown }).org_role;
  return typeof role === 'string' && role !== '' ? orgRoleLabel(role as OrgRole) : undefined;
}
