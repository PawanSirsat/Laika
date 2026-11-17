import { Spinner } from '../../../components/Spinner.tsx';
import { useEffect, useRef, useState } from 'react';
import {
  listProjectTags,
  normaliseTagInput,
  readableRefusal,
  setTaskTags,
  MAX_TAGS_PER_TASK,
} from '../../../api/tags.ts';
import type { ProjectTag } from '../../../api/tags.ts';
import { Tooltip } from '../../../components/tooltip/Tooltip.tsx';
import { Icon } from '../../../components/icon/Icon.tsx';
import { DisabledReason } from '../../../components/tooltip/DisabledReason.tsx';
import { useAction } from '../../../components/toast/use-action.ts';
import './tag-picker.css';

interface TagPickerBase {
  readonly slug: string;
  readonly tags: readonly string[];
  /** False for a Viewer — they see the tags and get no way to change them. */
  readonly mayEdit: boolean;
}

/** On a task: every change is saved at once, and the server's list is the result. */
export interface TagPickerSavedProps extends TagPickerBase {
  readonly taskId: string;
  /** Called with the task the server returned, so the board can follow. */
  readonly onChanged: (tags: readonly string[]) => void;
  readonly onChange?: undefined;
  readonly known?: undefined;
  readonly heading?: undefined;
  readonly disabled?: undefined;
}

/**
 * Controlled, with no task yet (LAI-1167): the Create task dialog holds the
 * list and sends it with the create. Nothing is saved from here.
 */
export interface TagPickerControlledProps extends TagPickerBase {
  readonly taskId?: undefined;
  readonly onChanged?: undefined;
  readonly onChange: (tags: readonly string[]) => void;
  /** The project's tags, already fetched by the caller: no read of its own. */
  readonly known?: readonly ProjectTag[] | undefined;
  /** `false` when the caller labels the control itself (a `Field`). */
  readonly heading?: boolean | undefined;
  /** Drawn but locked — while the form around it is being sent. */
  readonly disabled?: boolean | undefined;
}

export type TagPickerProps = TagPickerSavedProps | TagPickerControlledProps;

/**
 * Apply and remove a task's tags (LAI-081).
 *
 * ## The server owns what a tag may be called
 *
 * D-027 put the naming rule in one place. This does not repeat it: it trims and
 * lower-cases what was typed — shaping, not judging — and shows whatever the
 * server says when it refuses. Its `422` is written to be read:
 *
 * > "has space" is not a valid tag: lowercase letters, digits and hyphens,
 * > starting with a letter or digit, up to 24 characters
 *
 * A regex here would be a second copy of that rule, and the copy is the one that
 * goes stale when the server tightens it.
 *
 * ## Each saved change says so (LAI-1310)
 *
 * On a task, adding or removing a label toasts what changed, with Undo that
 * sends the previous list back — the same call, so the server can always take
 * it. A refusal toasts too, and keeps its sentence under the field, where the
 * word that was refused is.
 */
