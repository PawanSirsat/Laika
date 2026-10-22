import { useEffect, useState } from 'react';
import { request } from './client.ts';
import type { OwnLocalActivity } from './local-activity.ts';
import { getPermissions } from './permissions.ts';
import { mayOpenProfiles } from './profiles.ts';
import type { Page } from './tasks.ts';
import type { MyDay } from './time.ts';

/**
 * A person's day, hours and shared local activity, read by somebody else
 * (SPEC §3.1 *"View a member's day, time and shared activity"*, §6.4, D-102,
 * LAI-957; the screens are LAI-959) — and the person's own list of who looked.
 *
 * **The same shapes the person reads**: `GET /people/:id/time` answers exactly
 * `GET /me/time`, and `…/local-activity` exactly `GET /me/local-activity`, so
 * the screens draw them with the person's own components. **Read only** —
 * nothing here writes, and no `/me` write reaches anybody else's rows.
 *
 * **Every read of somebody else is logged** on the server (§4.59), and the
 * person reads that log on `GET /me/analytics-views`.
 *
 * `WhoLooked` mirrors `services/analytics-views.ts`' `WhoLookedView`;
 * `view-type-drift.test.ts` holds the two in step.
 */

/** §3.1's action: carried by *See everyone's analytics* (owner always, admin by default). */
export const PEOPLE_ANALYTICS = 'people.analytics.read';

/** What was looked at. Mirrors `ANALYTICS_VIEW_KINDS` in `server/src/db/enums.ts`. */
export const ANALYTICS_VIEW_KINDS = ['time', 'local_activity', 'activity', 'usage'] as const;
export type AnalyticsViewKind = (typeof ANALYTICS_VIEW_KINDS)[number];

/** One row of `GET /me/analytics-views`: who looked at the caller, and when. */
export interface WhoLooked {
  readonly id: string;
  readonly viewer: { readonly id: string; readonly name: string };
  /** Typed open, so a kind this client has not heard of is drawn rather than dropped. */
  readonly kind: AnalyticsViewKind | (string & {});
  /** The day read, for My day; `null` for a range. */
  readonly day: string | null;
  readonly viewed_at: number;
}

const opts = (signal?: AbortSignal) => (signal === undefined ? {} : { signal });

/** `GET /people/:id/time?day=&tz=` — that person's My day, drafts included. */
export function getPersonDay(
  userId: string,
  day: string,
  tz: string,
  signal?: AbortSignal,
): Promise<MyDay> {
  const query = new URLSearchParams({ day, tz }).toString();
  return request<MyDay>(`/people/${encodeURIComponent(userId)}/time?${query}`, opts(signal));
}

/** `GET /people/:id/local-activity?days=14` — what the board holds for them, as they see it. */
export function getPersonLocalActivity(
  userId: string,
  signal?: AbortSignal,
): Promise<OwnLocalActivity> {
  return request<OwnLocalActivity>(
    `/people/${encodeURIComponent(userId)}/local-activity?days=14`,
    opts(signal),
  );
}

/** `GET /me/analytics-views` — who looked at the caller's analytics, newest first. */
export function listAnalyticsViews(
  query: { readonly limit?: number; readonly cursor?: string | undefined } = {},
  signal?: AbortSignal,
): Promise<Page<WhoLooked>> {
  const params = new URLSearchParams();
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.cursor !== undefined) params.set('cursor', query.cursor);
  const qs = params.toString();
  return request<Page<WhoLooked>>(`/me/analytics-views${qs === '' ? '' : `?${qs}`}`, opts(signal));
}

/**
 * Whether the reader may read other people's analytics — and so open their
 * profile, their day and their hours, and see a name as a link to them.
 *
 * **The server's answer when it has one**: `GET /permissions`' `me.actions`,
 * which already reflects the owner's grants (LAI-958). Until it answers, or if
 * it cannot, **the default grants** stand in — owner and admin — which is
 * what an organisation whose owner changed nothing has. The server refuses
 * every read it would not answer, so a stand-in can only ever show a link the
 * server then refuses, never data.
 */
export function holdsPeopleAnalytics(
  actions: readonly string[] | undefined,
  orgRole: string | undefined,
): boolean {
  return actions === undefined ? mayOpenProfiles(orgRole) : actions.includes(PEOPLE_ANALYTICS);
}

/** How a view of the person's analytics reads in their list. */
export const VIEW_KIND_LABELS: Readonly<Record<AnalyticsViewKind, string>> = {
  time: 'your day',
  local_activity: 'your shared local activity',
  activity: 'your activity heatmap',
  usage: 'your token usage',
};

export function viewKindLabel(kind: WhoLooked['kind']): string {
  return (VIEW_KIND_LABELS as Readonly<Record<string, string>>)[kind] ?? kind.replace(/_/g, ' ');
}

export interface OrgActions {
  /** `GET /permissions`' `me.actions`; `undefined` until it answers, or when it cannot. */
  readonly actions: readonly string[] | undefined;
  /** The question has an answer: read, or failed and left to the defaults. */
  readonly settled: boolean;
}

/**
 * The org actions the reader holds on this credential, as the server computes
 * them — the owner's grants included (D-102 rule 6, LAI-958).
 *
 * **A role says what an organisation whose owner changed nothing allows; this
 * says what this one allows.** Read once per screen through the shared GET
 * cache (`client.ts` keeps `/permissions` for a while), so every link on a
 * page asks one request between them.
 */
export function useOrgActions(enabled = true): OrgActions {
  const [state, setState] = useState<OrgActions>({ actions: undefined, settled: false });

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    getPermissions(controller.signal)
      .then((permissions) => {
        if (!controller.signal.aborted) {
          setState({ actions: permissions.me.actions, settled: true });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ actions: undefined, settled: true });
      });
    return () => {
      controller.abort();
    };
  }, [enabled]);

  return state;
}
