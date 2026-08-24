import type { SessionState } from '../api/use-session.ts';

/** A session that has a user on it. */
export type AuthenticatedSession = Extract<SessionState, { readonly status: 'authenticated' }>;

/**
 * Does this session get the application chrome — sidebar, nav toggle, user menu?
 *
 * A one-line rule in its own module so it can be tested for a **signed-out**
 * session (LAI-062 AC2). The bug it replaces was invisible to anything holding a
 * session: `/login`, `/setup` and `/invite` each rendered eight protected
 * destinations beside the words "Not signed in", and every one bounced straight
 * back to `/login`.
 *
 * **Keyed on the session, never on the route.** A route list has to be kept in
 * step by hand, so the next pre-auth screen inherits whichever default it
 * happens to get — which is how this happened. Asking the session instead fails
 * safe in both directions: a new pre-auth screen has no nav without anyone
 * remembering to exclude it, and a protected screen shows no nav until there is
 * genuinely someone to navigate as.
 *
 * `loading` and `error` deliberately get no chrome either. Navigation offered
 * before the session resolves is navigation that may be about to bounce.
 *
 * A type predicate rather than a plain boolean so the single call site still
 * narrows: the user menu needs `session.user`, and a second
 * `status === 'authenticated'` test beside this one would be a second rule to
 * keep in step.
 */
export function showsAppNav(session: SessionState): session is AuthenticatedSession {
  return session.status === 'authenticated';
}
