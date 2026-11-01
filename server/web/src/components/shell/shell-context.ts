import type { PersonInboxCounts } from '../../api/handoffs.ts';
import { createContext, useContext } from 'react';
import type { MeProfile } from '../../api/me.ts';
import type { SessionState } from '../../api/use-session.ts';
import type { SetupSystemStatus } from '../../api/setup.ts';
import type { Credentials } from '../../api/auth.ts';
import type { TokenAlert } from '../../api/token-alerts.ts';
import type { ReviewQueueItem } from '../../api/review.ts';
import type { UseRoute } from '../../routes/use-route.ts';

/**
 * What the shell knows, for the screens inside it (LAI-250).
 *
 * **A context rather than props threaded through `AppShell`.** The shell used
 * to build every screen's arguments itself, which is why one file owned the
 * session, the setup gate, the invite token, sixteen route branches and three
 * submit handlers at once.
 *
 * **Routing is in here because it cannot be re-derived.** `useRoute` holds its
 * own `useState`, so a second caller gets a second copy: `navigate()` in one
 * would move the URL while the other kept rendering the old path. One instance,
 * shared — the alternative is a desync nobody sees until Back stops working.
 */
export interface ShellValue {
  /** The single routing instance. See above — never call `useRoute` again. */
  readonly route: UseRoute;
  readonly session: SessionState;
  /** The signed-in user, or `undefined` in every other session state. */
  readonly me: MeProfile | undefined;
  readonly signIn: (credentials: Credentials) => Promise<void>;
  readonly signOut: () => void;
  readonly signingOut: boolean;
  /** Re-probe `/me`. What turns a fresh cookie into an authenticated session. */
  readonly retry: () => void;
  /** What the instance reports about itself, for first boot. */
  readonly system: SetupSystemStatus | undefined;
  /** Setup finished in this tab — flips the gate without waiting for a refetch. */
  readonly markComplete: () => void;
  /** Re-read `/setup/status`, for when another tab got there first. */
  readonly recheck: () => void;
  /** Laika's own version, from `/health`. `undefined` until it answers. */
  readonly version: string | undefined;
  /**
   * Sprints in the active project, and the organisation's name.
   *
   * Here for the same reason routing is: `useShellContext` fetches and opens an
   * SSE subscription, so a second caller would mean a second stream per
   * project. The rail and the tab strip both want the count; they read it from
   * one call.
   */
  readonly sprintCount: number | undefined;
  readonly orgName: string | undefined;
  /** The open project's name, for the rail's wordmark and the bar's fallback. */
  readonly spaceName: string | undefined;
  /** The open project's id, from the same read (LAI-178); `undefined` until it lands. */
  readonly spaceId: string | undefined;
  /**
   * Unlisted notes still waiting, for an owner or admin (LAI-754); `undefined`
   * for everyone else. Here because the rail's badge and Capacity's link are
   * one number from one request.
   */
  readonly unlistedOpen: number | undefined;
  /** Re-read that count — the Unlisted screen calls it after a promote or a dismiss. */
  readonly refreshUnlisted: () => void;
  /**
   * Tasks waiting in review for this person (D-082, LAI-758), for the rail's
   * badge; `undefined` until read. Everyone signed in has a queue.
   */
  readonly reviewWaiting: number | undefined;
  /** More wait than the server's 200, so `reviewWaiting` is a floor (LAI-818). */
  readonly reviewCapped: boolean | undefined;
  /** The queue that count is, for My day's *Waiting on your review* (LAI-796). */
  readonly reviewQueue: readonly ReviewQueueItem[] | undefined;
  /** Re-read that count — the Review screen calls it after a decision. */
  readonly refreshReview: () => void;
  /**
   * The signed-in person's open token alerts (LAI-773) — budgets crossed on
   * their work, and a runaway agent — for the rail's badge on Usage and the
   * Usage page's banner: one list from one request. `undefined` until read.
   */
  readonly tokenAlerts: readonly TokenAlert[] | undefined;
  /** Re-read them — the Usage page calls it after a dismiss. */
  readonly refreshTokenAlerts: () => void;
  /**
   * The person's hand-off counts by view (LAI-1009, LAI-550), live and
   * unexpired only, for the Inbox badge and its Hand-offs tab; `undefined`
   * until read.
   */
  readonly handoffCounts: PersonInboxCounts | undefined;
  /** Re-read them — the Hand-offs tab calls it after an approve or a withdraw. */
  readonly refreshHandoffs: () => void;
  /**
   * The instance the browser is pointed at, read from the location — the
   * prototype's `laika.kvelld.internal` is a fixture and this is correct for
   * every deployment without configuration.
   */
  readonly host: string;
}

const ShellContext = createContext<ShellValue | undefined>(undefined);

export const ShellProviderContext = ShellContext;

/**
 * Read the shell.
 *
 * Throws rather than handing back a default: a screen rendered outside the
 * provider would otherwise get `undefined` session and quietly render its
 * signed-out state, which is a bug that looks like a design.
 */
export function useShell(): ShellValue {
  const value = useContext(ShellContext);
  if (value === undefined) {
    throw new Error('useShell was called outside the shell provider');
  }
  return value;
}
