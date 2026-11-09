import { useId, useRef, useState, type ReactNode, type Ref, type RefObject } from 'react';
import { effortWord, SIZE_LEVELS } from '../../api/estimates.ts';
import type { Sprint } from '../../api/sprints.ts';
import type { ProjectStatus } from '../../api/statuses.ts';
import type { ProjectTag } from '../../api/tags.ts';
import { PRIORITIES, type Member, type TaskSummary } from '../../api/tasks.ts';
import { assigneeOptions } from '../../routes/screens/board/assignee-options.ts';
import { statusOptions } from '../../routes/screens/board/status-options.ts';
import { TagPicker } from '../../routes/screens/board/TagPicker.tsx';
import {
  LazyRichEditor,
  type MentionCandidate,
  type RichEditorHandle,
} from '../../routes/screens/task/LazyRichEditor.tsx';
import { priorityWords } from '../../routes/screens/task/rail-derive.ts';
import { AgentPicker, NO_AGENT, type AgentChoice } from '../agent/AgentPicker.tsx';
import { Dropdown } from '../Dropdown.tsx';
import { Field } from '../forms/Field.tsx';
import { PriorityIcon } from '../PriorityIcon.tsx';
import type { CreateTaskDraft, FieldKey } from './create-task-form.ts';

export interface CreateTaskFieldsProps {
  readonly slug: string;
  readonly draft: CreateTaskDraft;
  readonly onChange: (patch: Partial<CreateTaskDraft>) => void;
  readonly errors: Partial<Record<FieldKey, string>>;
  readonly busy: boolean;
  /** Escape inside an editor: the editors consume the key, so they say so. */
  readonly onEscape: () => void;
  readonly titleRef: RefObject<HTMLInputElement | null>;
  readonly descriptionRef: Ref<RichEditorHandle>;
  readonly acceptanceRef: Ref<RichEditorHandle>;
  /** Changes when the editors must start again from nothing. */
  readonly editorKey: number;
  readonly people: readonly MentionCandidate[];
  readonly meId: string | undefined;
  readonly members: readonly Member[];
  readonly knownTags: readonly ProjectTag[];
  readonly statuses: readonly ProjectStatus[];
  /** `undefined` while loading. */
  readonly sprints: readonly Sprint[] | undefined;
  /** `undefined` while loading. */
  readonly agents: readonly AgentChoice[] | undefined;
  /** The project's tasks, for Parent and Blocked by; `undefined` while loading. */
  readonly tasks: readonly TaskSummary[] | undefined;
}

/**
 * A field whose control labels itself (an editor, the tag picker, a list):
 * the `Field` wrapper's label would point at nothing, so this draws the same
 * shell with a heading the control is described by.
 */
function Labelled({
  label,
  error,
  children,
}: {
  readonly label: string;
  readonly error: string | undefined;
  readonly children: (ids: { readonly labelId: string; readonly errorId: string }) => ReactNode;
}) {
  const labelId = useId();
  const errorId = `${labelId}-error`;
  return (
    <div className={error === undefined ? 'field' : 'field field-invalid'}>
      <p className="field-label" id={labelId}>
        {label}
      </p>
      {children({ labelId, errorId })}
      <p className="field-error" id={errorId} role="status" aria-live="polite">
        {error}
      </p>
    </div>
  );
}

/** A task still open, by key then title — what a parent or a blocker may be. */
function openTasks(tasks: readonly TaskSummary[] | undefined): readonly TaskSummary[] {
  return (tasks ?? []).filter((t) => t.status !== 'done' && t.status !== 'cancelled');
}

/**
 * The dialog's fields (LAI-1167, D-145). Always: Title, Description, Status,
 * Priority, Assignee, Agent, Sprint, Due date, Labels. Under *More*:
 * Acceptance, What this delivers, Planned start, Effort, Parent, Blocked by,
 * Outside id — every field `POST /projects/:slug/tasks` takes, the sprint and
 * the blockers set after. Pure presentation over the draft: nothing here
 * talks to the server.
 */
