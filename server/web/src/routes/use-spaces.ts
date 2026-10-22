import { everyPage } from '../api/every-page.ts';
import { useCallback, useEffect, useState } from 'react';
import { isTombstone, listProjects, type Project } from '../api/projects.ts';
import {
  promote,
  readPins,
  readRecent,
  sidebarSpaces,
  togglePin,
  toSpace,
  writePins,
  writeRecent,
  type SidebarSpace,
  type Space,
} from './spaces.ts';

/**
 * The sidebar's spaces (LAI-248).
 *
 * **Gated on `enabled`, which is the session.** `listProjects` needs one, and
 * the shell renders on `/login` and first boot too — firing there produces a
 * `401` on every sign-in page load, the same trap `useShellContext` documents
 * for the sprint count.
 *
 * **Every page** (LAI-703). This read one page of 20 on the grounds that the
 * sidebar shows three — but `all` feeds the More-spaces popover, which then
 * listed twenty spaces of however many as if that were all of them. Projects
 * are few and a page is 200, so reading to the end costs one request in
 * practice and makes the popover's list true.
 */
export function useSpaces(
  enabled: boolean,
  current?: string,
): {
  /** The pinned spaces, then the recent ones (LAI-989). */
  readonly spaces: readonly SidebarSpace[];
  /** Every space, for the More-spaces popover (LAI-249). */
  readonly all: readonly Space[];
  readonly open: (slug: string) => void;
  /** Pin a space, or unpin it — kept in this browser. */
  readonly togglePin: (slug: string) => void;
} {
  const [projects, setProjects] = useState<readonly Project[]>([]);
  const [recent, setRecent] = useState<readonly string[]>(() =>
    typeof localStorage === 'undefined' ? [] : readRecent(localStorage),
  );
  const [pins, setPins] = useState<readonly string[]>(() =>
    typeof localStorage === 'undefined' ? [] : readPins(localStorage),
  );

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();

    everyPage((cursor) =>
      listProjects(
        cursor === undefined ? { limit: 200 } : { limit: 200, cursor },
        controller.signal,
      ),
    )
      .then(({ items }) => {
        // Every page, not the first (LAI-703); `page.data` is the whole list.
        const page = { data: items };
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

  // Written in the handler, as `open` writes the recent list, and read back
  // from storage so two quick toggles never work from a stale copy.
  const pin = useCallback((slug: string) => {
    const next = togglePin(typeof localStorage === 'undefined' ? [] : readPins(localStorage), slug);
    if (typeof localStorage !== 'undefined') writePins(localStorage, next);
    setPins(next);
  }, []);

  return {
    spaces: sidebarSpaces(projects, recent, pins, current),
    all: projects.map(toSpace),
    open,
    togglePin: pin,
  };
}
