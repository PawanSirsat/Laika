import { isProject } from './projects.ts';
import type { Project, ProjectRow } from './projects.ts';

/**
 * Which project a screen shows when the URL does not say (LAI-423).
 *
 * Four screens each had their own copy of `live[0]`, and `GET /projects` returns
 * **alphabetically** — so the fallback was whichever project sorts first, with
 * no relationship to the person, their work, or what they were just reading.
 * Measured: `['atlas', 'laika-core', 'pathfinder']`, so everyone landed on
 * `atlas`, which had two tasks and no sprints.
 *
 * ## The rule, and why this one
 *
 * **The most recently active project.** `last_activity_at` is already on every
 * `ProjectView`, so it costs no request, and it answers the question the reader
 * is actually asking — *where is work happening?* — rather than a question
 * nobody asked, which is *what sorts first?*
 *
 * It is not "most recently opened by you": that needs storage, and
 * `ProjectsScreen.tsx` records the decision that the selection lives in the URL
 * rather than in an ambient store. A fallback kept in `localStorage` would be
 * that ambient selection under another name, and would make two browsers
 * disagree about what a bare `/board` means.
 *
 * **One rule, one place.** Board and Sprints disagreed before this — Board did
 * not even filter tombstones — and a fallback that differs per screen means
 * navigating between them moves you silently, which is the defect itself.
 */

/**
 * A project never touched sorts last, not first.
 *
 * `last_activity_at` is `null` for a project nothing has happened in, and `null`
 * must not win a "most recent" comparison by accident — that would hand the
 * reader the emptiest project, which is exactly the symptom being fixed.
 */
function activityOf(project: Project): number {
  return project.last_activity_at ?? Number.NEGATIVE_INFINITY;
}

/**
 * Resolve the project to show.
 *
 * `wantedSlug` wins whenever it names a project that exists — the URL is the
 * authority, and a stale or mistyped slug falls through to the same rule as no
 * slug at all rather than erroring, because a person following an old link is
 * better served by a working board than by a dead end.
 */
export function pickProject(
  projects: readonly ProjectRow[],
  wantedSlug: string | undefined,
): Project | undefined {
  // `isProject`, not `!isTombstone`: a negated guard does not narrow, and a
  // tombstone carries no slug at all.
  const live = projects.filter(isProject);

  if (wantedSlug !== undefined && wantedSlug !== '') {
    const wanted = live.find((p) => p.slug === wantedSlug);
    if (wanted !== undefined) return wanted;
  }

  // `reduce`, not `sort`: the input is not ours to reorder, and a copy just to
  // read one element off the front is a copy.
  return live.reduce<Project | undefined>(
    (best, p) => (best === undefined || activityOf(p) > activityOf(best) ? p : best),
    undefined,
  );
}
