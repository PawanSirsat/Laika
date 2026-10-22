import { useState } from 'react';
import { ApiErrorState } from '../../components/ApiErrorState.tsx';
import { ScreenHeader } from '../../components/ScreenHeader.tsx';
import { useTheme } from '../../theme/use-theme.ts';
import { EmptyState } from '../../components/EmptyState.tsx';
import { LoadingState } from '../../components/LoadingState.tsx';
import { Button } from '../../components/forms/Button.tsx';
import { Select } from '../../components/forms/Select.tsx';
import { TextInput } from '../../components/forms/TextInput.tsx';
import { useProjects } from '../../api/use-projects.ts';
import {
  createProject,
  joinProject,
  setProjectArchived,
  slugify,
  suggestPrefix,
  VISIBILITY_OPTIONS,
  type Project,
} from '../../api/projects.ts';
import { canEditProjectContext } from '../../api/project-context.ts';
import { mayInOrg, mayInProject } from '../../api/permissions.ts';
import { usePermissions } from '../../api/use-permissions.ts';
import { ProjectContextPanel } from './projects/ProjectContextPanel.tsx';
import { SpaceCard } from './projects/SpaceCard.tsx';
import type { SpaceHandlers, SpaceItemProps, SpaceKind } from './projects/SpaceParts.tsx';
import { SpaceTable } from './projects/SpaceTable.tsx';
import { SpacesToolbar } from './projects/SpacesToolbar.tsx';
import {
  readSpacesQuery,
  sectionsFor,
  spaceCounts,
  splitSpaces,
  writeSpacesQuery,
  type SpacesQuery,
} from './projects/spaces-model.ts';
import type { MeProfile } from '../../api/me.ts';
import { canConfigureProject, type Member } from '../../api/tasks.ts';
import { ApiError } from '../../api/errors.ts';
import { fieldErrors } from '../../api/setup.ts';
import { required } from '../../components/forms/validation.ts';
import './projects.css';

export interface ProjectsScreenProps {
  /** Open a project's board. `?project=<slug>` is what BoardScreen reads. */
  readonly onOpen: (slug: string) => void;
  /** Open its member list — the same `?project=` mechanism (LAI-059). */
  readonly onOpenMembers: (slug: string) => void;
  /** Open its settings at `/spaces/<slug>/settings` (D-103 item 1, LAI-977). */
  readonly onOpenSettings: (slug: string) => void;
  /** Who is asking — decides whether the context document is editable. */
  readonly me: MeProfile | undefined;
  /** The page's own state — chip, view, search — lives in the URL (LAI-978). */
  readonly params: URLSearchParams;
  readonly onParamsChange: (next: URLSearchParams) => void;
}

/**
 * The project list and the way to make one (§11.4.2).
 *
 * Choosing a project sets `?project=<slug>` on the board rather than storing an
 * "active project" anywhere: the URL already carries it, `BoardScreen` already
 * reads it, and it survives a reload for free. A second mechanism would be a
 * second thing to keep in sync.
 *
 * The page itself follows the owner's design (D-103 item 12, LAI-978): search,
 * *All / Yours / Public / Archived* with the server's counts, and a grid of
 * one fixed card shape or a list. The same three choices live in the URL too.
 */
