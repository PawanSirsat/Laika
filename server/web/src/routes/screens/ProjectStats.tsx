import { LockIcon } from '../../components/LockIcon.tsx';
import { avatarColor } from '../../theme/avatar-color.ts';
import type { Project } from '../../api/projects.ts';
import type { Theme } from '../../theme/theme.ts';

export interface ProjectStatsProps {
  readonly project: Project;
  readonly theme: Theme;
}

/** Everything except cancelled — a cancelled task is not outstanding work. */
function totalOf(project: Project): number {
  const c = project.task_counts;
  return c.backlog + c.todo + c.in_progress + c.review + c.done;
}

function initials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((p) => p !== '');
  const first = parts[0]?.[0] ?? '?';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** `4m ago`, `3d ago` — short, because it sits in a corner. */
function ago(at: number, now: number): string {
  const d = Math.max(0, now - at);
  if (d < MINUTE) return 'just now';
  if (d < HOUR) return `${String(Math.floor(d / MINUTE))}m ago`;
  if (d < DAY) return `${String(Math.floor(d / HOUR))}h ago`;
  return `${String(Math.floor(d / DAY))}d ago`;
}

/** How many faces fit before the card looks crowded. */
const FACES = 4;

/**
 * The card's progress bar, counts and people (LAI-046).
 *
 * Every number here is **served**, not derived: `task_counts`, `blocked_count`
 * and `last_activity_at` arrive with the project list in LAI-053's grouped
 * queries, so a page of projects is one request rather than one per card.
 *
 * `blocked_count` counts **tasks, not dependency edges** — a task blocked by
 * three things is one blocked task. Recomputing it here from anything else
 * would quietly disagree with the server.
 */
export function ProjectStats({ project, theme }: ProjectStatsProps) {
  const counts = project.task_counts;
  const total = totalOf(project);
  const now = Date.now();

  const pct = (n: number): string => (total === 0 ? '0%' : `${String((n / total) * 100)}%`);
  const shown = project.members.slice(0, FACES);
  const overflow = project.member_count - shown.length;

  return (
    <>
      {total > 0 && (
        <div className="project-progress">
          <span className="project-bar" aria-hidden="true">
            <span className="project-bar-done" style={{ width: pct(counts.done) }} />
            <span className="project-bar-review" style={{ width: pct(counts.review) }} />
            <span className="project-bar-active" style={{ width: pct(counts.in_progress) }} />
          </span>

          <p className="project-counts">
            <span className="project-count-main">
              {counts.done}/{total} done
            </span>
            {counts.in_progress > 0 && <span>· {counts.in_progress} active</span>}
            {project.blocked_count > 0 && (
              <span className="project-blocked">
                <LockIcon />
                {project.blocked_count} blocked
              </span>
            )}
            {project.last_activity_at !== null && (
              <span className="project-when">{ago(project.last_activity_at, now)}</span>
            )}
          </p>
        </div>
      )}

      {shown.length > 0 && (
        <div className="project-people">
          <span className="project-faces">
            {shown.map((member) => {
              const colour = avatarColor(member.user_id, theme);
              return (
                <span
                  key={member.user_id}
                  className="project-face"
                  style={{
                    background: colour.background,
                    color: colour.foreground,
                    borderColor: colour.border,
                  }}
                  title={member.name}
                >
                  {initials(member.name)}
                </span>
              );
            })}
          </span>
          <span className="project-people-note">
            {overflow > 0
              ? `${String(project.member_count)} people`
              : shown.map((m) => m.name.split(' ')[0]).join(', ')}
          </span>
        </div>
      )}
    </>
  );
}
