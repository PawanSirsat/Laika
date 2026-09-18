import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useRoute } from '../../routes/use-route.ts';
import { useSession } from '../../api/use-session.ts';
import { useSetupStatus } from '../../api/use-setup-status.ts';
import { useShellContext } from '../../api/use-shell-context.ts';
import { showsAppNav } from '../shell-chrome.ts';
import { ShellProviderContext, type ShellValue } from './shell-context.ts';

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
  const { version, sprintCount, orgName } = useShellContext(projectSlug, signedIn);

  const { navigate } = route;
  const handleSignOut = useCallback(() => {
    setSigningOut(true);
    void signOut().finally(() => {
      setSigningOut(false);
      navigate('/login');
    });
  }, [signOut, navigate]);

  const me = session.status === 'authenticated' ? session.user : undefined;

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
