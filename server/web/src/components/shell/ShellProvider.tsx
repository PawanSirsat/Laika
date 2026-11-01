import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useRoute } from '../../routes/use-route.ts';
import { useSession } from '../../api/use-session.ts';
import { useSetupStatus } from '../../api/use-setup-status.ts';
import { useShellContext } from '../../api/use-shell-context.ts';
import { useUnlistedCount } from '../../api/use-unlisted-count.ts';
import { useHandoffCounts } from '../../api/use-handoff-counts.ts';
import { useReviewCount } from '../../api/use-review-count.ts';
import { useTokenAlerts } from '../../api/token-alerts.ts';
import { showsAppNav } from '../shell-chrome.ts';
import { ShellProviderContext, type ShellValue } from './shell-context.ts';
import { useGates } from '../../api/permissions.ts';

/**
 * Whether this instance still has no owner. `undefined` until `/setup/status`
 * answers.
 *
 * Deliberately **not** part of `ShellValue`: it is the gate's input, not a
 * screen's business, and `SessionGate` is the only thing that acts on it.
 */
const SetupRequiredContext = createContext<boolean | undefined>(undefined);

export function useSetupRequired(): boolean | undefined {
  return useContext(SetupRequiredContext);
}

export interface ShellProviderProps {
  readonly children: ReactNode;
}

/**
 * The one place the shell's live state is read (LAI-250).
 *
 * Every hook in here is called **exactly once** for the whole app. That is the
 * point of the file: `useRoute` and `useSetupStatus` both hold state or fetch,
 * so a second caller means a desynced URL or a second request.
 */
export function ShellProvider({ children }: ShellProviderProps) {
  const route = useRoute();
  const { session, signIn, signOut, retry } = useSession();
  const { setupRequired, system, markComplete, recheck } = useSetupStatus();
  const [signingOut, setSigningOut] = useState(false);

  const signedIn = showsAppNav(session);
  const projectSlug = route.params.get('project') ?? undefined;
  const { version, sprintCount, orgName, spaceName, spaceId } = useShellContext(
    projectSlug,
    signedIn,
  );

  const { navigate } = route;
  const handleSignOut = useCallback(() => {
    setSigningOut(true);
    void signOut().finally(() => {
      setSigningOut(false);
      navigate('/login');
    });
  }, [signOut, navigate]);

  const me = session.status === 'authenticated' ? session.user : undefined;
  // The store is keyed to the user by `setStoreUser`, which the session calls
  // before it publishes `me` — so this never reads the last person's answer.
  const gates = useGates(me !== undefined);
  const { open: unlistedOpen, refresh: refreshUnlisted } = useUnlistedCount(
    me !== undefined && gates.org('audit_log.export'),
  );
  const {
    waiting: reviewWaiting,
    capped: reviewCapped,
    queue: reviewQueue,
    refresh: refreshReview,
  } = useReviewCount(me !== undefined);
  // Every signed-in person may read their own (a web session; LAI-773).
  const { alerts: tokenAlerts, refresh: refreshTokenAlerts } = useTokenAlerts(me !== undefined);
  // Every signed-in person may read their own hand-offs (LAI-1009).
  const { counts: handoffCounts, refresh: refreshHandoffs } = useHandoffCounts(me !== undefined);

  const value = useMemo<ShellValue>(
    () => ({
      route,
      session,
      me,
      signIn,
      signOut: handleSignOut,
      signingOut,
      retry,
      system,
      markComplete,
      recheck,
      version,
      sprintCount,
      orgName,
      spaceName,
      spaceId,
      unlistedOpen,
      refreshUnlisted,
      reviewWaiting,
      reviewCapped,
      reviewQueue,
      refreshReview,
      tokenAlerts,
      refreshTokenAlerts,
      handoffCounts,
      refreshHandoffs,
      host: window.location.host,
    }),
    [
      route,
      session,
      me,
      signIn,
      handleSignOut,
      signingOut,
      retry,
      system,
      markComplete,
      recheck,
      version,
      sprintCount,
      orgName,
      spaceName,
      spaceId,
      unlistedOpen,
      refreshUnlisted,
      reviewWaiting,
      reviewCapped,
      reviewQueue,
      refreshReview,
      tokenAlerts,
      refreshTokenAlerts,
      handoffCounts,
      refreshHandoffs,
    ],
  );

  return (
    <ShellProviderContext.Provider value={value}>
      <SetupRequiredContext.Provider value={setupRequired}>
        {children}
      </SetupRequiredContext.Provider>
    </ShellProviderContext.Provider>
  );
}
