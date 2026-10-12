import { useEffect, useRef } from 'react';
import { useDialogFocus } from '../../../components/use-dialog-focus.ts';
import { createPortal } from 'react-dom';
import { CATEGORY_COPY, type ProjectStatus } from '../../../api/statuses.ts';
import './column-editor.css';

export interface HiddenColumnsDialogProps {
  readonly hidden: readonly ProjectStatus[];
  readonly busy: boolean;
  readonly onShow: (id: string) => void;
  readonly onClose: () => void;
  /** Where focus goes when it closes — the entry that opened it. */
  readonly restoreFocus?: (() => HTMLElement | null | undefined) | undefined;
}

/** `In review · 1 task` — the kind only when the name does not already say it. */
function rowHint(column: ProjectStatus): string {
  const kind = CATEGORY_COPY[column.category].label;
  const count = column.task_count === 1 ? '1 task' : `${String(column.task_count)} tasks`;
  return kind.toLowerCase() === column.name.trim().toLowerCase() ? count : `${kind} · ${count}`;
}

/**
 * *Hidden columns (N)* (LAI-739): the way back for a column somebody hid.
 *
 * Hiding is the only thing that takes a column off the board — nothing is
 * hidden automatically any more (LAI-617's rule is retired) — so every hidden
 * column is one a person chose to hide, and this lists them with their kind
 * and how much work is in them, which is what decides whether to show one.
 */
export function HiddenColumnsDialog({
  hidden,
  busy,
  onShow,
  onClose,
  restoreFocus,
}: HiddenColumnsDialogProps) {
  const box = useRef<HTMLDivElement>(null);
  useDialogFocus(box, {
    initial: () =>
      box.current?.querySelector<HTMLElement>('.cd-show') ??
      box.current?.querySelector<HTMLElement>('.cd-close'),
    restore: restoreFocus,
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return createPortal(
    <>
      <div className="column-dialog-scrim" aria-hidden="true" onClick={onClose} />
      <div
        ref={box}
        className="column-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hidden-columns-title"
      >
        <header className="cd-head">
          <h2 className="cd-title" id="hidden-columns-title">
            Hidden columns ({hidden.length})
          </h2>
          <button type="button" className="cd-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <section className="cd-section">
          {hidden.length === 0 ? (
            <p className="cd-hint">Every column is on the board.</p>
          ) : (
            <ul className="cd-hidden-list">
              {hidden.map((column) => (
                <li key={column.id} className="cd-hidden-row">
                  <span className={`dd-dot dd-dot-${column.category}`} aria-hidden="true" />
                  <span className="cd-kind-text">
                    <span className="cd-kind-label">{column.name}</span>
                    <span className="cd-kind-hint">{rowHint(column)}</span>
                  </span>
                  <button
                    type="button"
                    className="cd-show"
                    disabled={busy}
                    aria-label={`Show ${column.name}`}
                    onClick={(event) => {
                      // The row goes; focus moves to the next Show, or the ✕.
                      const rows = [
                        ...(box.current?.querySelectorAll<HTMLElement>('.cd-show') ?? []),
                      ];
                      const next =
                        rows[rows.indexOf(event.currentTarget) + 1] ??
                        rows[rows.indexOf(event.currentTarget) - 1];
                      onShow(column.id);
                      requestAnimationFrame(() => {
                        (next ?? box.current?.querySelector<HTMLElement>('.cd-close'))?.focus();
                      });
                    }}
                  >
                    Show
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="cd-hint">
            A hidden column keeps its tasks; they are just not on the board.
          </p>
        </section>
      </div>
    </>,
    document.body,
  );
}
