import { useCallback, useEffect, useState } from 'react';
import {
  addMember,
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
  /** Resolves `true` only when the server accepted, so the form can close. */
  readonly add: (userId: string, role: ProjectRole) => Promise<boolean>;
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
   * Every mutation takes the server's returned list verbatim.
   *
   * Not a refetch and not a local patch: the response *is* the new list, so
   * using it is both fewer round trips and the only version guaranteed to match
   * what the server thinks.
   */
  const run = useCallback(
    async (
      userId: string,
      call: () => Promise<{ members: readonly Member[] }>,
    ): Promise<boolean> => {
      setPendingId(userId);
      setActionError(null);
      try {
        const list = await call();
        setMembers(list.members);
        return true;
      } catch (cause) {
        setActionError(cause);
        return false;
      } finally {
        setPendingId(undefined);
      }
    },
    [],
  );

  const setRole = useCallback(
    async (userId: string, role: ProjectRole): Promise<void> => {
      if (slug === undefined) return;
      await run(userId, () => changeMemberRole(slug, userId, role));
    },
    [slug, run],
  );

  const remove = useCallback(
    async (userId: string): Promise<void> => {
      if (slug === undefined) return;
      await run(userId, () => removeMember(slug, userId));
    },
    [slug, run],
  );

  /**
   * Reports whether the server accepted, so the caller can keep the form open
   * on a refusal with the choice still in it. Closing on failure would discard
   * the person's selection and leave only an error to read.
   */
  const add = useCallback(
    (userId: string, role: ProjectRole): Promise<boolean> => {
      if (slug === undefined) return Promise.resolve(false);
      return run(userId, () => addMember(slug, userId, role));
    },
    [slug, run],
  );

  const reload = useCallback((): void => {
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  return { status, members, error, pendingId, actionError, setRole, remove, add, reload };
}
