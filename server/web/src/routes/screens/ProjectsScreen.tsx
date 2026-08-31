import { useState } from 'react';
import { ApiErrorState } from '../../components/ApiErrorState.tsx';
import { ScreenHeader } from '../../components/ScreenHeader.tsx';
import { ProjectStats } from './ProjectStats.tsx';
import { useTheme } from '../../theme/use-theme.ts';
import { EmptyState } from '../../components/EmptyState.tsx';
import { LoadingState } from '../../components/LoadingState.tsx';
import { Button } from '../../components/forms/Button.tsx';
import { Select } from '../../components/forms/Select.tsx';
import { TextInput } from '../../components/forms/TextInput.tsx';
import { useProjects } from '../../api/use-projects.ts';
import { createProject, slugify, suggestPrefix, type Project } from '../../api/projects.ts';
import { canEditProjectContext } from '../../api/project-context.ts';
import { ProjectContextPanel } from './projects/ProjectContextPanel.tsx';
import type { MeProfile } from '../../api/me.ts';
import type { Member } from '../../api/tasks.ts';
import { ApiError } from '../../api/errors.ts';
import { fieldErrors } from '../../api/setup.ts';
import { required } from '../../components/forms/validation.ts';
import './projects.css';

export interface ProjectsScreenProps {
  /** Open a project's board. `?project=<slug>` is what BoardScreen reads. */
  readonly onOpen: (slug: string) => void;
  /** Open its member list — the same `?project=` mechanism (LAI-059). */
  readonly onOpenMembers: (slug: string) => void;
  /** Who is asking — decides whether the context document is editable. */
  readonly me: MeProfile | undefined;
}

/**
 * The project list and the way to make one (§11.4.2).
 *
 * Choosing a project sets `?project=<slug>` on the board rather than storing an
 * "active project" anywhere: the URL already carries it, `BoardScreen` already
 * reads it, and it survives a reload for free. A second mechanism would be a
 * second thing to keep in sync.
 */
