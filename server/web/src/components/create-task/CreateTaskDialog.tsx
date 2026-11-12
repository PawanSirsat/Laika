import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { dateInputToMs } from '../../api/date-only.ts';
import { everyPage } from '../../api/every-page.ts';
import type { MeProfile } from '../../api/me.ts';
import { getProject, type Project } from '../../api/projects.ts';
import { pickerChoices } from '../../api/selected-agent.ts';
import { addTasksToSprint, listSprints, type Sprint } from '../../api/sprints.ts';
import type { ProjectTag } from '../../api/tags.ts';
import { addDependency, createTask, type Member, type Task } from '../../api/tasks.ts';
import { useMyAgents } from '../../api/use-my-agents.ts';
import { reloadProjectTasks, useProjectTasks } from '../../api/use-project-tasks.ts';
import { useProjectStatuses } from '../../api/use-statuses.ts';
import type {
  MentionCandidate,
  RichEditorHandle,
} from '../../routes/screens/task/LazyRichEditor.tsx';
import { useConfirm } from '../ConfirmProvider.tsx';
import { Button } from '../forms/Button.tsx';
import { IconButton } from '../forms/IconButton.tsx';
import { useShell } from '../shell/shell-context.ts';
import { InfoHint } from '../tooltip/InfoHint.tsx';
import { Tooltip } from '../tooltip/Tooltip.tsx';
import { spaceColor } from '../../theme/space-color.ts';
import { useDialogFocus } from '../use-dialog-focus.ts';
import { CreateTaskFields } from './CreateTaskFields.tsx';
import {
  defaultStatusId,
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
}

export interface CreateTaskDialogProps {
  readonly slug: string;
  readonly spaceId: string | undefined;
  readonly members: readonly Member[];
  readonly tags: readonly ProjectTag[];
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
  slug,
  spaceId,
  members,
  tags,
  me,
  initialStatusId,
  onClose,
  onCreated,
  restore,
}: CreateTaskDialogProps) {
  const { spaceName } = useShell();
  const confirm = useConfirm();
  const box = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);
  const descriptionRef = useRef<RichEditorHandle | null>(null);
  const acceptanceRef = useRef<RichEditorHandle | null>(null);
  const titleId = useId();

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
  const statuses = useProjectStatuses(slug);
  const snapshot = useProjectTasks(slug);
  const agents = useMyAgents();
  const [sprints, setSprints] = useState<readonly Sprint[] | undefined>(undefined);
  const [agentsAllowed, setAgentsAllowed] = useState(true);
  /** For the header's chip: the space's own colour and key (LAI-1209). */
  const [project, setProject] = useState<Project | undefined>(undefined);

  // Where it goes when nothing is chosen: shown in the control before the
  // create, so the person can see it, rather than left to the server.
  useEffect(() => {
    if (statuses.all.length === 0) return;
    setDraft((d) =>
      d.statusId === undefined ? { ...d, statusId: defaultStatusId(statuses.all) } : d,
    );
  }, [statuses.all]);

  useEffect(() => {
    const controller = new AbortController();
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

  const people = useMemo<readonly MentionCandidate[]>(
    () => members.map((m) => ({ id: m.user_id, name: m.name, handle: handleOf(m.email) })),
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

  // ----------------------------------------------------------------- submit
  const submit = async (): Promise<void> => {
    if (busy) return;
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
    setBusy(false);
    onCreated({ task, failed });

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

  const canCreate = draft.title.trim() !== '' && !busy;
  // Said beside the button, not left to a greyed shape (LAI-1209). Busy is
  // its own state — the spinner says it — so it carries no reason.
  const whyNot = !busy && draft.title.trim() === '' ? 'Add a title to create' : undefined;
  const space = spaceName ?? project?.name;

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
              {space !== undefined && (
                <p className="ct-sub">
                  in{' '}
                  <span className="ct-space-chip" data-space-chip>
                    <span
                      className="ct-space-mark"
                      data-color={spaceColor({ slug, color: project?.color })}
                      aria-hidden="true"
                    >
                      {(space.trim()[0] ?? slug[0] ?? '?').toUpperCase()}
                    </span>
                    <span className="ct-space">{space}</span>
                    {project !== undefined && (
                      <span className="ct-space-key">{project.prefix}</span>
                    )}
                  </span>
                </p>
              )}
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
              members={members}
              knownTags={tags}
              statuses={statuses.all}
              sprints={sprints}
              agents={agentChoices}
              tasks={snapshot?.tasks}
            />
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
