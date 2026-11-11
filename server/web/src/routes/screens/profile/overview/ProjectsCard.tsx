import { useState } from 'react';
import type { ProfileProject } from '../../../../api/profiles.ts';
import { spaceColor, spaceColorVar } from '../../../../theme/space-color.ts';
import { hoursText, projectRole, quietLabel, splitProjects } from './overview-derive.ts';
import { OverviewCard } from './OverviewCard.tsx';

/** One project's row: the desktop cells, and the phone's second line beside them. */
function ProjectRow({ project }: { readonly project: ProfileProject }) {
  const role = projectRole(project.role);
  const hours = hoursText(project.minutes_14d);
  return (
    <div role="row" className="ov-project" data-project={project.slug}>
      <span role="rowheader" className="ov-project-name">
        <span
          className="ov-letter"
          style={{ background: spaceColorVar(spaceColor(project)) }}
          aria-hidden="true"
        >
          {project.name.charAt(0).toUpperCase()}
        </span>
        <span className="prof-key">{project.key}</span>
        <span className="ov-project-title" title={project.name}>
          {project.name}
        </span>
        {project.archived && <span className="prof-chip">ARCHIVED</span>}
        {/* A phone's second line: everything else, in words (frame C). */}
        <span className="ov-project-phone" data-phone-line>
          {`${role} · ${hours === '—' ? 'no hours' : hours} in 2 weeks · ${String(project.accepted)} accepted · ${String(project.reviewed)} reviewed`}
        </span>
      </span>
      <span role="cell" className="ov-project-role" data-col="role">
        {role}
      </span>
      <span role="cell" className="ov-num ov-project-open" data-col="open">
        <b>{project.open_tasks}</b>
        <span className="ov-project-phone"> open</span>
      </span>
      <span role="cell" className="ov-num" data-col="hours">
        {hours}
      </span>
      <span role="cell" className="ov-num" data-col="accepted">
        {project.accepted}
      </span>
      <span role="cell" className="ov-num" data-col="reviewed">
        {project.reviewed}
      </span>
    </div>
  );
}

/**
 * Projects (SPEC §11.4.2.1, frame A): a table of where they work — role
 * (*Space admin* for a lead, D-103), open now, hours in their last two weeks,
 * accepted and reviewed in twelve weeks — most open first. Projects with
 * nothing open, tracked, accepted or reviewed fold into one *N quiet projects*
 * row that opens. On a phone each row is two lines (frame C).
 */
export function ProjectsCard({ projects }: { readonly projects: readonly ProfileProject[] }) {
  const [open, setOpen] = useState(false);
  const { active, quiet } = splitProjects(projects);
  const fold = quietLabel(quiet);

  return (
    <OverviewCard
      name="projects"
      title="Projects"
      count={projects.length}
      caption="open now · hours: 2 weeks · accepted, reviewed: 12 weeks"
    >
      {projects.length === 0 ? (
        <p className="prof-empty">No projects yet.</p>
      ) : (
        <div role="table" className="ov-projects" aria-label="Their projects">
          <div role="rowgroup" className="ov-projects-head">
            <div role="row" className="ov-project">
              <span role="columnheader">Project</span>
              <span role="columnheader" data-col="role">
                Role
              </span>
              <span role="columnheader" className="ov-num" data-col="open">
                Open
              </span>
              <span role="columnheader" className="ov-num" data-col="hours">
                2 weeks
              </span>
              <span role="columnheader" className="ov-num" data-col="accepted">
                Accepted
              </span>
              <span role="columnheader" className="ov-num" data-col="reviewed">
                Reviewed
              </span>
            </div>
          </div>
          <div role="rowgroup">
            {active.map((project) => (
              <ProjectRow key={project.id} project={project} />
            ))}
            {quiet.length > 0 && (
              <div role="row" className="ov-quiet-row">
                <span role="cell" className="ov-quiet-cell">
                  <button
                    type="button"
                    className="ov-quiet"
                    aria-expanded={open}
                    data-quiet
                    onClick={() => {
                      setOpen((was) => !was);
                    }}
                  >
                    <span className="ov-chevron" data-open={open} aria-hidden="true">
                      ›
                    </span>
                    <span className="ov-quiet-title">{fold.title}</span>
                    <span className="ov-quiet-names">{fold.names}</span>
                  </button>
                </span>
              </div>
            )}
            {open && quiet.map((project) => <ProjectRow key={project.id} project={project} />)}
          </div>
        </div>
      )}
    </OverviewCard>
  );
}
