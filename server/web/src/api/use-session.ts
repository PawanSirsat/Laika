import { useCallback, useEffect, useRef, useState } from 'react';
import { setUnauthorizedHandler } from './client.ts';
import { ApiError } from './errors.ts';
import { getMe, type MeProfile } from './me.ts';
import { signIn as apiSignIn, signOut as apiSignOut, type Credentials } from './auth.ts';

/**
 * Who is signed in, as the whole app sees it.
 *
 * Four states, not a boolean plus a nullable user: "still checking" and "not
 * signed in" are different, and collapsing them is what makes an app flash its
 * sign-in screen at an already-authenticated user on every reload.
 */
export type SessionState =
  | { readonly status: 'loading' }
  | { readonly status: 'authenticated'; readonly user: MeProfile }
  | { readonly status: 'anonymous' }
  /**
   * The whole error, not a flattened message: `ApiErrorState` branches on the
   * code, and a `403` must not be rendered as a generic failure (AC6).
   */
  | { readonly status: 'error'; readonly error: unknown };

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

      if (cause instanceof ApiError && cause.code === 'unauthorized') {
        setSession({ status: 'anonymous' });
        return;
      }
      setSession({ status: 'error', error: cause });
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
