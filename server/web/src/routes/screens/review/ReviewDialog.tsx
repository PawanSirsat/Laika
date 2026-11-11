import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  proofStamp,
  roundAgentName,
  waitingFor,
  type ReviewQueueItem,
} from '../../../api/review.ts';
import { Spinner } from '../../../components/Spinner.tsx';
import { typingIn } from '../../../components/typing-in.ts';
import { useDialogFocus } from '../../../components/use-dialog-focus.ts';
import { EvidenceSection } from '../task/EvidenceSection.tsx';
import { TaskMarkdown } from '../task/TaskMarkdown.tsx';
import { dialogCommand, type ItemPosition } from './review-derive.ts';
import { ReviewShips } from './ReviewShips.tsx';
import './review-dialog.css';

export interface ReviewDialogProps {
  /** The open item — `undefined` once a re-read has taken it out of the queue. */
  readonly item: ReviewQueueItem | undefined;
  /** The key the dialog was opened on, for the heading when the item has gone. */
  readonly taskKey: string;
  readonly position: ItemPosition | null;
  readonly now: number;
  /** A decision on this item is in flight. */
  readonly deciding: boolean;
  /** Every decision is held — a bulk Accept is running. */
  readonly held: boolean;
  readonly failure: string | undefined;
  readonly nameOf: (userId: string) => string;
  readonly boardHref: (item: ReviewQueueItem) => string;
  readonly onNavigate: (to: string) => void;
  readonly onPrev: () => void;
  readonly onNext: () => void;
  readonly onClose: () => void;
  readonly onAccept: (item: ReviewQueueItem) => void;
  /** Opens the Send back dialog over this one; `opener` gets focus back after. */
  readonly onSendBack: (item: ReviewQueueItem, opener: HTMLElement) => void;
  /** Where focus goes when the dialog closes — the row, asked then, not at open. */
  readonly restore: () => HTMLElement | null | undefined;
  /**
   * The Send back dialog, when open: a React child of this box so it is this
   * dialog's in the tree, portaled to `<body>` by itself so it sits over it.
   */
  readonly children?: ReactNode;
}

/**
 * The Review dialog (D-146 item 3, LAI-1169): one task's proof in a centred
 * modal of the Create task dialog's house shape — scrim 60, box 61, a sheet
 * on a phone — with the decision under it, so a reviewer walks the queue
 * without leaving it. Prev and Next move along the rows as the page draws
 * them; `?item=` is the address, so Back closes and a link opens one.
 *
 * ## Keys
 *
 * `j` / `↓` next, `k` / `↑` previous, `a` accept, `s` send back, Escape close
 * (`dialogCommand`). The Send back dialog is a child of this one in the React
 * tree and portaled to `<body>` in the DOM; React bubbles its keys through the
 * tree regardless, so an `a` on its Cancel button — or its Escape, which it
 * spends only at `document`, after this handler — would reach here. **The
 * guard is DOM containment**, the box's own `contains(target)`, not the React
 * tree. `review-dialog.test.ts` removes it and watches that case go red.
 */
