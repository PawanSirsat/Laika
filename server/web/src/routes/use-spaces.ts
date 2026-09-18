import { useCallback, useEffect, useState } from 'react';
import { isTombstone, listProjects, type Project } from '../api/projects.ts';
import { promote, readRecent, recentSpaces, toSpace, writeRecent, type Space } from './spaces.ts';

/**
 * The sidebar's spaces (LAI-248).
 *
 * **Gated on `enabled`, which is the session.** `listProjects` needs one, and
 * the shell renders on `/login` and first boot too — firing there produces a
 * `401` on every sign-in page load, the same trap `useShellContext` documents
 * for the sprint count.
 *
 * One page is deliberate. The sidebar shows three spaces; walking the cursor to
 * build a list that gets sliced to three is work nobody sees. *More spaces*
 * goes to the Projects screen, which paginates properly.
 */
export function useSpaces(
  enabled: boolean,
  current?: string,
): {
  readonly spaces: readonly Space[];
  /** Every fetched space, for the More-spaces popover (LAI-249). One page — see above. */
  readonly all: readonly Space[];
  readonly open: (slug: string) => void;
} {
  const [projects, setProjects] = useState<readonly Project[]>([]);
  const [recent, setRecent] = useState<readonly string[]>(() =>
    typeof localStorage === 'undefined' ? [] : readRecent(localStorage),
  );

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();

    listProjects({ limit: 20 }, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return;
        // A deleted project arrives as a tombstone, which has no name to show.
        setProjects(page.data.filter((row): row is Project => !isTombstone(row)));
      })
      .catch(() => {
        // The sidebar's spaces are not worth an error state: the section is
        // absent and every other way of reaching a project still works.
      });

    return () => {
      controller.abort();
    };
  }, [enabled]);

  const open = useCallback((slug: string) => {
    // The write happens here, in the handler, not inside the updater. An
    // updater must be pure (React's rule), and the first version's write-on-
    // flush lost the order to any navigation that outran the flush — a reload
    // straight after the click read back nothing. Storage is the durable copy
    // and every write goes through this handler, so reading it back is reading
    // the same order the state holds.
    const next = promote(typeof localStorage === 'undefined' ? [] : readRecent(localStorage), slug);
    if (typeof localStorage !== 'undefined') writeRecent(localStorage, next);
    setRecent(next);
  }, []);

  return { spaces: recentSpaces(projects, recent, current), all: projects.map(toSpace), open };
}
