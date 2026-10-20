import type { MouseEvent } from 'react';
import type { UseProjects } from '../../../api/use-projects.ts';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { SpaceBadge } from '../../../components/SpaceBadge.tsx';

export interface OrgSpacesProps {
  readonly projects: UseProjects;
  readonly onNavigate: (to: string) => void;
}

/** Open tasks: everything not done and not cancelled, from the served counts. */
function openTasks(counts: Readonly<Record<string, number>>): number {
  return Object.entries(counts)
    .filter(([status]) => status !== 'done' && status !== 'cancelled')
    .reduce((sum, [, n]) => sum + n, 0);
}

/**
 * The organisation's spaces, on Overview (LAI-796): each with its members and
 * open tasks, from the counts `GET /projects` already serves. Creating,
 * archiving and membership stay on Projects and each space's Members — this
 * is the list, and every row opens the space.
 */
export function OrgSpaces({ projects, onNavigate }: OrgSpacesProps) {
  const follow = (to: string) => (event: MouseEvent) => {
    // Modified clicks stay the browser's — new tab, new window.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onNavigate(to);
  };

  return (
    <section className="org-card org-spaces" aria-labelledby="org-spaces">
      <header className="org-card-head">
        <h2 id="org-spaces">Spaces</h2>
        {projects.status === 'ready' && (
          <span className="org-count">
            {String(projects.projects.length)}
            {projects.nextCursor === null ? '' : '+'}
          </span>
        )}
        <a className="org-head-action" href="/projects" onClick={follow('/projects')}>
          + New space
        </a>
      </header>

      {projects.status === 'loading' && (
        <LoadingState shape="row" count={3} label="Loading the spaces" />
      )}
      {projects.status === 'error' && (
        <ApiErrorState
          error={projects.error}
          resource="the spaces"
          scope="organisation"
          onRetry={projects.reload}
        />
      )}
      {projects.status === 'ready' &&
        (projects.projects.length === 0 ? (
          <p className="org-note">No spaces yet. Create the first one from Projects.</p>
        ) : (
          <table className="org-table">
            <thead>
              <tr>
                <th scope="col">Space</th>
                <th scope="col">Members</th>
                <th scope="col">Open tasks</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {projects.projects.map((project) => {
                const href = `/board?project=${encodeURIComponent(project.slug)}`;
                return (
                  <tr key={project.id}>
                    <td>
                      <a className="org-space" href={href} onClick={follow(href)}>
                        <SpaceBadge slug={project.slug} name={project.name} size="md" />
                        {project.name}
                      </a>
                    </td>
                    <td className="org-num">{String(project.member_count)}</td>
                    <td className="org-num">{String(openTasks(project.task_counts))}</td>
                    <td>
                      {project.archived_at === null ? (
                        <span className="org-status org-status-on">Active</span>
                      ) : (
                        <span className="org-status">Archived</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ))}
    </section>
  );
}
