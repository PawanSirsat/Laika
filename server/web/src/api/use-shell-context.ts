import { useEffect, useState } from 'react';
import { getHealth } from './health.ts';
import { countSprints } from './sprints.ts';
import { subscribeToEvents } from './event-stream.ts';

/**
 * The §4.8 types that can change a number in the sidebar.
 *
 * `project.updated` is the one that matters today: every sprint mutation is
 * recorded under it, because §4.8 has no sprint verb. The others are here so a
 * project appearing or being archived is not missed — both change what the
 * shell is describing.
 *
 * A deliberately short list. Refetching on every frame would turn one person
 * commenting into a request per comment for every open tab.
 */
export const COUNT_CHANGING: ReadonlySet<string> = new Set([
  'project.updated',
  'project.created',
  'project.archived',
]);

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
  /**
   * Bumped whenever the stream says this project changed, which re-runs the
   * count below (LAI-122).
   *
   * The badge used to be fetched once at mount and never again: delete a sprint
   * and it kept the old number until a full page reload. **A number that came
   * from the API and has since stopped being true is as wrong as a fixture, and
   * harder to spot, because it was right a moment ago.**
   */
  const [generation, setGeneration] = useState(0);

  /**
   * Refetch on the stream, not on a timer.
   *
   * Measured before choosing: creating, renaming and deleting a sprint each
   * emit **`project.updated`** — §4.8 has no sprint verb of its own and growing
   * one is LAI-113, so sprint changes ride under the project. Watching a
   * specific set of types rather than every frame keeps a busy board from
   * refetching the sidebar on every comment.
   *
   * This also fixes the case a same-tab invalidation signal cannot: the badge
   * now follows a sprint **someone else** deleted, without a reload.
   */
  useEffect(() => {
    if (slug === undefined || !enabled) return;

    return subscribeToEvents(slug, (frame) => {
      if (frame.kind === 'activity' && COUNT_CHANGING.has(frame.type)) {
        setGeneration((n) => n + 1);
      }
    });
  }, [slug, enabled]);

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
  }, [slug, enabled, generation]);

  return { version, sprintCount };
}
