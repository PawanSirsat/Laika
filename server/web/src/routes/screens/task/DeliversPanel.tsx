import { useState } from 'react';
import { ApiError } from '../../../api/errors.ts';
import type {
  Deliverable,
  DeliverableEdit,
  DeliverableState,
  Task,
  TaskEdit,
  TaskSummary,
} from '../../../api/tasks.ts';
import { blocksLine, hasDelivers, linesOf, progressLine, STATE_WORDS } from './delivers-derive.ts';
import { Spinner } from '../../../components/Spinner.tsx';
import { Icon } from '../../../components/icon/Icon.tsx';
import { Tooltip } from '../../../components/tooltip/Tooltip.tsx';
import './delivers.css';

export interface DeliversPanelProps {
  /** The task in full — the lists come with the texts (LAI-795, LAI-1115). */
  readonly task: Task;
  readonly status: TaskSummary['status'];
  readonly blocks: readonly string[];
  readonly byId: ReadonlyMap<string, TaskSummary>;
  readonly mayEdit: boolean;
  /** One `PATCH` with only the lists that changed; answers the task. */
  readonly onSave: (edit: TaskEdit) => Promise<void>;
  readonly onOpen: (taskId: string) => void;
}

/** Keys for rows added in an edit, unique for the page's life. */
let newRows = 0;

const NEXT: Record<DeliverableState, DeliverableState> = {
  pending: 'in_progress',
  in_progress: 'done',
  done: 'pending',
};

interface Draft {
  readonly items: readonly (DeliverableEdit & {
    readonly key: string;
    readonly state: DeliverableState;
  })[];
  readonly solves: string;
  readonly unlocks: string;
}

function draftOf(task: Task): Draft {
  return {
    items: (task.deliverables ?? []).map((d) => ({
      key: d.id,
      id: d.id,
      title: d.title,
      detail: d.detail,
      state: d.state,
    })),
    solves: (task.solves ?? []).join('\n'),
    unlocks: (task.unlocks ?? []).join('\n'),
  };
}

/** The state's drawn mark. Its words are beside it for a screen reader, and in a tooltip with `tip`. */
function Mark({
  state,
  tip = false,
}: {
  readonly state: DeliverableState;
  readonly tip?: boolean;
}) {
  const mark = <span className={`dl-mark dl-mark-${state}`} aria-hidden="true" />;
  return tip ? (
    <Tooltip content={STATE_WORDS[state]} lazy>
      {mark}
    </Tooltip>
  ) : (
    mark
  );
}

/**
 * **What this delivers** (§4.5, §11.4.2.1, LAI-1115, D-129): the Ships list
 * with a mark per state and the progress line, then what it solves and what
 * it unlocks. Drawn only when the server sent the lists and one of them holds
 * something (D-032) — except for someone who may edit, who is offered to add
 * them.
 */
