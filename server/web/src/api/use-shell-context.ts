import { useEffect, useState } from 'react';
import { getHealth } from './health.ts';
import { countSprints } from './sprints.ts';

export interface ShellContext {
  /** Laika's own version, from `/health`. `undefined` until it answers. */
  readonly version: string | undefined;
  /** Sprints in the active project, or `undefined` when there is no number. */
  readonly sprintCount: number | undefined;
}

/**
 * The real data behind the sidebar's identity block and nav counts (LAI-064).
 *
 * Everything here is `undefined` until the API says otherwise, and the sidebar
 * renders nothing for an `undefined`. That is the whole design: the prototype's
 * `v0.4` and `Sprints 4` are fixtures, and a placeholder that looks like data is
 * worse than an absence (CLAUDE.md §5.1).
 *
 * The sprint count is scoped to the active project because sprints are — there
 * is no org-wide sprint list. With no `?project=` there is no count, so the
 * badge is absent rather than zero.
 *
 * `enabled` is the session, and it gates **only the sprint count**. That call
 * needs a session, so a signed-out `/login` carrying `?project=` used to fire a
 * request that could only 401 — console noise for a badge inside a sidebar that
 * is not rendered.
 *
 * `/health` is public and stays ungated: first boot has no session by
 * definition, and it is the screen that most wants to say which version it is
 * about to install (LAI-075).
 */
export function useShellContext(slug: string | undefined, enabled: boolean): ShellContext {
  const [version, setVersion] = useState<string | undefined>(undefined);
  const [sprintCount, setSprintCount] = useState<number | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();

    getHealth(controller.signal)
      .then((health) => {
        setVersion(health.version);
      })
      .catch(() => {
        // A missing version costs a subtitle, not a screen. Nothing to report.
      });

    return () => {
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (slug === undefined || !enabled) {
      setSprintCount(undefined);
      return;
    }

    const controller = new AbortController();

    countSprints(slug, controller.signal)
      .then(setSprintCount)
      .catch(() => {
        // Same: no badge beats a wrong badge.
        setSprintCount(undefined);
      });

    return () => {
      controller.abort();
    };
  }, [slug, enabled]);

  return { version, sprintCount };
}