export function CreateTaskFields({
  slug,
  draft,
  onChange,
  errors,
  busy,
  onEscape,
  titleRef,
  descriptionRef,
  acceptanceRef,
  editorKey,
  people,
  meId,
  members,
  knownTags,
  statuses,
  sprints,
  agents,
  tasks,
}: CreateTaskFieldsProps) {
  const [more, setMore] = useState(false);
  const deliverableSeq = useRef(0);
  const prio = priorityWords(draft.priority);

  const candidates = openTasks(tasks);
  const parents = candidates.filter((t) => t.parent_task_id === null);
  const blockers = candidates.filter((t) => !draft.blockedBy.includes(t.id));
  const byId = new Map((tasks ?? []).map((t) => [t.id, t]));
  const taskOption = (t: TaskSummary) => ({
    value: t.id,
    label: `${t.key} ${t.title}`,
    keywords: t.status_name,
  });

  return (
    <div className="ct-fields">
      <Field label="Title" required error={errors.title}>
        {({ inputId, describedBy, invalid }) => (
          <input
            ref={titleRef}
            id={inputId}
            className="input ct-title-input"
            type="text"
            value={draft.title}
            maxLength={300}
            placeholder="What needs doing?"
            disabled={busy}
            autoComplete="off"
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            aria-required="true"
            onChange={(event) => {
              onChange({ title: event.target.value });
            }}
          />
        )}
      </Field>

      <Labelled label="Description" error={errors.description}>
        {() => (
          <LazyRichEditor
            key={`description-${String(editorKey)}`}
            mode="embedded"
            handle={descriptionRef}
            onEscape={onEscape}
            value=""
            label="Description"
            placeholder="What this is about, for whoever picks it up."
            people={people}
            meId={meId}
            cards={[]}
          />
        )}
      </Labelled>

      <div className="ct-row">
        <Field label="Status" error={errors.status}>
          {({ inputId, describedBy, invalid }) => (
            <Dropdown
              id={inputId}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              noun="statuses"
              value={draft.statusId ?? ''}
              placeholder={statuses.length === 0 ? 'Loading…' : 'Default'}
              disabled={busy || statuses.length === 0}
              options={statusOptions(statuses)}
              onChange={(value) => {
                onChange({ statusId: value });
              }}
            />
          )}
        </Field>
        <Field label="Priority" error={errors.priority}>
          {({ inputId, describedBy, invalid }) => (
            <Dropdown
              id={inputId}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              noun="priorities"
              searchable={false}
              value={draft.priority}
              disabled={busy}
              display={
                <span className="dd-value">
                  <PriorityIcon priority={draft.priority} /> {prio.code} · {prio.word}
                </span>
              }
              options={PRIORITIES.map((p) => ({
                value: p,
                label: `${p.toUpperCase()} · ${priorityWords(p).word}`,
                icon: <PriorityIcon priority={p} />,
              }))}
              onChange={(value) => {
                onChange({ priority: value });
              }}
            />
          )}
        </Field>
      </div>

      <div className="ct-row">
        <Field label="Assignee" error={errors.assignee}>
          {({ inputId, describedBy, invalid }) => (
            <Dropdown
              id={inputId}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              noun="people"
              value={draft.assigneeId ?? ''}
              disabled={busy}
              options={assigneeOptions(members, meId)}
              onChange={(value) => {
                onChange({ assigneeId: value === '' ? null : value });
              }}
            />
          )}
        </Field>
        {/* The picker labels itself (its own *Agent* and the sentence under it), so
            only the field's shell and its error line are added here. */}
        <div
          className={errors.agent === undefined ? 'field ct-agent' : 'field ct-agent field-invalid'}
        >
          <AgentPicker
            agents={agents ?? []}
            value={draft.agentId ?? NO_AGENT}
            disabled={busy || agents === undefined}
            onChange={(id) => {
              onChange({ agentId: id === NO_AGENT ? null : id });
            }}
          />
          <p className="field-error" role="status" aria-live="polite">
            {errors.agent}
          </p>
        </div>
      </div>

      <div className="ct-row">
        <Field label="Sprint" error={errors.sprint}>
          {({ inputId, describedBy, invalid }) => (
            <Dropdown
              id={inputId}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              noun="sprints"
              value={draft.sprintId ?? ''}
              placeholder={sprints === undefined ? 'Loading…' : undefined}
              disabled={busy || sprints === undefined}
              options={[
                { value: '', label: 'No sprint', pinned: true },
                // A completed sprint takes nothing new (LAI-619's rule).
                ...(sprints ?? [])
                  .filter((s) => s.status !== 'completed')
                  .map((s) => ({
                    value: s.id,
                    label: s.name,
                    badge: s.status === 'active' ? 'Active' : undefined,
                  })),
              ]}
              onChange={(value) => {
                onChange({ sprintId: value === '' ? null : value });
              }}
            />
          )}
        </Field>
        <Field label="Due date" error={errors.dueOn}>
          {({ inputId, describedBy, invalid }) => (
            <input
              id={inputId}
              className="input ct-date"
              type="date"
              value={draft.dueOn}
              disabled={busy}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              onChange={(event) => {
                onChange({ dueOn: event.target.value });
              }}
            />
          )}
        </Field>
      </div>

      <Labelled label="Labels" error={errors.tags}>
        {() => (
          <TagPicker
            slug={slug}
            tags={draft.tags}
            mayEdit={!busy}
            known={knownTags}
            heading={false}
            onChange={(tags) => {
              onChange({ tags });
            }}
          />
        )}
      </Labelled>

      <details
        className="ct-more"
        open={more}
        onToggle={(event) => {
          setMore(event.currentTarget.open);
        }}
      >
        <summary className="ct-more-summary">
          <span className="ct-more-caret" aria-hidden="true">
            ▸
          </span>
          More
          <span className="ct-more-hint">
            acceptance, what it delivers, planned start, effort, parent, blockers, outside id
          </span>
        </summary>

        <div className="ct-more-body">
          <Labelled label="Acceptance" error={errors.acceptance}>
            {() => (
              <LazyRichEditor
                key={`acceptance-${String(editorKey)}`}
                mode="embedded"
                handle={acceptanceRef}
                onEscape={onEscape}
                value=""
                label="Acceptance"
                placeholder="How we will know it is done — one criterion per line."
                people={people}
                meId={meId}
                cards={[]}
              />
            )}
          </Labelled>

          <fieldset className="ct-delivers">
            <legend className="field-label">What this delivers</legend>
            <div className="ct-ships">
              <p className="ct-ships-head">Ships</p>
              {draft.deliverables.length > 0 && (
                <ol className="ct-ships-list">
                  {draft.deliverables.map((item, i) => (
                    <li key={item.key} className="ct-ships-row">
                      <input
                        className="input ct-ships-title"
                        aria-label="What it ships"
                        value={item.title}
                        maxLength={500}
                        disabled={busy}
                        onChange={(event) => {
                          const title = event.currentTarget.value;
                          onChange({
                            deliverables: draft.deliverables.map((d, j) =>
                              j === i ? { ...d, title } : d,
                            ),
                          });
                        }}
                      />
                      <button
                        type="button"
                        className="ct-ships-remove"
                        aria-label={`Remove ${item.title || 'this item'}`}
                        disabled={busy}
                        onClick={() => {
                          onChange({ deliverables: draft.deliverables.filter((_, j) => j !== i) });
                        }}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ol>
              )}
              <button
                type="button"
                className="ct-ships-add"
                disabled={busy || draft.deliverables.length >= 50}
                onClick={() => {
                  deliverableSeq.current += 1;
                  onChange({
                    deliverables: [
                      ...draft.deliverables,
                      { key: `d-${String(deliverableSeq.current)}`, title: '', detail: '' },
                    ],
                  });
                }}
              >
                + Add what it ships
              </button>
              {errors.deliverables !== undefined && (
                <p className="field-error" role="status">
                  {errors.deliverables}
                </p>
              )}
            </div>
            <div className="ct-row">
              <Field label="Solves" error={errors.solves} help="One problem per line.">
                {({ inputId, describedBy, invalid }) => (
                  <textarea
                    id={inputId}
                    className="input ct-lines"
                    rows={3}
                    value={draft.solves}
                    disabled={busy}
                    aria-describedby={describedBy}
                    aria-invalid={invalid || undefined}
                    onChange={(event) => {
                      onChange({ solves: event.target.value });
                    }}
                  />
                )}
              </Field>
              <Field label="Unlocks" error={errors.unlocks} help="One line each.">
                {({ inputId, describedBy, invalid }) => (
                  <textarea
                    id={inputId}
                    className="input ct-lines"
                    rows={3}
                    value={draft.unlocks}
                    disabled={busy}
                    aria-describedby={describedBy}
                    aria-invalid={invalid || undefined}
                    onChange={(event) => {
                      onChange({ unlocks: event.target.value });
                    }}
                  />
                )}
              </Field>
            </div>
          </fieldset>

          <div className="ct-row">
            <Field label="Planned start" error={errors.plannedStart}>
              {({ inputId, describedBy, invalid }) => (
                <input
                  id={inputId}
                  className="input ct-date"
                  type="date"
                  value={draft.plannedStart}
                  disabled={busy}
                  aria-describedby={describedBy}
                  aria-invalid={invalid || undefined}
                  onChange={(event) => {
                    onChange({ plannedStart: event.target.value });
                  }}
                />
              )}
            </Field>
            <Field label="Effort" error={errors.size} help="Laika estimates it when left unset.">
              {({ inputId, describedBy, invalid }) => (
                <Dropdown
                  id={inputId}
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                  noun="sizes"
                  searchable={false}
                  value={draft.size ?? ''}
                  disabled={busy}
                  options={[
                    { value: '', label: 'Estimated', pinned: true },
                    ...SIZE_LEVELS.map((level) => ({
                      value: level,
                      label: `${level} · ${effortWord(level)}`,
                    })),
                  ]}
                  onChange={(value) => {
                    onChange({ size: value === '' ? undefined : value });
                  }}
                />
              )}
            </Field>
          </div>

          <div className="ct-row">
            <Field label="Parent" error={errors.parent}>
              {({ inputId, describedBy, invalid }) => (
                <Dropdown
                  id={inputId}
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                  noun="tasks"
                  searchable
                  value={draft.parentId ?? ''}
                  disabled={busy || tasks === undefined}
                  placeholder={tasks === undefined ? 'Loading…' : undefined}
                  options={[
                    { value: '', label: 'None', pinned: true },
                    // One level only (D-066): a child cannot be a parent.
                    ...parents.map(taskOption),
                  ]}
                  onChange={(value) => {
                    onChange({ parentId: value === '' ? null : value });
                  }}
                />
              )}
            </Field>
            <Field label="Blocked by" error={errors.blockedBy}>
              {({ inputId, describedBy, invalid }) => (
                <div className="ct-blockers">
                  <Dropdown
                    id={inputId}
                    aria-describedby={describedBy}
                    aria-invalid={invalid}
                    noun="tasks"
                    searchable
                    value=""
                    placeholder={tasks === undefined ? 'Loading…' : 'Add a blocker'}
                    disabled={busy || tasks === undefined}
                    options={blockers.map(taskOption)}
                    onChange={(value) => {
                      if (value !== '' && !draft.blockedBy.includes(value)) {
                        onChange({ blockedBy: [...draft.blockedBy, value] });
                      }
                    }}
                  />
                  {draft.blockedBy.length > 0 && (
                    <ul className="ct-chips" aria-label="Chosen blockers">
                      {draft.blockedBy.map((id) => {
                        const task = byId.get(id);
                        const name = task === undefined ? id : task.key;
                        return (
                          <li key={id} className="ct-chip" title={task?.title}>
                            {name}
                            <button
                              type="button"
                              className="ct-chip-remove"
                              aria-label={`Remove ${name}`}
                              disabled={busy}
                              onClick={() => {
                                onChange({ blockedBy: draft.blockedBy.filter((b) => b !== id) });
                              }}
                            >
                              ×
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </Field>
          </div>

          <Field
            label="Outside id"
            error={errors.externalRef}
            help="A key from another tracker, such as a Jira or GitHub id."
          >
            {({ inputId, describedBy, invalid }) => (
              <input
                id={inputId}
                className="input"
                type="text"
                value={draft.externalRef}
                maxLength={120}
                disabled={busy}
                autoComplete="off"
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
                onChange={(event) => {
                  onChange({ externalRef: event.target.value });
                }}
              />
            )}
          </Field>
        </div>
      </details>
    </div>
  );
}
