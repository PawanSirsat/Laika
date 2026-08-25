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

export interface TagPickerProps {
  readonly slug: string;
  readonly taskId: string;
  readonly tags: readonly string[];
  /** False for a Viewer — they see the tags and get no way to change them. */
  readonly mayEdit: boolean;
  /** Called with the task the server returned, so the board can follow. */
  readonly onChanged: (tags: readonly string[]) => void;
}

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
export function TagPicker({ slug, taskId, tags, mayEdit, onChanged }: TagPickerProps) {
  const [draft, setDraft] = useState('');
  const [known, setKnown] = useState<readonly ProjectTag[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!mayEdit) return;
    const controller = new AbortController();

    listProjectTags(slug, controller.signal)
      .then(setKnown)
      .catch(() => {
        // Only the suggestions are lost. Typing a tag still works, so this is
        // not worth an error state in front of the reader.
      });

    return () => {
      controller.abort();
    };
  }, [slug, mayEdit, tags]);

  const save = (next: readonly string[]): void => {
    setBusy(true);
    setError(undefined);

    setTaskTags(taskId, next)
      .then((task) => {
        onChanged(task.tags);
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
        <h3 className="tagp-head">Tags</h3>
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
      <h3 className="tagp-head">Tags</h3>

      <ul className="tagp-list">
        {tags.map((tag) => (
          <li key={tag} className="tagp-chip">
            {tag}
            <button
              type="button"
              className="tagp-remove"
              disabled={busy}
              aria-label={`Remove ${tag}`}
              onClick={() => {
                save(tags.filter((t) => t !== tag));
              }}
            >
              ×
            </button>
          </li>
        ))}
        {tags.length === 0 && <li className="tagp-none">None yet</li>}
      </ul>

      <div className="tagp-add">
        <input
          ref={inputRef}
          type="text"
          className="input tagp-input"
          placeholder="Add a tag"
          value={draft}
          disabled={busy}
          maxLength={64}
          onChange={(event) => {
            setDraft(event.target.value);
            setError(undefined);
          }}
          onKeyDown={(event) => {
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
          disabled={busy || normaliseTagInput(draft) === ''}
          onClick={() => {
            add(draft);
          }}
        >
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
                disabled={busy}
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

      {error !== undefined && (
        <p className="tagp-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
