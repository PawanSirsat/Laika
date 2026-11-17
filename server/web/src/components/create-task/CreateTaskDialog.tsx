import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { dateInputToMs } from '../../api/date-only.ts';
import { everyPage } from '../../api/every-page.ts';
import type { MeProfile } from '../../api/me.ts';
import { getProject, type Project } from '../../api/projects.ts';
import { pickerChoices } from '../../api/selected-agent.ts';
import { addTasksToSprint, listSprints, type Sprint } from '../../api/sprints.ts';
import { listProjectTags, type ProjectTag } from '../../api/tags.ts';
import { addDependency, createTask, listMembers, type Member, type Task } from '../../api/tasks.ts';
import { useGates } from '../../api/permissions.ts';
import { useSpaces } from '../../routes/use-spaces.ts';
import { useMyAgents } from '../../api/use-my-agents.ts';
import { reloadProjectTasks, useProjectTasks } from '../../api/use-project-tasks.ts';
import { useProjectStatuses } from '../../api/use-statuses.ts';
import type {
  MentionCandidate,
  RichEditorHandle,
} from '../../routes/screens/task/LazyRichEditor.tsx';
import { useConfirm } from '../ConfirmProvider.tsx';
import { Dropdown } from '../Dropdown.tsx';
import { ProjectMark } from '../ProjectMark.tsx';
import { Field } from '../forms/Field.tsx';
import { Button } from '../forms/Button.tsx';
import { IconButton } from '../forms/IconButton.tsx';
import { InfoHint } from '../tooltip/InfoHint.tsx';
import { Tooltip } from '../tooltip/Tooltip.tsx';
import { useDialogFocus } from '../use-dialog-focus.ts';
import { CreateTaskFields } from './CreateTaskFields.tsx';
import {
  creatableSpaces,
  defaultCreateSpace,
  draftForSpace,
  keepValidInSpace,
  readLastCreateSpace,
  writeLastCreateSpace,
} from './create-space.ts';
import {
  emptyDraft,
  errorsByField,
  keepForAnother,
  toCreateBody,
  type CreateErrors,
  type CreateTaskDraft,
} from './create-task-form.ts';
import './create-task.css';
import './create-task-hints.css';

/** One step after the create that did not land, in two voices. */
export interface FailedStep {
  /** For the toast's sentence: `could not add it to Sprint 4`. */
  readonly what: string;
  /** The server's own words. */
  readonly said: string;
}

export interface CreateOutcome {
  readonly task: Task;
  readonly failed: readonly FailedStep[];
  /** The space it was created in — the dialog's Space field, at the moment of Create. */
  readonly slug: string;
}

export interface CreateTaskDialogProps {
  /** The space to start in, already known to be one the reader may create in. */
  readonly initialSlug: string | undefined;
  /** The space on screen, if any — the default when nothing was asked for. */
  readonly currentSlug: string | undefined;
  readonly me: MeProfile | undefined;
  readonly initialStatusId: string | undefined;
  readonly onClose: () => void;
  readonly onCreated: (outcome: CreateOutcome) => void;
  readonly restore: () => HTMLElement | null | undefined;
}

const NO_ERRORS: CreateErrors = { fields: {} };

/** The email local part — what `@` resolves on the server (§4.19). */
function handleOf(email: string | undefined): string | null {
  if (email === undefined) return null;
  const at = email.indexOf('@');
  return at > 0 ? email.slice(0, at).toLowerCase() : null;
}

function said(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'The server did not say why.';
}

/**
 * The Create task dialog (LAI-1167, D-145): a centred modal over the dimmed
 * space, a full-height sheet on a phone; the body scrolls, the footer stays.
 *
 * ## The order of a create
 *
 * `POST /projects/:slug/tasks` carries everything the body can — a failure
 * there lays its `422` onto the fields and keeps the form as it was. The
 * sprint and the blockers are **set after**, one call each: a failure there
 * cannot undo the create, so the task exists and the dialog closes exactly as
 * on success, and the toast says *created, but…* with the server's sentence.
 * Leaving the form filled would invite the one thing worse than a task without
 * its sprint — the same task twice.
 *
 * ## Keys
 *
 * Enter in the Title creates; from any other one-line field it does nothing,
 * so filling in a date cannot submit a half-finished form. ⌘/Ctrl+Enter
 * creates from anywhere, the editors included — they are embedded and let it
 * through. Escape closes unless something inside used it first (an open
 * menu). Tab stays inside (`useDialogFocus`); focus lands on the Title and
 * goes back to whatever opened the dialog.
 */
