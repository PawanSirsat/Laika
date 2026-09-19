import { Spinner } from '../Spinner.tsx';
import { useEffect, useState, type ReactNode } from 'react';
import { ApiErrorState } from '../ApiErrorState.tsx';
import { EmptyState } from '../EmptyState.tsx';
import { LoadingState } from '../LoadingState.tsx';
import { isPublic } from '../../routes/route-table.ts';
import { useShell } from './shell-context.ts';
import { useSetupRequired } from './ShellProvider.tsx';

export interface SessionGateProps {
  readonly children: ReactNode;
}

/**
 * Who may see a screen, and what shows while that is being decided (LAI-250).
 *
 * Lifted out of `AppShell` unchanged: the three redirect effects and the four
 * gate states are the same code in the same order, because this is a move and
 * not a redesign. What changed is that they are no longer interleaved with
 * sixteen route branches and three submit handlers.
 */
export function SessionGate({ children }: SessionGateProps) {
  const {
    route: { path, route, navigate },
    session,
    retry,
  } = useShell();
  const setupRequired = useSetupRequired();

  /**
   * Where to return after signing in (LAI-007 AC4). Captured when the guard
   * redirects, so a deep link survives the detour instead of dumping the user
   * on the board.
   */
  const [returnTo, setReturnTo] = useState<string | undefined>(undefined);

  const routeIsPublic = isPublic(route) || route === undefined;

  // Before anything else: an instance with no owner has exactly one useful
  // screen. The server redirects browsers here too (setup-gate.ts SETUP_PATH),
  // so this only covers in-app navigation.
  useEffect(() => {
    // `setupRequired` comes from `/setup/status` at mount. `session` carries the
    // same news from a **live** call, which is the case that was broken: a tab
    // open since before the instance was reset has a stale `false` here, and
    // only the 409 on `/me` knows better (LAI-087).
    const needsSetup = setupRequired === true || session.status === 'setup-required';
    if (!needsSetup || path === '/setup') return;
    navigate('/setup');
  }, [setupRequired, session.status, path, navigate]);

  // The guard. One effect, one condition: an unauthenticated user on a
  // protected route goes to sign-in exactly once — `path !== '/login'` is what
  // stops it competing with itself on the way there.
  useEffect(() => {
    if (session.status !== 'anonymous') return;
    if (setupRequired === true) return; // setup comes first
    if (routeIsPublic || path === '/login') return;
    // Pathname **and** query. Capturing only the path drops the parameter that
    // says which project — `/members?project=laika-core` came back as
    // `/members`, which renders "no project chosen" after a correct sign-in.
    setReturnTo(path + window.location.search);
    navigate('/login');
  }, [session.status, setupRequired, routeIsPublic, path, navigate]);

  // Signed in and sitting on the sign-in screen: go where they were headed.
  useEffect(() => {
    if (session.status !== 'authenticated' || path !== '/login') return;
    const destination = returnTo ?? '/board';
    setReturnTo(undefined);
    navigate(destination);
  }, [session.status, path, returnTo, navigate]);

  /*
   * Protected routes wait for the session rather than rendering and hoping.
   * AC7: a failed /me shows LAI-020's error state with its request_id and a
   * retry, never a blank page.
   */
  if (!routeIsPublic && session.status === 'loading') {
    return (
      <div className="shell-gate">
        {/*
          **A spinner, not a skeleton** (LAI-607). This rendered two card
          placeholders, which the board's own skeleton replaced with a
          different shape a moment later — two loading treatments in a row for
          one wait, and the first one promising a layout that never arrived.

          A skeleton is a promise about what is coming. This gate does not know
          what is coming — any route can be behind it — so it has nothing to
          promise and says only that it is working.
        */}
        <p className="shell-gate-note" role="status">
          <Spinner size="sm" /> Loading your account
        </p>
      </div>
    );
  }

  if (!routeIsPublic && session.status === 'error') {
    return (
      <div className="shell-gate">
        {/* Mapped rather than hardcoded, so a 403 here renders permission-denied
            and not a generic failure (AC6). */}
        <ApiErrorState error={session.error} resource="your account" onRetry={retry} />
      </div>
    );
  }

  if (!routeIsPublic && session.status === 'setup-required') {
    // The redirect above is already running; this is the frame before it lands,
    // and it must not be a skeleton.
    return (
      <div className="shell-gate">
        <EmptyState
          headline="This instance has not been set up yet"
          body="Taking you to first boot."
        />
      </div>
    );
  }

  if (!routeIsPublic && session.status === 'anonymous') {
    // The guard above is already navigating to /login; rendering the screen's
    // skeleton for that frame avoids a flash of the board.
    return (
      <div className="shell-gate">
        <LoadingState shape="card" count={1} label="Redirecting to sign in" />
      </div>
    );
  }

  return <>{children}</>;
}
