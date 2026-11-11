import { useEffect, useRef, useState } from 'react';
import { useConfirm } from '../../components/ConfirmProvider.tsx';
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
import { ProjectContextPanel } from './projects/ProjectContextPanel.tsx';
import { SpaceCard } from './projects/SpaceCard.tsx';
import type { SpaceHandlers, SpaceItemProps, SpaceKind } from './projects/SpaceActions.tsx';
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
import { type Member } from '../../api/tasks.ts';
import { ApiError } from '../../api/errors.ts';
import { fieldErrors } from '../../api/setup.ts';
import { required, type Validity } from '../../components/forms/validation.ts';
import './projects.css';
import { useGates } from '../../api/permissions.ts';

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
  /*
   * **Focus goes back to the Context button that opened the panel** (LAI-1022).
   * Closing it left focus on `<body>`, so a keyboard reader lost their place in
   * the space list. Kept as the element, with the slug to find a re-rendered
   * one by, and applied once the panel has left the DOM.
   */
  const contextOpener = useRef<{ readonly el: Element | null; readonly slug: string } | undefined>(
    undefined,
  );
  const returnFocus = useRef(false);
  useEffect(() => {
    if (contextFor !== undefined || !returnFocus.current) return;
    returnFocus.current = false;
    const opener = contextOpener.current;
    contextOpener.current = undefined;
    if (opener === undefined) return;
    const target =
      opener.el instanceof HTMLElement && opener.el !== document.body && opener.el.isConnected
        ? opener.el
        : document.querySelector<HTMLElement>(
            `[data-action="context"][data-space="${CSS.escape(opener.slug)}"]`,
          );
    target?.focus();
  }, [contextFor]);
  const { theme } = useTheme();
  const list = useProjects();
  const gates = useGates(me !== undefined);
  const archivedList = useProjects('only');
  /**
   * Who may create, restore and open settings: `can()`'s own answers from
   * `GET /permissions` through the shared gates (LAI-970), never a role this
   * client decides grants them. Each denies until the server has answered.
   */
  const mayCreate = gates.org('project.create');
  /**
   * Restore is the settings `PATCH`, which asks both: the org's
   * `project.archive` and this space's `project.settings.edit` (LAI-976) —
   * so *Create and archive spaces* alone, without a way into the space, is
   * not enough.
   */
  const mayRestore = (space: Project): boolean =>
    gates.org('project.archive') && gates.project(space.id, 'project.settings.edit');
  /** The space a join or restore is in flight for, so only its own button says so. */
  const [busy, setBusy] = useState<string | undefined>(undefined);
  const [actionError, setActionError] = useState<string | undefined>(undefined);
  const query = readSpacesQuery(params);
  const changeQuery = (patch: Partial<SpacesQuery>): void => {
    onParamsChange(writeSpacesQuery(params, patch));
  };
  const confirm = useConfirm();
  /** What the last join, archive or restore did, said once (LAI-1196). */
  const [notice, setNotice] = useState<string | undefined>(undefined);

  /**
   * Explicit membership from `me.memberships`, never from the summary's
   * `members`; an implicit lead as the server reports it
   * (`implicit_project_role`, LAI-970) — never from the org role.
   *
   * That array is capped for drawing faces — a space with forty members sends a
   * handful — so testing it would make a space you can already open look
   * joinable once it grew past the cap.
   */
  const isMine = (project: Project): boolean =>
    me?.memberships.some((m) => m.project_id === project.id) === true || gates.leads(project.id);

  const both = splitSpaces(
    list.status === 'ready' ? list.projects : [],
    archivedList.status === 'ready' ? archivedList.projects : [],
    isMine,
  );
  // Nothing is offered to join until the server has said which spaces the
  // reader already leads: Join on a space they implicitly lead is a dead control.
  const split = gates.settled ? both : { ...both, joinable: [] };
  const counts = spaceCounts(split);
  const sections = sectionsFor(split, query.filter, query.q, query.sort);

  /**
   * A join or a restore, then a re-read: the lists decide membership and
   * archiving, so neither is patched locally into a state the server never
   * confirmed.
   */
  const act = async (
    slug: string,
    run: () => Promise<unknown>,
    failed: string,
    done: string,
  ): Promise<void> => {
    setBusy(slug);
    setActionError(undefined);
    setNotice(undefined);
    try {
      await run();
      list.reload();
      archivedList.reload();
      setNotice(done);
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
    onContext: (space) => {
      contextOpener.current = { el: document.activeElement, slug: space.slug };
      setContextFor(space);
    },
    onMembers: (space) => {
      onOpenMembers(space.slug);
    },
    onSettings: (space) => {
      onOpenSettings(space.slug);
    },
    onJoin: (space) => {
      void act(
        space.slug,
        () => joinProject(space.slug),
        'Could not join that space. Try again.',
        `You joined ${space.name}. It is listed under Your spaces.`,
      );
    },
    onRestore: (space) => {
      void act(
        space.slug,
        () => setProjectArchived(space.slug, false),
        'Could not restore that space. Try again.',
        `${space.name} is restored and open for work again.`,
      );
    },
    /*
     * **Asked first, with what it does** (LAI-1196). The same `PATCH` the
     * space's Danger tab sends, so the same two grants show the button and the
     * server still decides; the dialog says what changes and how to undo it.
     */
    onArchive: (space) => {
      void confirm({
        title: `Archive ${space.name}?`,
        body: `Its board becomes read-only: nobody can add or move tasks, and agents stop picking up its work. Nothing is deleted. It moves to Archived, where it can be restored.`,
        confirmLabel: 'Archive space',
        danger: true,
      }).then((yes) => {
        if (!yes) return;
        void act(
          space.slug,
          () => setProjectArchived(space.slug, true),
          'Could not archive that space. Try again.',
          `${space.name} is archived. Find it under Archived to restore it.`,
        );
      });
    },
  };

  const now = Date.now();
  const item = (space: Project, kind: SpaceKind): SpaceItemProps => ({
    space,
    kind,
    maySettings: gates.project(space.id, 'project.settings.edit'),
    mayRestore: mayRestore(space),
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
  /*
   * **The form is the URL** (LAI-1196): `?new=1` opens it — the address the
   * sidebar's and an empty board's *Create a space* lead to (LAI-1191) — so a
   * reload keeps it open and Back closes it. Only a reader who may create
   * sees it; anyone else gets the plain page.
   */
  const creating = mayCreate && params.get('new') === '1';
  const setCreating = (open: boolean): void => {
    const next = new URLSearchParams(params);
    if (open) next.set('new', '1');
    else next.delete('new');
    onParamsChange(next);
  };
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [prefix, setPrefix] = useState('');
  const [visibility, setVisibility] = useState('private');
  /** Show each field's problem: after a submit, or once that field is edited. */
  const [touched, setTouched] = useState(false);
  /*
   * Slug and prefix edited by hand: from then on the name no longer rewrites
   * them. Kept apart from `touched` (LAI-1196) — pressing Create on an empty
   * form used to set the one flag and freeze the suggestions for good.
   */
  const [edited, setEdited] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState<unknown>(null);
  const [serverFields, setServerFields] = useState<Readonly<Record<string, string>>>({});

  const nameCheck = required(name, 'Name');
  const slugCheck = patterned(slug, 'Slug', SLUG_PATTERN, 'Use lowercase words joined by hyphens.');
  const prefixCheck = patterned(
    prefix,
    'Key prefix',
    PREFIX_PATTERN,
    'Use 2–8 letters and digits, starting with a letter.',
  );
  const valid = nameCheck.ok && slugCheck.ok && prefixCheck.ok;
  const formRef = useRef<HTMLFormElement>(null);
  // Opening the form puts the cursor in Name — the one field nothing suggests.
  useEffect(() => {
    if (creating) formRef.current?.querySelector<HTMLInputElement>('input')?.focus();
  }, [creating]);

  const onNameChange = (next: string): void => {
    setName(next);
    // Suggested, not locked: both are editable, and once someone edits the slug
    // we stop overwriting it.
    if (!edited) {
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
        name: name.trim(),
        slug: slug.trim(),
        prefix: prefix.trim().toUpperCase(),
        visibility: visibility === 'public' ? 'public' : 'private',
      });
      list.add(project);
      setName('');
      setSlug('');
      setPrefix('');
      setTouched(false);
      setEdited(false);
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
        description="Every space you are in, and the public ones you can join. Open one to see its board."
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
          ref={formRef}
          className="projects-form"
          aria-labelledby="projects-form-title"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            setTouched(true);
            if (valid) void submit();
          }}
        >
          <h2 id="projects-form-title" className="projects-form-title">
            New space
          </h2>
          <p className="projects-form-lead">
            You become its Space admin. Its board opens as soon as it is created.
          </p>

          {/* A 403 here is a normal outcome, not a fault: a Member cannot create
              projects (§3.1). ApiErrorState renders that as permission-denied. */}
          {createError instanceof ApiError && createError.status === 403 ? (
            <ApiErrorState
              error={createError}
              resource="a new space"
              requiredRole="admin"
              scope="organisation"
            />
          ) : createError !== null ? (
            /*
             * **Said as a create that failed** (LAI-1196): the shared error state
             * reads "Could not load a new space", a load nobody asked for. A
             * refusal with field errors points at the fields; anything else
             * says what the server said, and the form keeps what was typed.
             */
            <p className="projects-error projects-form-error" role="alert">
              {Object.keys(serverFields).length > 0
                ? 'The space was not created. Fix the fields marked below and try again.'
                : `The space was not created. ${
                    createError instanceof ApiError ? createError.message : 'Try again.'
                  }`}
            </p>
          ) : null}

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
              setEdited(true);
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
              setEdited(true);
              setPrefix(v);
            }}
            required
            disabled={submitting}
            help={`2–8 letters and digits, starting with a letter. Task keys will look like ${
              prefixCheck.ok ? prefix.trim().toUpperCase() : 'KEY'
            }-42.`}
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
              Create space
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
        <LoadingState shape="card" count={3} label="Loading spaces" />
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
              `?archived=only`), muted, with Restore for `project.archive` and the space's
              `project.settings.edit`. */}
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
          <p className="projects-notice" role="status" data-empty={notice === undefined}>
            {notice}
          </p>

          {contextFor !== undefined && (
            <ProjectContextPanel
              slug={contextFor.slug}
              projectName={contextFor.name}
              /* Decided here, where the actor's memberships are known. The panel
                 renders read-only rather than offering a Save that answers 403. */
              mayEdit={gates.project(contextFor.id, 'project.settings.edit')}
              /* The project summary already carries its members, so naming who
                 last edited the document costs no second request. */
              members={
                new Map(contextFor.members.map((m) => [m.user_id, { name: m.name } as Member]))
              }
              onClose={() => {
                returnFocus.current = true;
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

/** The server's own patterns (`server/src/http/routes/projects.ts`), checked early. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PREFIX_PATTERN = /^[A-Za-z][A-Za-z0-9]{1,7}$/;

/**
 * Required, then shaped like the server will accept (LAI-1196) — so a typo is
 * named beside its field before a round trip, not after. The server still
 * decides: its `422` field errors are shown the same way.
 */
function patterned(value: string, field: string, pattern: RegExp, hint: string): Validity {
  const present = required(value, field);
  if (!present.ok) return present;
  return pattern.test(value.trim()) ? present : { ok: false, message: hint };
}
