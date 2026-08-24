/**
 * Work-in-progress limits per board column.
 *
 * **No API.** There is no board-column entity at all — columns are the fixed
 * `status` enum, and nothing anywhere stores a limit. `grep -i wip server/src`
 * returns nothing.
 *
 * Replace with: per-column limits, once columns are a thing that can hold
 * configuration.
 *
 * The design shows a limit only on In progress (`WIP 3/4`), amber when over.
 */

export const DEMO_WIP_LIMIT = 4;

/** Which column carries a limit in the design. */
export function demoWipLimit(column: string): number | undefined {
  // D-032: demo data must be incapable of reaching a production build. Vite
  // substitutes this literally, so everything below is dead code in prod and the
  // minifier removes the fixtures with it. `demo-not-in-bundle.test.ts` greps
  // the built bundle and fails if any of it survives.
  if (import.meta.env.PROD) return undefined;

  return column === 'in_progress' ? DEMO_WIP_LIMIT : undefined;
}
