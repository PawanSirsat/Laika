import { ROUTES } from './route-table.ts';

/**
 * Nav links that keep the project you are looking at (LAI-423).
 *
 * `Sidebar` rendered `href={route.path}` — a bare path — so every nav click
 * dropped `?project=`. The screens then fell back to the alphabetically-first
 * project, which meant clicking "Sprints" while reading `laika-core` landed you
 * on `atlas` and told you it had no sprints. It did not. You were not there any
 * more.
 *
 * ## Why the query string and not something ambient
 *
 * `ProjectsScreen.tsx` records the decision that the selection lives in the URL
 * "rather than storing an ambient selection", and that is right: a link someone
 * pastes to a colleague has to open the same board. So the fix carries the
 * param rather than replacing the mechanism with component state or storage.
 *
 * ## Why this returns an `href` rather than patching the click
 *
 * `Sidebar` deliberately uses a real `<a href>` so middle-click, copy-link and
 * the browser's own focus handling come free. A click handler that appended the
 * param afterwards would fix the left-click and quietly break the other two —
 * the URL you copied would not be the one you were on.
 */

/** `?project=` — the one place the parameter's name is written for the nav. */
const PROJECT_PARAM = 'project';

/**
 * Is this destination about a project?
 *
 * **Carrying the project is the default and the exceptions are marked**, the
 * same way `Route.public` inverts. Forgetting to mark a new route then means it
 * keeps your context, which is harmless when the screen ignores the param —
 * while the opposite default silently loses it, which is this whole defect.
 */
function carriesProject(path: string): boolean {
  return ROUTES.find((r) => r.path === path)?.orgLevel !== true;
}

/**
 * The `href` for a nav entry, carrying the current project where it applies.
 *
 * Returns the bare path when there is no project yet, when the destination is
 * org-level, or when the route is unknown — never a dangling `?project=`.
 */
export function navHref(path: string, projectSlug: string | undefined): string {
  if (projectSlug === undefined || projectSlug === '') return path;
  if (!carriesProject(path)) return path;

  const params = new URLSearchParams({ [PROJECT_PARAM]: projectSlug });
  return `${path}?${params.toString()}`;
}

/**
 * The same path with the project written into it, preserving any other params.
 *
 * Used when a screen resolves a project it was not given: SPEC's rule here is
 * that the address bar must match what is on screen, so a resolved fallback is
 * put **into the URL** rather than held in state where the two can disagree.
 */
export function withProjectParam(search: string, projectSlug: string): string {
  const params = new URLSearchParams(search);
  params.set(PROJECT_PARAM, projectSlug);
  return params.toString();
}