export function ReviewDialog({
  item,
  taskKey,
  position,
  now,
  deciding,
  held,
  failure,
  nameOf,
  boardHref,
  onNavigate,
  onPrev,
  onNext,
  onClose,
  onAccept,
  onSendBack,
  restore,
  children,
}: ReviewDialogProps) {
  const box = useRef<HTMLDivElement | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const acceptButton = useRef<HTMLButtonElement | null>(null);
  const sendBackButton = useRef<HTMLButtonElement | null>(null);
  const closeButton = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();
  const decidable = item?.can_decide === true;
  const busy = deciding || held;

  useDialogFocus(box, {
    initial: () => (decidable ? acceptButton.current : closeButton.current),
    restore,
  });

  // Prev / Next: the heading takes focus, so a screen reader says where it
  // landed and the next `j` is read from inside the box. Not on open — the
  // initial focus above is the decision.
  const opened = useRef(item?.task.id);
  useEffect(() => {
    if (item === undefined || item.task.id === opened.current) return;
    opened.current = item.task.id;
    heading.current?.focus();
  }, [item]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!(event.target instanceof Node) || box.current?.contains(event.target) !== true) return;
    const command = dialogCommand(
      event,
      typingIn(event.target instanceof HTMLElement ? event.target : null),
    );
    if (command === null) return;
    event.preventDefault();
    switch (command) {
      case 'close':
        onClose();
        return;
      case 'next':
        if (!busy && (item === undefined || position?.next != null)) onNext();
        return;
      case 'prev':
        if (!busy && position?.prev != null) onPrev();
        return;
      case 'accept':
        if (item !== undefined && decidable && !busy) accept(item);
        return;
      case 'send_back':
        // Focus comes back to Send back… when that dialog closes, wherever
        // the `s` was pressed from.
        if (item !== undefined && decidable && !busy && sendBackButton.current !== null) {
          onSendBack(item, sendBackButton.current);
        }
        return;
    }
  };

  /*
   * Focus moves to the heading **before** Accept is disabled by the request
   * (review round 1, item 1): a disabled control drops focus to `<body>`, and
   * from there no key — Escape included — reaches this box. The box itself
   * is focusable (`tabIndex={-1}`) for the same reason: a click on its text
   * must leave focus inside it, not on the page behind.
   */
  const accept = (target: ReviewQueueItem): void => {
    heading.current?.focus();
    onAccept(target);
  };

  const agent = item?.round === null || item === undefined ? null : roundAgentName(item.round);
  const summary = item?.round?.summary_md.trim() ?? '';

  return createPortal(
    <>
      <div className="rd-scrim" aria-hidden="true" onClick={onClose} />
      <div
        ref={box}
        className="rd-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy || undefined}
        data-dialog="review"
        data-task={taskKey}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className="rd-head">
          <div className="rd-titles">
            <h2 className="rd-title" id={titleId} ref={heading} tabIndex={-1}>
              <span className="rd-key">{taskKey}</span>
              {item !== undefined && <span className="rd-title-text">{item.task.title}</span>}
            </h2>
            {item !== undefined && (
              <p className="rd-sub">
                <span className="rd-space">{item.project.name}</span>
                <span>{item.assignee_name ?? 'Unassigned'}</span>
                {agent !== null && <span className="rd-agent">{agent}</span>}
                {item.round !== null && <span>round {item.round.number}</span>}
                <span className="rd-waiting">waiting {waitingFor(item.waiting_since, now)}</span>
              </p>
            )}
          </div>
          <button
            ref={closeButton}
            type="button"
            className="rd-close"
            aria-label="Close"
            onClick={onClose}
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>

        <div className="rd-body">
          {item === undefined ? (
            <p className="rd-gone" role="status">
              This task left the queue — someone else decided it, or it moved.
            </p>
          ) : (
            <>
              <section className="rd-finish" aria-labelledby="rd-finish-title">
                <h3 className="rd-section-title" id="rd-finish-title">
                  Finish
                </h3>
                {summary === '' ? (
                  <p className="rd-none">No finish recorded.</p>
                ) : (
                  <TaskMarkdown source={summary} className="rd-summary" />
                )}
              </section>
              <EvidenceSection
                taskId={item.task.id}
                // GitHub's confirmations move no task, so the queue's own
                // re-read is what notices them (D-083).
                refreshKey={item.task.updated_at + proofStamp(item.round)}
                sendBack={item.task.send_back}
                nameOf={nameOf}
              />
              <ReviewShips items={item.task.deliverables} />
              {failure !== undefined && (
                <p className="rev-error" role="alert">
                  {failure}
                </p>
              )}
              {!decidable && (
                <p className="rev-why">
                  Only the assignee, a space admin or an organisation admin decides this one.
                </p>
              )}
            </>
          )}
        </div>

        <footer className="rd-foot">
          <div className="rd-walk">
            <button
              type="button"
              className="bar-control"
              disabled={busy || position?.prev == null}
              onClick={onPrev}
            >
              Prev
            </button>
            <span className="rd-position" role="status">
              {position === null
                ? item === undefined
                  ? 'Gone'
                  : ''
                : `${String(position.index + 1)} of ${String(position.total)}`}
            </span>
            <button
              type="button"
              className="bar-control"
              disabled={busy || (item !== undefined && position?.next == null)}
              onClick={onNext}
            >
              Next
            </button>
          </div>
          <div className="rd-actions">
            {item !== undefined && (
              <a
                className="rev-open"
                href={boardHref(item)}
                onClick={(event) => {
                  // Modified clicks stay the browser's — new tab, new
                  // window — as the Sidebar's do (LAI-1129).
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  if (event.button !== 0) return;
                  event.preventDefault();
                  onNavigate(boardHref(item));
                }}
              >
                Open on board
              </a>
            )}
            {item !== undefined && decidable && (
              <>
                <button
                  ref={sendBackButton}
                  type="button"
                  className="bar-control"
                  disabled={busy}
                  onClick={(event) => {
                    onSendBack(item, event.currentTarget);
                  }}
                >
                  Send back…
                </button>
                <button
                  ref={acceptButton}
                  type="button"
                  className="bar-control bar-control-primary"
                  disabled={busy}
                  onClick={() => {
                    accept(item);
                  }}
                >
                  {deciding && <Spinner size="sm" />}
                  Accept
                </button>
              </>
            )}
          </div>
        </footer>
        {children}
      </div>
    </>,
    document.body,
  );
}
