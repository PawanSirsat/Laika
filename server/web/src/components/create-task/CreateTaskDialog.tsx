import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { dateInputToMs } from '../../api/date-only.ts';
import { everyPage } from '../../api/every-page.ts';
import type { MeProfile } from '../../api/me.ts';
import { getProject } from '../../api/projects.ts';
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
import { Button } from '../forms/Button.tsx';
import { useShell } from '../shell/shell-context.ts';
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

  // ---------------------------------------------------------------- loading
  const statuses = useProjectStatuses(slug);
  const snapshot = useProjectTasks(slug);
  const agents = useMyAgents();
  const [sprints, setSprints] = useState<readonly Sprint[] | undefined>(undefined);
  const [agentsAllowed, setAgentsAllowed] = useState(true);

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
        if (!controller.signal.aborted) setAgentsAllowed(project.agents_allowed);
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
  const focusFirstInvalid = (): void => {
    queueMicrotask(() => {
      box.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    });
  };

  const submit = async (): Promise<void> => {
    if (busy) return;
    const title = draft.title.trim();
    if (title === '') {
      setErrors({ fields: { title: 'Give it a title.' } });
      titleRef.current?.focus();
      return;
    }
    for (const [key, value] of [
      ['dueOn', draft.dueOn],
      ['plannedStart', draft.plannedStart],
    ] as const) {
      if (value !== '' && dateInputToMs(value) === null) {
        setErrors({ fields: { [key]: 'Not a date.' } });
        focusFirstInvalid();
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
      focusFirstInvalid();
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
      onClose();
      return;
    }
    if (event.key !== 'Enter') return;
    if (event.metaKey || event.ctrlKey) {
      event.preventDefault();
      void submit();
      return;
    }
    // Implicit submission from the Title only: a date or an outside id is
    // filled in, not sent.
    if (
      event.target instanceof HTMLInputElement &&
      event.target !== titleRef.current &&
      event.target.type !== 'checkbox'
    ) {
      event.preventDefault();
    }
  };

  const canCreate = draft.title.trim() !== '' && !busy;

  return createPortal(
    <>
      <div className="ct-scrim" aria-hidden="true" onClick={onClose} />
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
              {spaceName !== undefined && (
                <p className="ct-sub">
                  in <span className="ct-space">{spaceName}</span>
                </p>
              )}
            </div>
            <button type="button" className="ct-close" aria-label="Close" onClick={onClose}>
              <span aria-hidden="true">×</span>
            </button>
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
              onEscape={onClose}
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
            <span className="ct-foot-actions">
              <Button variant="secondary" disabled={busy} onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" busy={busy} disabled={!canCreate}>
                Create
              </Button>
            </span>
          </footer>
        </form>
      </div>
    </>,
    document.body,
  );
}
