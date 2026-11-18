import { useEffect, useMemo, useSyncExternalStore } from 'react';
import {
  directoryEntryOf,
  directoryVersion,
  loadDirectory,
  type PersonDirectory,
  reportsOf,
  subscribeDirectory,
} from './people-directory.ts';

/**
 * One person's directory entry (D-161, LAI-1330) — title, department,
 * manager, photo version — from the one map every avatar reads, and the
 * session's read of it started the first time anything asks. `undefined`
 * for no one, or for someone the sync has not read.
 */
export function usePersonDirectory(userId: string | undefined): PersonDirectory | undefined {
  useEffect(() => {
    void loadDirectory();
  }, []);
  return useSyncExternalStore(subscribeDirectory, () =>
    userId === undefined ? undefined : directoryEntryOf(userId),
  );
}

const NOBODY: ReadonlySet<string> = new Set();

/** The people whose manager is `userId` — the "My team" filter's — kept until the directory moves. */
export function useReportsOf(userId: string | undefined): ReadonlySet<string> {
  useEffect(() => {
    void loadDirectory();
  }, []);
  const at = useSyncExternalStore(subscribeDirectory, directoryVersion);
  return useMemo(
    () => (userId === undefined ? NOBODY : reportsOf(userId)),
    // `at` is the directory's version: the set is read again when it moves.
    [userId, at],
  );
}