export function ProjectsScreen({
  onOpen,
  onOpenMembers,
  onOpenSettings,
  me,
  params,
  onParamsChange,
}: ProjectsScreenProps) {
  /** Which project's context document is open, if any (LAI-412). */
  const [contextFor, setContextFor] = useState<Project | undefined>(undefined);
  const { theme } = useTheme();
  const list = useProjects();
  const archivedList = useProjects('only');
  /**
   * Who may create, restore and open settings: `can()`'s own answers from
   * `GET /permissions`, never a role this client decides grants them.
   */
  const permissions = usePermissions();
  const mayCreate = permissions !== undefined && mayInOrg(permissions, 'project.create');
  const mayRestore = permissions !== undefined && mayInOrg(permissions, 'project.archive');
  /** The space a join or restore is in flight for, so only its own button says so. */
  const [busy, setBusy] = useState<string | undefined>(undefined);
  const [actionError, setActionError] = useState<string | undefined>(undefined);
  const query = readSpacesQuery(params);
  const changeQuery = (patch: Partial<SpacesQuery>): void => {
    onParamsChange(writeSpacesQuery(params, patch));
  };

  /**
   * Explicit membership from `me.memberships`, never from the summary's
   * `members`; owner/admin implicit lead from the shared project helper.
   *
   * That array is capped for drawing faces — a space with forty members sends a
   * handful — so testing it would make a space you can already open look
   * joinable once it grew past the cap.
   */
  const isMine = (project: Project): boolean =>
    me?.memberships.some((m) => m.project_id === project.id) === true ||
    (me !== undefined && canConfigureProject(me.org_role, project.id, me.memberships));

  const split = splitSpaces(
    list.status === 'ready' ? list.projects : [],
    archivedList.status === 'ready' ? archivedList.projects : [],
    isMine,
  );
  const counts = spaceCounts(split);
  const sections = sectionsFor(split, query.filter, query.q);

  /**
   * A join or a restore, then a re-read: the lists decide membership and
   * archiving, so neither is patched locally into a state the server never
   * confirmed.
   */
  const act = async (slug: string, run: () => Promise<unknown>, failed: string): Promise<void> => {
    setBusy(slug);
    setActionError(undefined);
    try {
      await run();
      list.reload();
      archivedList.reload();
    } catch (cause) {
      setActionError(cause instanceof ApiError ? cause.message : failed);
    } finally {
      setBusy(undefined);
    }
  };

  const handlers: SpaceHandlers = {
    onOpen: (space) => {
      onOpen(space.slug);
    },
    onContext: setContextFor,
    onMembers: (space) => {
      onOpenMembers(space.slug);
    },
    onSettings: (space) => {
      onOpenSettings(space.slug);
    },
    onJoin: (space) => {
      void act(space.slug, () => joinProject(space.slug), 'Could not join that space. Try again.');
    },
    onRestore: (space) => {
      void act(
        space.slug,
        () => setProjectArchived(space.slug, false),
        'Could not restore that space. Try again.',
      );
    },
  };

  const now = Date.now();
  const item = (space: Project, kind: SpaceKind): SpaceItemProps => ({
    space,
    kind,
    maySettings:
      permissions !== undefined && mayInProject(permissions, space.id, 'project.settings.edit'),
    mayRestore,
    busy: busy === space.slug,
    theme,
    now,
    handlers,
  });

  /** One section: its eyebrow and count, then cards or a table. */
  const section = (title: string, label: string, kind: SpaceKind, spaces: readonly Project[]) =>
    spaces.length === 0 ? null : (
      <section className="projects-group" aria-label={label}>
        <p className="projects-section">
          <span>{title}</span>
          <span className="projects-section-count">{spaces.length}</span>
          <span className="projects-rule" aria-hidden="true" />
        </p>
        {query.view === 'grid' ? (
          <ul className="projects-list">
            {spaces.map((space) => (
              <li key={space.id}>
                <SpaceCard {...item(space, kind)} />
              </li>
            ))}
          </ul>
        ) : (
          <SpaceTable spaces={spaces} label={label} row={(space) => item(space, kind)} />
        )}
      </section>
    );
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
        /*
          **Spaces, not Projects** (D-059). The sidebar says SPACES, the view
          tabs sit inside a space, and this screen — the one that lists them —
          was the last place still calling them projects. Two words for one
          thing is how a reader ends up wondering whether they are different.
          The API's noun stays `project`; the product's noun is `space`.
        */
        variant="page"
        title="Spaces"
        context={
          list.status === 'ready'
            ? `${String(counts.all)} space${counts.all === 1 ? '' : 's'}`
            : undefined
        }
        description="Spaces you can see. Opening one loads its board; the choice lives in the URL."
      >
        {/* Only for holders of `project.create` (LAI-970's permission source). */}
        {mayCreate && !creating && (
          <Button
            onClick={() => {
              setCreating(true);
            }}
          >
            + New space
          </Button>
        )}
      </ScreenHeader>

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
          <h2 className="projects-form-title">New space</h2>

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
            options={VISIBILITY_OPTIONS}
          />

          <div className="projects-form-actions">
            <Button type="submit" busy={submitting}>
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
          resource="your spaces"
          scope="organisation"
          onRetry={list.reload}
        />
      ) : counts.all === 0 && counts.archived === 0 ? (
        <EmptyState
          headline="No spaces yet"
          body={
            mayCreate
              ? 'Create the first one and point it at a repo.'
              : 'Nobody has added you to a space yet, and there is no public one to join.'
          }
          {...(creating || !mayCreate
            ? {}
            : {
                action: {
                  label: 'New space',
                  onClick: () => {
                    setCreating(true);
                  },
                },
              })}
        />
      ) : (
        <>
          <SpacesToolbar query={query} counts={counts} onChange={changeQuery} />

          {section('YOUR SPACES', 'Your spaces', 'yours', sections.yours)}

          {/*
            **PUBLIC IN THIS ORG** (prototype line 1345), closing LAI-236.

            The directory listed public spaces a reader could see and offered no
            way in, so the only route to membership was somebody adding you.
            `POST /projects/:slug/join` has been served all along.

            Membership is read from `me.memberships`, not from the truncated
            `members` array on the summary — a space with forty members would
            otherwise look joinable to someone already in it.
          */}
          {section('PUBLIC IN THIS ORG', 'Public in this org', 'joinable', sections.joinable)}

          {/* The *Archived* chip's own list (D-103 item 10, LAI-976's
              `?archived=only`), muted, with Restore for `project.archive`. */}
          {query.filter === 'archived' && archivedList.status === 'error' ? (
            <ApiErrorState
              error={archivedList.error}
              resource="archived spaces"
              scope="organisation"
              onRetry={archivedList.reload}
            />
          ) : (
            section('ARCHIVED', 'Archived', 'archived', sections.archived)
          )}

          {sections.yours.length + sections.joinable.length + sections.archived.length === 0 &&
            !(query.filter === 'archived' && archivedList.status !== 'ready') && (
              <p className="projects-none">
                {query.q.trim() === ''
                  ? query.filter === 'archived'
                    ? 'No archived spaces.'
                    : 'No spaces here.'
                  : `No spaces match “${query.q.trim()}”.`}
              </p>
            )}

          {actionError !== undefined && (
            <p className="projects-error" role="alert">
              {actionError}
            </p>
          )}

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
              <Button variant="secondary" busy={list.loadingMore} onClick={list.loadMore}>
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
