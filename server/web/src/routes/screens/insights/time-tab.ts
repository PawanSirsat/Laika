import type { Permissions } from '../../../api/permissions.ts';

/**
 * Who Insights → Time is for (D-130, D-136; LAI-1138): owners and holders of
 * *See everyone's analytics* read the organisation's report
 * (`time.report.read`), and a space admin reads their spaces' weeks (§3.2
 * `time.report.read_project`). Everybody else is not offered the tab, and an
 * address naming it shows the not-allowed state.
 */

/** The org action the tab is gated on, as `PageTab.requires` names it. */
export const TIME_REPORT_READ = 'time.report.read';

/** The §3.2 action a space admin holds on each space they lead. */
export const TIME_REPORT_READ_PROJECT = 'time.report.read_project';

/** The spaces this reader leads, by id — empty before the server answers. */
export function ledProjectIds(permissions: Permissions | undefined): readonly string[] {
  return (permissions?.me.projects ?? [])
    .filter((p) => p.actions.includes(TIME_REPORT_READ_PROJECT))
    .map((p) => p.project_id);
}

/**
 * The tab gate as `visibleTabs` asks it: `time.report.read` is held by the
 * org grant **or** by leading any space; every other permission is the
 * reader's own answer, unchanged.
 */
export function insightsHolder(
  holds: (permission: string) => boolean,
  leads: readonly string[],
): (permission: string) => boolean {
  return (permission) =>
    permission === TIME_REPORT_READ ? holds(permission) || leads.length > 0 : holds(permission);
}

/** Which Time report a reader gets: the organisation's, a space admin's weeks, or none. */
export function timeView(
  holds: (permission: string) => boolean,
  leads: readonly string[],
): 'org' | 'space' | 'none' {
  if (holds(TIME_REPORT_READ)) return 'org';
  return leads.length > 0 ? 'space' : 'none';
}