export function CreateTaskDialog({
  initialSlug,
  currentSlug,
  me,
  initialStatusId,
  onClose,
  onCreated,
  restore,
}: CreateTaskDialogProps) {
  const confirm = useConfirm();
  const box = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);
  const descriptionRef = useRef<RichEditorHandle | null>(null);
  const acceptanceRef = useRef<RichEditorHandle | null>(null);
  const titleId = useId();

  // ------------------------------------------------------------- the space
  /*
   * **The Space field** (LAI-1227): every space whose `task.create` the
   * server grants this reader, read when the dialog opens. The field starts
   * on what the opener asked for (already checked by the provider, so the
   * form is ready at once on a space's screen), else the space on screen, the
   * last space created in, or the first allowed (`defaultCreateSpace`).
   */
  const gates = useGates(me !== undefined);
  const { all: allSpaces, loaded: spacesLoaded } = useSpaces(true);
  const allowed = useMemo(
    () => creatableSpaces(allSpaces, (id) => gates.project(id, 'task.create')),
    [allSpaces, gates],
  );
  const [chosen, setChosen] = useState<string | undefined>(initialSlug);
  useEffect(() => {
    if (chosen !== undefined || allowed.length === 0) return;
    const storage = (() => {
      try {
        return window.localStorage;
      } catch {
        return undefined;
      }
    })();
    setChosen(
      defaultCreateSpace({ current: currentSlug, last: readLastCreateSpace(storage), allowed }),
    );
  }, [chosen, allowed, currentSlug]);
  const slug = chosen;
  const space = allowed.find((s) => s.slug === slug);

  const [draft, setDraft] = useState<CreateTaskDraft>(() => ({
    ...emptyDraft(),
    statusId: initialStatusId,
  }));
  const [errors, setErrors] = useState<CreateErrors>(NO_ERRORS);
  const [busy, setBusy] = useState(false);
  const [another, setAnother] = useState(false);
  /** Bumped on *Create another*, so both editors start from nothing again. */
  const [editorKey, setEditorKey] = useState(0);

  useDialogFocus(box, { initial: () => titleRef.current, restore });

  // *Create another*: the editors have been remounted and the Title is enabled
  // again — the next thing to do is type the next title.
  useEffect(() => {
    if (editorKey > 0) titleRef.current?.focus();
  }, [editorKey]);

  /*
   * A refusal puts focus on the first field it names — after the render that
   * marks it (review round 1: a microtask ran before `aria-invalid` existed
   * and before the controls were enabled again, and focus fell to `<body>`).
   * A control first; a group — an editor, the tag picker — only when no
   * control is marked, through the editor's handle or its first button.
   */
  useEffect(() => {
    if (Object.keys(errors.fields).length === 0) return;
    const marked = [...(box.current?.querySelectorAll<HTMLElement>('[aria-invalid="true"]') ?? [])];
    const control = marked.find((el) => el.matches('input, textarea, select, button'));
    if (control !== undefined) {
      control.focus();
      return;
    }
    const group = marked[0];
    if (group === undefined) return;
    if (group.dataset.ctEditor === 'description') descriptionRef.current?.focus();
    else if (group.dataset.ctEditor === 'acceptance') acceptanceRef.current?.focus();
    else group.querySelector<HTMLElement>('input, button, textarea')?.focus();
  }, [errors]);

  /*
   * Close, asking first when something has been typed (review round 1): an
   * Escape or a click past the box is easy to make by accident, and a filled
   * form thrown away is the one thing this dialog must not do silently. An
   * empty draft closes at once.
   */
  const requestClose = async (): Promise<void> => {
    if (busy) return;
    const typed =
      draft.title.trim() !== '' ||
      !(descriptionRef.current?.empty() ?? true) ||
      !(acceptanceRef.current?.empty() ?? true);
    if (typed) {
      const discard = await confirm({
        title: 'Discard this task?',
        body: 'Nothing has been created yet. What you typed here will be lost.',
        confirmLabel: 'Discard',
        cancelLabel: 'Keep editing',
        danger: true,
      });
      if (!discard) return;
    }
    onClose();
  };

  // ---------------------------------------------------------------- loading
  /*
   * Everything below belongs to **the chosen space** and is read again when
   * the Space field changes: its statuses, tasks (Parent, Blocked by),
   * sprints, members (Assignee, mentions), labels and whether it allows
   * agents. Each read is keyed by the slug and aborted when it changes, so an
   * answer for the old space can never land on the new one.
   */
  const statuses = useProjectStatuses(slug);
  const snapshot = useProjectTasks(slug);
  const agents = useMyAgents();
  const [sprints, setSprints] = useState<readonly Sprint[] | undefined>(undefined);
  const [members, setMembers] = useState<readonly Member[] | undefined>(undefined);
  const [tags, setTags] = useState<readonly ProjectTag[]>([]);
  const [agentsAllowed, setAgentsAllowed] = useState(true);
  /** The space's own colour and key (LAI-1209), and its id for the agent picker. */
  const [project, setProject] = useState<Project | undefined>(undefined);

  // A value the space cannot take is replaced, not left to a 422: a status
  // not among its statuses becomes its default (shown in the control before
  // the create, so the person can see where it goes), an assignee not among
  // its members becomes nobody.
  useEffect(() => {
    setDraft((d) => keepValidInSpace(d, { statuses: statuses.all, members }));
  }, [statuses.all, members]);

  useEffect(() => {
    if (slug === undefined) return;
    const controller = new AbortController();
    setSprints(undefined);
    setMembers(undefined);
    setTags([]);
    setProject(undefined);
    setAgentsAllowed(true);
    listMembers(slug, controller.signal)
      .then((list) => {
        if (!controller.signal.aborted) setMembers(list.members);
      })
      .catch(() => {
        // Nobody to assign beats a wrong list; the task can still be made.
        if (!controller.signal.aborted) setMembers([]);
      });
    listProjectTags(slug, controller.signal)
      .then((list) => {
        if (!controller.signal.aborted) setTags(list);
      })
      .catch(() => {
        // The picker offers only what is typed.
      });
    everyPage((cursor) =>
      listSprints(slug, cursor === undefined ? {} : { cursor }, controller.signal),
    )
      .then(({ items }) => {
        if (!controller.signal.aborted) setSprints(items);
      })
      .catch(() => {
        // The field offers *No sprint* alone; the task can still be made.
        if (!controller.signal.aborted) setSprints([]);
      });
    getProject(slug, controller.signal)
      .then((project) => {
        if (controller.signal.aborted) return;
        setAgentsAllowed(project.agents_allowed);
        setProject(project);
      })
      .catch(() => {
        // Unknown is read as allowed; the server judges the pick on create.
      });
    return () => {
      controller.abort();
    };
  }, [slug]);

  const spaceId = project?.id ?? space?.id;
  const people = useMemo<readonly MentionCandidate[]>(
    () => (members ?? []).map((m) => ({ id: m.user_id, name: m.name, handle: handleOf(m.email) })),
    [members],
  );
  const agentChoices = useMemo(
    () =>
      agents.kind === 'ready' && spaceId !== undefined
        ? pickerChoices({
            agents: agents.agents,
            ownerName: me?.name ?? 'You',
            projectId: spaceId,
            agentsAllowed,
            current: null,
            now: Date.now(),
          })
        : undefined,
    [agents, spaceId, me, agentsAllowed],
  );

  /*
   * **No stale submit**: Create waits until the chosen space's statuses,
   * members and sprints have arrived — the reads that decide what the form
   * may send — so a Create pressed just after a change of space cannot carry
   * the old space's values.
   */
  const ready =
    slug !== undefined &&
    statuses.status !== 'loading' &&
    members !== undefined &&
    sprints !== undefined;

  // ----------------------------------------------------------------- submit
  const submit = async (): Promise<void> => {
    if (busy || slug === undefined || !ready) return;
    const title = draft.title.trim();
    if (title === '') {
      setErrors({ fields: { title: 'Give it a title.' } });
      return;
    }
    for (const [key, value] of [
      ['dueOn', draft.dueOn],
      ['plannedStart', draft.plannedStart],
    ] as const) {
      if (value !== '' && dateInputToMs(value) === null) {
        setErrors({ fields: { [key]: 'Not a date.' } });
        return;
      }
    }
    // A file still on its way would not be linked by what the editor says
    // now (D-150): the form waits for it rather than creating without it.
    for (const [field, editor] of [
      ['description', descriptionRef.current],
      ['acceptance', acceptanceRef.current],
    ] as const) {
      if (editor?.uploading() === true) {
        setErrors({
          fields: { [field]: 'A file is still uploading — create the task when it has arrived.' },
        });
        return;
      }
    }
    // The editors, read now: one that cannot write its document has dropped
    // to Markdown with the reason, and the field says so beside it.
    const description = descriptionRef.current?.read() ?? { ok: true as const, markdown: '' };
    if (!description.ok) {
      setErrors({ fields: { description: `Not sent: ${description.reason}` } });
      return;
    }
    const acceptance = acceptanceRef.current?.read() ?? { ok: true as const, markdown: '' };
    if (!acceptance.ok) {
      setErrors({ fields: { acceptance: `Not sent: ${acceptance.reason}` } });
      return;
    }

    const body = toCreateBody({
      ...draft,
      description: description.markdown,
      acceptance: acceptance.markdown,
    });
    setBusy(true);
    setErrors(NO_ERRORS);

    let task: Task;
    try {
      task = await createTask(slug, body);
    } catch (cause) {
      // The form stays as it was: a refusal must never cost what was typed.
      setErrors(errorsByField(cause));
      setBusy(false);
      return;
    }

    const failed: FailedStep[] = [];
    if (draft.sprintId !== null) {
      const name = sprints?.find((s) => s.id === draft.sprintId)?.name ?? 'the sprint';
      try {
        await addTasksToSprint(draft.sprintId, [task.id]);
      } catch (cause) {
        failed.push({ what: `could not add it to ${name}`, said: said(cause) });
      }
    }
    for (const blockerId of draft.blockedBy) {
      const key = snapshot?.byId.get(blockerId)?.key ?? 'a task';
      try {
        await addDependency(task.id, blockerId);
      } catch (cause) {
        failed.push({ what: `could not mark it blocked by ${key}`, said: said(cause) });
      }
    }
    // The board and the List read the project's one task set: walking it
    // again is what puts the new card on screen, whatever the steps above did.
    reloadProjectTasks(slug);
    try {
      writeLastCreateSpace(window.localStorage, slug);
    } catch {
      // Not remembered; the next Create starts where it can.
    }
    setBusy(false);
    onCreated({ task, failed, slug });

    if (another) {
      setDraft(keepForAnother(draft));
      // Also what puts focus back on the Title (the effect below): now, the
      // field is still disabled by `busy` until this render commits.
      setEditorKey((k) => k + 1);
      setErrors(NO_ERRORS);
    } else {
      onClose();
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      // A control inside that uses Escape itself (an open menu) has had it first.
      if (event.defaultPrevented) return;
      if (!(event.target instanceof Node) || box.current?.contains(event.target) !== true) return;
      event.preventDefault();
      void requestClose();
      return;
    }
    if (event.key !== 'Enter') return;
    if (event.metaKey || event.ctrlKey) {
      event.preventDefault();
      void submit();
      return;
    }
    // Implicit submission from the Title only: a date, an outside id or the
    // *Create another* box is filled in, not sent. An input inside an editor
    // (the link popover's address) is the editor's and handles Enter itself.
    if (
      event.target instanceof HTMLInputElement &&
      event.target !== titleRef.current &&
      event.target.closest('.rich-editor') === null
    ) {
      event.preventDefault();
    }
  };

  const canCreate = draft.title.trim() !== '' && !busy && ready;
  // Said beside the button, not left to a greyed shape (LAI-1209). Busy is
  // its own state — the spinner says it — so it carries no reason.
  const whyNot = busy
    ? undefined
    : slug === undefined
      ? 'Choose a space to create in'
      : !ready
        ? `Loading ${space?.name ?? 'the space'}…`
        : draft.title.trim() === ''
          ? 'Add a title to create'
          : undefined;

  return createPortal(
    <>
      <div
        className="ct-scrim"
        aria-hidden="true"
        onClick={() => {
          void requestClose();
        }}
      />
      <div
        ref={box}
        className="ct-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy || undefined}
        data-dialog="create-task"
        onKeyDown={onKeyDown}
      >
        <form
          className="ct-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <header className="ct-head">
            <div className="ct-titles">
              <h2 className="ct-title" id={titleId}>
                Create task
              </h2>
            </div>
            <IconButton
              icon="close"
              label="Close"
              shortcut="Escape"
              size="sm"
              onClick={() => {
                void requestClose();
              }}
            />
          </header>

          <div className="ct-body">
            {/*
              The Space field (LAI-1227) replaces the fixed *in <space>* line:
              the dialog opens from the header on any screen, so where the task
              goes is the first thing the form asks, as Jira's does.
            */}
            <Field label="Space" icon="spaces-more" required>
              {({ inputId, describedBy, invalid }) => (
                <Dropdown
                  id={inputId}
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                  className="ct-space-field"
                  noun="spaces"
                  value={slug ?? ''}
                  placeholder={spacesLoaded ? 'No space' : 'Finding spaces…'}
                  // The chosen space as its chip (LAI-1209's): its mark (D-152), name —
                  // cut, never wrapped — and key. The list draws the same three.
                  display={
                    space === undefined ? undefined : (
                      <span className="ct-space-chip" data-space-chip>
                        <ProjectMark project={space} className="ct-space-mark" />
                        <span className="ct-space">{space.name}</span>
                        <span className="ct-space-key">{space.key}</span>
                      </span>
                    )
                  }
                  disabled={busy || allowed.length === 0}
                  options={allowed.map((s) => ({
                    value: s.slug,
                    label: s.name,
                    detail: s.key,
                    keywords: `${s.key} ${s.slug}`,
                    icon: <ProjectMark project={s} className="ct-space-mark" />,
                  }))}
                  onChange={(next) => {
                    if (next === slug) return;
                    setChosen(next);
                    setDraft((d) => draftForSpace(d));
                    setErrors(NO_ERRORS);
                  }}
                />
              )}
            </Field>
            {spacesLoaded && allowed.length === 0 && slug === undefined && (
              <p className="ct-form-error" role="alert" data-create-error>
                No space lets you create a task. Ask a space admin to add you.
              </p>
            )}
            {slug !== undefined && (
              <CreateTaskFields
                slug={slug}
                draft={draft}
                onChange={(patch) => {
                  setDraft((d) => ({ ...d, ...patch }));
                }}
                errors={errors.fields}
                busy={busy}
                onEscape={() => {
                  void requestClose();
                }}
                titleRef={titleRef}
                descriptionRef={descriptionRef}
                acceptanceRef={acceptanceRef}
                editorKey={editorKey}
                people={people}
                meId={me?.id}
                members={members ?? []}
                knownTags={tags}
                statuses={statuses.all}
                sprints={sprints}
                agents={agentChoices}
                tasks={snapshot?.tasks}
              />
            )}
            {errors.form !== undefined && (
              <p className="ct-form-error" role="alert" data-create-error>
                {errors.form}
              </p>
            )}
          </div>

          <footer className="ct-foot">
            <span className="ct-another-wrap">
              <label className="checkbox ct-another">
                <input
                  type="checkbox"
                  className="checkbox-input"
                  checked={another}
                  disabled={busy}
                  onChange={(event) => {
                    setAnother(event.target.checked);
                  }}
                />
                <span className="checkbox-label">Create another</span>
              </label>
              <InfoHint label="About Create another">
                Keeps this dialog open after Create, with the same status, priority, assignee and
                sprint, so the next task starts where this one left off.
              </InfoHint>
            </span>
            <span className="ct-foot-actions">
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  void requestClose();
                }}
              >
                Cancel
              </Button>
              <Tooltip content="Create" shortcut="Mod+Enter" side="top">
                <Button type="submit" busy={busy} disabled={!canCreate} disabledReason={whyNot}>
                  Create
                </Button>
              </Tooltip>
            </span>
          </footer>
        </form>
      </div>
    </>,
    document.body,
  );
}