export function ProjectsScreen({ onOpen, onOpenMembers, me }: ProjectsScreenProps) {
  /** Which project's context document is open, if any (LAI-412). */
  const [contextFor, setContextFor] = useState<Project | undefined>(undefined);
  const { theme } = useTheme();
  const list = useProjects();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [prefix, setPrefix] = useState('');
  const [visibility, setVisibility] = useState('private');
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState<unknown>(null);
  const [serverFields, setServerFields] = useState<Readonly<Record<string, string>>>({});

  const nameCheck = required(name, 'Project name');
  const slugCheck = required(slug, 'Slug');
  const prefixCheck = required(prefix, 'Key prefix');
  const valid = nameCheck.ok && slugCheck.ok && prefixCheck.ok;

  const onNameChange = (next: string): void => {
    setName(next);
    // Suggested, not locked: both are editable, and once someone edits the slug
    // we stop overwriting it.
    if (!touched) {
      setSlug(slugify(next));
      setPrefix(suggestPrefix(next));
    }
  };

  const submit = async (): Promise<void> => {
    setSubmitting(true);
    setCreateError(null);
    setServerFields({});

    try {
      const project = await createProject({
        name,
        slug,
        prefix,
        visibility: visibility === 'public' ? 'public' : 'private',
      });
      list.add(project);
      setCreating(false);
      setName('');
      setSlug('');
      setPrefix('');
      setTouched(false);
      onOpen(project.slug);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'unprocessable') {
        setServerFields(fieldErrors(cause));
      }
      setCreateError(cause);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="projects">
      <ScreenHeader
        title="Projects"
        context={
          list.status === 'ready'
            ? `${String(list.projects.length)} project${list.projects.length === 1 ? '' : 's'}`
            : undefined
        }
      />
      <header className="projects-head">
        <p className="projects-sub">
          Projects you can see. Opening one loads its board; the choice lives in the URL.
        </p>
        {!creating && (
          <Button
            onClick={() => {
              setCreating(true);
            }}
          >
            New project
          </Button>
        )}
      </header>

      {creating && (
        <form
          className="projects-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            setTouched(true);
            if (valid) void submit();
          }}
        >
          <h2 className="projects-form-title">New project</h2>

          {/* A 403 here is a normal outcome, not a fault: a Member cannot create
              projects (§3.1). ApiErrorState renders that as permission-denied. */}
          {createError !== null && (
            <ApiErrorState
              error={createError}
              resource="a new project"
              requiredRole="admin"
              scope="organisation"
            />
          )}

          <TextInput
            label="Name"
            value={name}
            onChange={onNameChange}
            required
            disabled={submitting}
            error={touched && !nameCheck.ok ? nameCheck.message : serverFields.name}
          />
          <TextInput
            label="Slug"
            value={slug}
            onChange={(v) => {
              setTouched(true);
              setSlug(v);
            }}
            required
            disabled={submitting}
            help="Lowercase words joined by hyphens. Used in URLs."
            error={touched && !slugCheck.ok ? slugCheck.message : serverFields.slug}
          />
          <TextInput
            label="Key prefix"
            value={prefix}
            onChange={(v) => {
              setTouched(true);
              setPrefix(v);
            }}
            required
            disabled={submitting}
            help="2–8 letters and digits, starting with a letter. Task keys look like LC-42."
            error={touched && !prefixCheck.ok ? prefixCheck.message : serverFields.prefix}
          />
          <Select
            label="Visibility"
            value={visibility}
            onChange={setVisibility}
            disabled={submitting}
            options={[
              { value: 'private', label: 'Private — invited members only' },
              { value: 'public', label: 'Public — anyone in the org can join' },
            ]}
          />

          <div className="projects-form-actions">
            <Button type="submit" busy={submitting} busyLabel="Creating…">
              Create project
            </Button>
            <Button
              variant="secondary"
              disabled={submitting}
              onClick={() => {
                setCreating(false);
                setCreateError(null);
                setServerFields({});
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      {list.status === 'loading' ? (
        <LoadingState shape="card" count={3} label="Loading projects" />
      ) : list.status === 'error' ? (
        <ApiErrorState
          error={list.error}
          resource="your projects"
          scope="organisation"
          onRetry={list.reload}
        />
      ) : list.projects.length === 0 ? (
        <EmptyState
          headline="No projects yet"
          body="Create the first one and point it at a repo."
          {...(creating
            ? {}
            : {
                action: {
                  label: 'New project',
                  onClick: () => {
                    setCreating(true);
                  },
                },
              })}
        />
      ) : (
        <>
          <p className="projects-section">
            <span>YOUR PROJECTS</span>
            <span className="projects-rule" aria-hidden="true" />
          </p>

          <ul className="projects-list">
            {list.projects.map((project) => (
              <li key={project.id}>
                <article className="project-card">
                  <header className="project-card-head">
                    <h3 className="project-card-name">{project.name}</h3>
                    <span
                      className={
                        project.visibility === 'public'
                          ? 'project-chip project-chip-public'
                          : 'project-chip'
                      }
                    >
                      {project.visibility.toUpperCase()}
                    </span>
                  </header>

                  {/* The repo the project tracks. Omitted when unset rather than
                      shown empty — `projects.repo` is nullable. */}
                  {project.repo !== null && project.repo !== '' && (
                    <p className="project-repo">{project.repo}</p>
                  )}

                  {project.description !== null && project.description !== '' && (
                    <p className="project-card-desc">{project.description}</p>
                  )}

                  {/* Served with the list by LAI-053 — one request for the
                      page, not one per card. */}
                  <ProjectStats project={project} theme={theme} />

                  <footer className="project-card-foot">
                    <code className="project-key">{project.prefix}-1</code>
                    <span className="project-slug">{project.slug}</span>
                    <span className="project-foot-spacer" />
                    <button
                      type="button"
                      className="project-members"
                      onClick={() => {
                        setContextFor(project);
                      }}
                    >
                      Context
                    </button>
                    <button
                      type="button"
                      className="project-members"
                      onClick={() => {
                        onOpenMembers(project.slug);
                      }}
                    >
                      Members
                    </button>
                    <button
                      type="button"
                      className="project-open"
                      onClick={() => {
                        onOpen(project.slug);
                      }}
                    >
                      Open board
                    </button>
                  </footer>
                </article>
              </li>
            ))}
          </ul>

          {contextFor !== undefined && (
            <ProjectContextPanel
              slug={contextFor.slug}
              projectName={contextFor.name}
              /* Decided here, where the actor's memberships are known. The panel
                 renders read-only rather than offering a Save that answers 403. */
              mayEdit={
                me !== undefined &&
                canEditProjectContext(me.org_role, contextFor.id, me.memberships)
              }
              /* The project summary already carries its members, so naming who
                 last edited the document costs no second request. */
              members={
                new Map(contextFor.members.map((m) => [m.user_id, { name: m.name } as Member]))
              }
              onClose={() => {
                setContextFor(undefined);
              }}
            />
          )}

          {list.nextCursor !== null && (
            <div className="projects-more">
              <Button
                variant="secondary"
                busy={list.loadingMore}
                busyLabel="Loading…"
                onClick={list.loadMore}
              >
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