export function TagPicker(props: TagPickerProps) {
  const { slug, tags, mayEdit } = props;
  const taskId = props.taskId;
  const given = props.known;
  const showHeading = props.heading !== false;
  const [draft, setDraft] = useState('');
  const [fetched, setFetched] = useState<readonly ProjectTag[]>([]);
  const known = given ?? fetched;
  const [busy, setBusy] = useState(false);
  /** Saving, or held by the caller: every control is locked, none goes away. */
  const locked = busy || props.disabled === true;
  const [error, setError] = useState<string | undefined>(undefined);
  const { run } = useAction();
  const inputRef = useRef<HTMLInputElement>(null);
  /*
   * **Closed until asked** (LAI-1123): the chips and a *+ Add* button; the
   * field, its button and the suggestions open on the press, focused, and
   * close on Escape — spent here, so the task drawer underneath stays open.
   */
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  useEffect(() => {
    // The caller's list stands in for the read (the dialog has it already).
    if (!mayEdit || given !== undefined) return;
    const controller = new AbortController();

    listProjectTags(slug, controller.signal)
      .then(setFetched)
      .catch(() => {
        // Only the suggestions are lost. Typing a tag still works, so this is
        // not worth an error state in front of the reader.
      });

    return () => {
      controller.abort();
    };
  }, [slug, mayEdit, tags, given]);

  const save = (next: readonly string[]): void => {
    if (taskId === undefined) {
      // Controlled: the list is the caller's; the server judges it on create.
      props.onChange(next);
      setDraft('');
      return;
    }
    const onChanged = props.onChanged;
    const before = tags;
    setBusy(true);
    setError(undefined);

    void run({
      do: () => setTaskTags(taskId, next),
      success: tagChangeLine(before, next),
      failure: 'Couldn’t change the labels',
      undo: async () => {
        const back = await setTaskTags(taskId, before);
        onChanged(back.tags);
        return 'Labels put back';
      },
      onError: (cause) => {
        // The server's own words, under the field as well. For a name that
        // breaks the rule its message names the tag and states the rule; for
        // a schema rejection it is generic, so the field issue is used instead
        // of showing "Invalid request body" to someone who typed one word.
        setError(readableRefusal(cause));
      },
    }).then((task) => {
      setBusy(false);
      if (task === undefined) return;
      onChanged(task.tags);
      setDraft('');
    });
  };

  const add = (raw: string): void => {
    const name = normaliseTagInput(raw);
    // Not validation — there is simply nothing to send. The rule is the
    // server's; "the user typed nothing" is this component's.
    if (name === '' || busy) return;

    if (tags.includes(name)) {
      setDraft('');
      return;
    }
    if (tags.length >= MAX_TAGS_PER_TASK) {
      setError(`A task can carry ${String(MAX_TAGS_PER_TASK)} tags.`);
      return;
    }
    save([...tags, name]);
  };

  // Suggestions: the project's tags this task does not already have, busiest
  // first — the count is the whole reason to show them, so it leads the order.
  const suggestions = known
    .filter((t) => !tags.includes(t.name))
    .slice()
    .sort((a, b) => b.task_count - a.task_count || a.name.localeCompare(b.name))
    .slice(0, 8);

  if (!mayEdit) {
    return tags.length === 0 ? null : (
      <div className="tagp">
        {showHeading && <h3 className="tagp-head">Tags</h3>}
        <ul className="tagp-list">
          {tags.map((tag) => (
            <li key={tag} className="tagp-chip">
              {tag}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="tagp">
      {showHeading && <h3 className="tagp-head">Tags</h3>}

      <ul className="tagp-list">
        {tags.map((tag) => (
          <li key={tag} className="tagp-chip">
            {tag}
            <Tooltip content={`Remove ${tag}`}>
              <button
                type="button"
                className="tagp-remove"
                disabled={locked}
                aria-label={`Remove ${tag}`}
                onClick={() => {
                  save(tags.filter((t) => t !== tag));
                }}
              >
                <Icon name="close" size="tiny" />
              </button>
            </Tooltip>
          </li>
        ))}
        {tags.length === 0 && !adding && <li className="tagp-none">None</li>}
        {!adding && (
          <li>
            <button
              type="button"
              className="tagp-open"
              disabled={locked}
              onClick={() => {
                setAdding(true);
              }}
            >
              + Add
            </button>
          </li>
        )}
      </ul>

      {adding && (
        <>
          <div className="tagp-add">
            <input
              ref={inputRef}
              type="text"
              className="input tagp-input"
              placeholder="Add a tag"
              value={draft}
              disabled={locked}
              maxLength={64}
              onChange={(event) => {
                setDraft(event.target.value);
                setError(undefined);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setAdding(false);
                  setDraft('');
                  return;
                }
                if (event.key !== 'Enter') return;
                // The panel is inside a form-less dialog, but Enter still bubbles
                // to whatever is listening; adding a tag is the whole intent here.
                event.preventDefault();
                add(draft);
              }}
            />
            <DisabledReason
              reason={!locked && normaliseTagInput(draft) === '' ? 'Type a tag first' : undefined}
            >
              <button
                type="button"
                className="tagp-apply"
                disabled={locked}
                aria-disabled={normaliseTagInput(draft) === '' ? true : undefined}
                onClick={() => {
                  if (normaliseTagInput(draft) === '') return;
                  add(draft);
                }}
              >
                {busy && <Spinner size="sm" />}
                Add
              </button>
            </DisabledReason>
          </div>

          {suggestions.length > 0 && (
            <ul className="tagp-suggest">
              {suggestions.map((tag) => (
                <li key={tag.name}>
                  <button
                    type="button"
                    className="tagp-suggestion"
                    disabled={locked}
                    onClick={() => {
                      add(tag.name);
                    }}
                  >
                    {tag.name}
                    {/* The count is why this list exists — it is what stops someone
                    minting `frontend` when `ui` is already on forty tasks. */}
                    <span className="tagp-count">{tag.task_count}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <button
            type="button"
            className="tagp-close"
            onClick={() => {
              setAdding(false);
              setDraft('');
            }}
          >
            Done
          </button>
        </>
      )}

      {error !== undefined && (
        <p className="tagp-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** What a save did to the list, for its toast: *Label bug added*. */
function tagChangeLine(before: readonly string[], after: readonly string[]): string {
  const added = after.filter((t) => !before.includes(t));
  const removed = before.filter((t) => !after.includes(t));
  if (added.length === 1 && removed.length === 0) return `Label ${added[0] ?? ''} added`;
  if (removed.length === 1 && added.length === 0) return `Label ${removed[0] ?? ''} removed`;
  return 'Labels updated';
}