export function DeliversPanel({
  task,
  status,
  blocks,
  byId,
  mayEdit,
  onSave,
  onOpen,
}: DeliversPanelProps) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  if (task.deliverables === undefined) return null;
  const items: readonly Deliverable[] = task.deliverables;
  const any = hasDelivers(task);
  if (!any && !mayEdit) return null;

  const line = progressLine(items, status);
  const blocking = blocksLine(blocks, byId);

  const save = async (): Promise<void> => {
    if (draft === null) return;
    const before = draftOf(task);
    const edit: { -readonly [K in keyof TaskEdit]: TaskEdit[K] } = {};
    const nextItems = draft.items
      .filter((d) => d.title.trim() !== '')
      .map(({ key: _key, ...item }) => ({ ...item, title: item.title.trim() }));
    if (JSON.stringify(nextItems) !== JSON.stringify(before.items.map(({ key: _k, ...i }) => i))) {
      edit.deliverables = nextItems;
    }
    if (draft.solves !== before.solves) edit.solves = linesOf(draft.solves);
    if (draft.unlocks !== before.unlocks) edit.unlocks = linesOf(draft.unlocks);
    if (Object.keys(edit).length === 0) {
      setDraft(null);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await onSave(edit);
      setDraft(null);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not save that. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (draft !== null) {
    return (
      <section className="dl dl-editing" data-section="delivers" aria-label="What this delivers">
        <div className="dl-head">
          <h3 className="dl-title">
            <Icon name="flag" size="small" className="section-mark" />
            What this delivers
          </h3>
        </div>
        <form
          className="dl-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <fieldset className="dl-fieldset">
            <legend className="dl-col-title">Ships</legend>
            <ol className="dl-edit-list">
              {draft.items.map((item, i) => (
                <li key={item.key} className="dl-edit-row">
                  <Tooltip content={`${STATE_WORDS[item.state]} — change`}>
                    <button
                      type="button"
                      className="dl-state-toggle"
                      aria-label={`${item.title || 'This item'}: ${STATE_WORDS[item.state]}. Change`}
                      onClick={() => {
                        setDraft({
                          ...draft,
                          items: draft.items.map((d, j) =>
                            j === i ? { ...d, state: NEXT[d.state] } : d,
                          ),
                        });
                      }}
                    >
                      <Mark state={item.state} />
                    </button>
                  </Tooltip>
                  <input
                    className="dl-input"
                    aria-label="What it ships"
                    value={item.title}
                    maxLength={200}
                    onChange={(event) => {
                      const title = event.currentTarget.value;
                      setDraft({
                        ...draft,
                        items: draft.items.map((d, j) => (j === i ? { ...d, title } : d)),
                      });
                    }}
                  />
                  <Tooltip content="Remove">
                    <button
                      type="button"
                      className="dl-remove"
                      aria-label={`Remove ${item.title || 'this item'}`}
                      onClick={() => {
                        setDraft({ ...draft, items: draft.items.filter((_, j) => j !== i) });
                      }}
                    >
                      <Icon name="close" size="tiny" />
                    </button>
                  </Tooltip>
                </li>
              ))}
            </ol>
            <button
              type="button"
              className="dl-add"
              disabled={draft.items.length >= 20}
              aria-describedby={draft.items.length >= 20 ? 'dl-add-reason' : undefined}
              onClick={() => {
                newRows += 1;
                setDraft({
                  ...draft,
                  items: [
                    ...draft.items,
                    { key: `new-${String(newRows)}`, title: '', state: 'pending' },
                  ],
                });
              }}
            >
              + Add what it ships
            </button>
            {draft.items.length >= 20 && (
              <span className="dl-none" id="dl-add-reason">
                Twenty is the most this list takes here — split the rest into another task.
              </span>
            )}
          </fieldset>
          <label className="dl-fieldset">
            <span className="dl-col-title">Solves</span>
            <textarea
              className="dl-textarea"
              rows={3}
              value={draft.solves}
              placeholder="One problem per line"
              onChange={(event) => {
                setDraft({ ...draft, solves: event.currentTarget.value });
              }}
            />
          </label>
          <label className="dl-fieldset">
            <span className="dl-col-title">Unlocks</span>
            <textarea
              className="dl-textarea"
              rows={3}
              value={draft.unlocks}
              placeholder="One line each — name a decision when it is one"
              onChange={(event) => {
                setDraft({ ...draft, unlocks: event.currentTarget.value });
              }}
            />
          </label>
          {error !== undefined && (
            <p className="dl-error" role="alert">
              {error}
            </p>
          )}
          <div className="dl-form-actions">
            <button type="submit" className="dl-save" disabled={busy}>
              {busy && <Spinner size="sm" />}
              Save
            </button>
            <button
              type="button"
              className="dl-cancel"
              disabled={busy}
              onClick={() => {
                setDraft(null);
                setError(undefined);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      </section>
    );
  }

  if (!any) {
    return (
      <section className="dl dl-empty" data-section="delivers" aria-label="What this delivers">
        <button
          type="button"
          className="dl-add"
          onClick={() => {
            setDraft(draftOf(task));
          }}
        >
          + Say what this delivers
        </button>
      </section>
    );
  }

  return (
    <section className="dl" data-section="delivers" aria-label="What this delivers">
      <div className="dl-head">
        <h3 className="dl-title">
          <Icon name="flag" size="small" className="section-mark" />
          What this delivers
        </h3>
        {line !== null && <span className="dl-progress">{line}</span>}
        {mayEdit && (
          <button
            type="button"
            className="dl-edit"
            onClick={() => {
              setDraft(draftOf(task));
            }}
          >
            Edit
          </button>
        )}
      </div>
      <div className="dl-cols">
        <div className="dl-col">
          <span className="dl-col-title">Ships</span>
          {items.length === 0 ? (
            <span className="dl-none">Not stated.</span>
          ) : (
            <ul className="dl-items">
              {items.map((d) => (
                <li key={d.id} className="dl-item" data-state={d.state}>
                  <Mark state={d.state} tip />
                  <span className="dl-item-text">
                    <span className="dl-item-title">{d.title}</span>
                    <span className="visually-hidden"> — {STATE_WORDS[d.state]}</span>
                    {d.detail !== null && <span className="dl-item-detail">{d.detail}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="dl-col">
          <span className="dl-col-title">Solves</span>
          {(task.solves ?? []).length === 0 ? (
            <span className="dl-none">Not stated.</span>
          ) : (
            (task.solves ?? []).map((line, i) => (
              <span key={i} className="dl-point">
                {line}
              </span>
            ))
          )}
        </div>
        <div className="dl-col">
          <span className="dl-col-title">Unlocks</span>
          {(task.unlocks ?? []).map((line, i) => (
            <span key={i} className="dl-point">
              {line}
            </span>
          ))}
          {blocking.kind === 'none' ? (
            <span className="dl-none">Blocks no other tasks.</span>
          ) : (
            <span className="dl-blocks">
              Blocks{' '}
              {blocking.tasks.map((t, i) => (
                <span key={t.id}>
                  {i > 0 && ', '}
                  <Tooltip content={t.title} lazy>
                    <button
                      type="button"
                      className="dl-task-link"
                      onClick={() => {
                        onOpen(t.id);
                      }}
                    >
                      {t.key}
                    </button>
                  </Tooltip>
                </span>
              ))}
              {blocking.unknown > 0 &&
                `${blocking.tasks.length > 0 ? ' and ' : ''}${String(blocking.unknown)} more`}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
