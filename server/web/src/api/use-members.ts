import { useCallback, useEffect, useState } from 'react';
import {
  changeMemberRole,
  listMembers,
  removeMember,
  type Member,
  type ProjectRole,
} from './members.ts';

export interface UseMembers {
  readonly status: 'loading' | 'ready' | 'error';
  readonly members: readonly Member[];
  readonly error: unknown;
  /** The user id currently being changed, so one row can show it is busy. */
  readonly pendingId: string | undefined;
  /** The server's reason for refusing the last change. */
  readonly actionError: unknown;
  readonly setRole: (userId: string, role: ProjectRole) => Promise<void>;
  readonly remove: (userId: string) => Promise<void>;
  readonly reload: () => void;
}

export function useMembers(slug: string | undefined): UseMembers {
  const [status, setStatus] = useState<UseMembers['status']>('loading');
  const [members, setMembers] = useState<readonly Member[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [pendingId, setPendingId] = useState<string | undefined>(undefined);
  const [actionError, setActionError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (slug === undefined) return;

    const controller = new AbortController();
    setStatus('loading');

    listMembers(slug, controller.signal)
      .then((list) => {
        setMembers(list.members);
        setStatus('ready');
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError(cause);
        setStatus('error');
      });

    return () => {
      controller.abort();
    };
  }, [slug, attempt]);

  /**
   * Both mutations take the server's returned list verbatim.
   *
   * Not a refetch and not a local patch: the response *is* the new list, so
   * using it is both fewer round trips and the only version guaranteed to match
   * what the server thinks.
   */
  const run = useCallback(
    async (userId: string, call: () => Promise<{ members: readonly Member[] }>): Promise<void> => {
      setPendingId(userId);
      setActionError(null);
      try {
        const list = await call();
        setMembers(list.members);
      } catch (cause) {
        setActionError(cause);
      } finally {
        setPendingId(undefined);
      }
    },
    [],
  );

  const setRole = useCallback(
    (userId: string, role: ProjectRole): Promise<void> => {
      if (slug === undefined) return Promise.resolve();
      return run(userId, () => changeMemberRole(slug, userId, role));
    },
    [slug, run],
  );

  const remove = useCallback(
    (userId: string): Promise<void> => {
      if (slug === undefined) return Promise.resolve();
      return run(userId, () => removeMember(slug, userId));
    },
    [slug, run],
  );

  const reload = useCallback((): void => {
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  return { status, members, error, pendingId, actionError, setRole, remove, reload };
}
