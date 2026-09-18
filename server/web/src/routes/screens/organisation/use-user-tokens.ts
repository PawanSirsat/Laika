import { useCallback, useEffect, useState } from 'react';
import { listUserTokens, type TokenView } from '../../../api/tokens.ts';

export type UserTokensState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: unknown }
  | { readonly status: 'ready'; readonly tokens: readonly TokenView[] };

/**
 * One person's tokens, fetched when their panel is opened (LAI-238).
 *
 * **Not fetched with the directory.** A page of users is `n` extra requests if
 * every row loads eagerly, and on a screen whose main job is the member list
 * that is a lot of work for a panel most visits never open. `userId` being
 * `undefined` is the closed state and issues no request at all.
 *
 * The abort matters more here than usual: this fires on every open, and a person
 * clicking through three rows in a second would otherwise have three responses
 * racing to fill one panel.
 */
export function useUserTokens(userId: string | undefined): {
  readonly state: UserTokensState | undefined;
  readonly reload: () => void;
} {
  const [state, setState] = useState<UserTokensState | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);

  const reload = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    if (userId === undefined) {
      setState(undefined);
      return;
    }

    const controller = new AbortController();
    setState({ status: 'loading' });

    listUserTokens(userId, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return;
        setState({ status: 'ready', tokens: page.data });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: 'error', error });
      });

    return () => {
      controller.abort();
    };
  }, [userId, attempt]);

  return { state, reload };
}
