import { useEffect, useRef, useState } from 'react';
import { listMentionable, type MentionableUser } from '../../../api/mentions.ts';
import './task-panel.css';

export interface CommentComposerProps {
  readonly slug: string;
  readonly value: string;
  readonly busy: boolean;
  readonly onChange: (next: string) => void;
  readonly onSubmit: () => void;
  /**
   * The send button, rendered on the toolbar row.
   *
   * Passed in rather than built here: the submit lives in the form above and
   * knows about posting state and errors. The composer only decides *where* it
   * sits — which is inside the box, on the right of the marks, as the design
   * has it.
   */
  readonly send: React.ReactNode;
}

/** What a toolbar button wraps the selection in. */
const MARKS = [
  { id: 'bold', label: 'Bold', glyph: 'B', wrap: '**' },
  { id: 'italic', label: 'Italic', glyph: 'I', wrap: '_' },
  { id: 'code', label: 'Code', glyph: '<>', wrap: '`' },
] as const;

/**
 * The comment box, with the design's toolbar and an `@` picker (LAI-284,
 * closing half of LAI-458).
 *
 * ## The toolbar writes markdown, it does not style anything
 *
 * A comment is stored as `body_md`. These buttons wrap the selection in the
 * characters that mean bold, italic and code — they are a typing aid, not a
 * rich-text editor, and the textarea stays a textarea. That matters because
 * what gets stored is exactly what the author can see and edit; a WYSIWYG
 * surface over a markdown column is where the two drift apart.
 *
 * ## `@` asks the server who can be mentioned
 *
 * Not the members list. Who may be **told** about a task depends on who can
 * read it, and `GET /projects/:slug/mentionable` is where that is decided —
 * filtering members here would be a second answer, and the wrong one for a
 * private space.
 */
export function CommentComposer({
  slug,
  value,
  busy,
  onChange,
  onSubmit,
  send,
}: CommentComposerProps) {
  const box = useRef<HTMLTextAreaElement | null>(null);
  const [people, setPeople] = useState<readonly MentionableUser[]>([]);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    listMentionable(slug, controller.signal)
      .then((list) => {
        if (!controller.signal.aborted) setPeople(list.users);
      })
      .catch(() => {
        // No picker rather than a wrong one; typing `@name` still works,
        // because the server parses mentions out of the body either way.
      });
    return () => {
      controller.abort();
    };
  }, [slug]);

  /** Wrap the selection, or drop the marks in and put the caret between them. */
  const mark = (wrap: string): void => {
    const field = box.current;
    if (field === null) return;
    const { selectionStart: from, selectionEnd: to } = field;
    const selected = value.slice(from, to);
    const next = `${value.slice(0, from)}${wrap}${selected}${wrap}${value.slice(to)}`;
    onChange(next);
    // Restore the caret after React has written the new value, or the browser
    // puts it at the end and the next keystroke lands outside the marks.
    requestAnimationFrame(() => {
      field.focus();
      const caret = from + wrap.length + selected.length;
      field.setSelectionRange(caret, caret);
    });
  };

  const insertMention = (person: MentionableUser): void => {
    const field = box.current;
    const at = field?.selectionStart ?? value.length;
    const needsSpace = at > 0 && !/\s$/.test(value.slice(0, at));
    const text = `${needsSpace ? ' ' : ''}@${person.name} `;
    onChange(`${value.slice(0, at)}${text}${value.slice(at)}`);
    setPicking(false);
    requestAnimationFrame(() => {
      field?.focus();
      const caret = at + text.length;
      field?.setSelectionRange(caret, caret);
    });
  };

  return (
    <div className="composer">
      <textarea
        ref={box}
        className="composer-field"
        value={value}
        disabled={busy}
        rows={3}
        placeholder="Leave a comment… ⌘↵ to send"
        aria-label="Comment"
        onChange={(event) => {
          onChange(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            onSubmit();
          }
        }}
      />

      {/*
        **Inside the box, along its foot** — the design puts the marks and the
        send button on one row under the field, so the whole composer reads as
        a single control rather than a toolbar sitting above a textarea.
      */}
      <div className="composer-tools" role="group" aria-label="Formatting">
        {MARKS.map((m) => (
          <button
            key={m.id}
            type="button"
            className={`composer-tool composer-tool-${m.id}`}
            disabled={busy}
            title={m.label}
            onClick={() => {
              mark(m.wrap);
            }}
          >
            <span aria-hidden="true">{m.glyph}</span>
            <span className="visually-hidden">{m.label}</span>
          </button>
        ))}

        <button
          type="button"
          className="composer-tool composer-tool-at"
          disabled={busy || people.length === 0}
          aria-expanded={picking}
          title={people.length === 0 ? 'Nobody to mention here' : 'Mention someone'}
          onClick={() => {
            setPicking((open) => !open);
          }}
        >
          <span aria-hidden="true">@</span>
          <span className="visually-hidden">Mention someone</span>
        </button>

        {picking && (
          <ul className="composer-mentions">
            {people.map((person) => (
              <li key={person.id}>
                <button
                  type="button"
                  onClick={() => {
                    insertMention(person);
                  }}
                >
                  {person.name}
                </button>
              </li>
            ))}
          </ul>
        )}

        <span className="composer-send">{send}</span>
      </div>
    </div>
  );
}
