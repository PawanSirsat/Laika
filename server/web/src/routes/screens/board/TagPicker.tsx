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
    setBusy(true);
    setError(undefined);

    setTaskTags(taskId, next)
      .then((task) => {
        props.onChanged(task.tags);
        setDraft('');
      })
      .catch((cause: unknown) => {
        // The server's own words. For a name that breaks the rule its message
        // names the tag and states the rule; for a schema rejection it is
        // generic, so the field issue is used instead of showing "Invalid
        // request body" to someone who typed one word.
        setError(readableRefusal(cause));
      })
      .finally(() => {
        setBusy(false);
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
            <button
              type="button"
              className="tagp-remove"
              disabled={locked}
              aria-label={`Remove ${tag}`}
              onClick={() => {
                save(tags.filter((t) => t !== tag));
              }}
            >
              ×
            </button>
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
            <button
              type="button"
              className="tagp-apply"
              disabled={locked || normaliseTagInput(draft) === ''}
              onClick={() => {
                add(draft);
              }}
            >
              {busy && <Spinner size="sm" />}
              Add
            </button>
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
