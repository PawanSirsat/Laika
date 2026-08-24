import { useCallback, useEffect, useRef, useState } from 'react';
import { setSetupRequiredHandler, setUnauthorizedHandler } from './client.ts';
import { getMe } from './me.ts';
import { sessionFromFailure, SESSION_TIMEOUT_MS, type SessionState } from './session-state.ts';
import { signIn as apiSignIn, signOut as apiSignOut, type Credentials } from './auth.ts';

export type { SessionState };

export interface UseSession {
  readonly session: SessionState;
  readonly signIn: (credentials: Credentials) => Promise<void>;
  readonly signOut: () => Promise<void>;
  readonly retry: () => void;
}

export function useSession(): UseSession {
  const [session, setSession] = useState<SessionState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  /**
   * Guards against a redirect loop.
   *
   * `/me` answers 401 when nobody is signed in, which is the normal first load,
   * not an error. Without this the 401 handler would fire on that very first
   * probe and try to "clear the session and redirect" forever.
   */
  const probing = useRef(false);

  const load = useCallback(async (signal: AbortSignal): Promise<void> => {
    probing.current = true;
    try {
      const user = await getMe(signal);
      setSession({ status: 'authenticated', user });
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;

      setSession(sessionFromFailure(cause));
    } finally {
      probing.current = false;
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => {
      controller.abort();
    };
  }, [load, attempt]);

  /**
   * The ceiling.
   *
   * `load` resolves for every *answer*, including bad ones — but a request that
   * never settles leaves the app on a skeleton indefinitely, which is what the
   * owner saw. Abort the probe and render a failure instead: an error someone
   * can act on beats a spinner that will never stop.
   */
  useEffect(() => {
    if (session.status !== 'loading') return;

    const timer = setTimeout(() => {
      setSession((current) =>
        current.status === 'loading'
          ? {
              status: 'error',
              error: new Error('The instance did not answer. It may be restarting or unreachable.'),
            }
          : current,
      );
    }, SESSION_TIMEOUT_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [session.status, attempt]);

  /**
   * A `401` from any *other* call means the session ended underneath us — it
   * expired, or it was revoked. Drop to anonymous **once**; the shell's route
   * guard does the redirecting, so this never competes with it.
   */
  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (probing.current) return;
      setSession((current) => (current.status === 'anonymous' ? current : { status: 'anonymous' }));
    });
    return () => {
      setUnauthorizedHandler(undefined);
    };
  }, []);

  /**
   * The setup gate, from **any** call (LAI-087).
   *
   * A tab open since before the instance was reset never re-probes `/me`, so the
   * 409 only ever reaches whichever screen happened to fetch — which renders its
   * own local error while the shell carries on believing there is a session.
   * Hoisting it here means one answer for every screen: the shell redirects to
   * first boot, which is the thing that actually fixes the instance.
   */
  useEffect(() => {
    setSetupRequiredHandler(() => {
      setSession((current) =>
        current.status === 'setup-required' ? current : { status: 'setup-required' },
      );
    });
    return () => {
      setSetupRequiredHandler(undefined);
    };
  }, []);

  const signIn = useCallback(async (credentials: Credentials): Promise<void> => {
    await apiSignIn(credentials);
    // Re-read `/me` rather than trusting the sign-in response: it is the one
    // endpoint that defines the shape the rest of the app consumes, and going
    // through it means there is exactly one source of the current user.
    setSession({ status: 'loading' });
    setAttempt((n) => n + 1);
  }, []);

  const signOut = useCallback(async (): Promise<void> => {
    try {
      await apiSignOut();
    } finally {
      // Locally anonymous either way. A failed sign-out that leaves the UI
      // looking signed in is worse than one that does not reach the server.
      setSession({ status: 'anonymous' });
    }
  }, []);

  const retry = useCallback((): void => {
    setSession({ status: 'loading' });
    setAttempt((n) => n + 1);
  }, []);

  return { session, signIn, signOut, retry };
}
