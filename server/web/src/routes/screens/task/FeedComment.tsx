import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { deleteComment, editComment, type Comment } from '../../../api/comments.ts';
import { timeLabel } from '../../../api/time-label.ts';
import { ConfirmDialog } from '../../../components/ConfirmDialog.tsx';
import { CommentBody } from './CommentBody.tsx';
import { foldLabel, type CommentKind } from './feed-groups.ts';
import { REVEAL_FINISH_EVENT, roundOf } from './reveal-finish.ts';
import { LazyRichEditor, type CardCandidate, type MentionCandidate } from './LazyRichEditor.tsx';
import './feed.css';

export interface FeedCommentProps {
  readonly comment: Comment;
  /** What the comment is (`commentKind`): a finish summary, a send-back's reason, or a comment. */
  readonly kind: CommentKind;
  /** Written through an agent (`isAgentComment`): a progress note, unless it is a summary. */
  readonly agent: boolean;
  readonly people: readonly MentionCandidate[];
  readonly meId?: string | undefined;
  readonly cards: readonly CardCandidate[];
  /** The reader may edit and delete it (`mayChangeComment`); the server decides again. */
  readonly mayChange: boolean;
  readonly now: number;
  /** Saved or deleted: the thread is read again. */
  readonly onChanged: () => void;
  /** Deleted: the thread stops drawing it before the read comes back. */
  readonly onDeleted: (commentId: string) => void;
}

/** How tall a folded finish summary stands (the design's 112px). */
const FOLD_PX = 112;

function refusal(cause: unknown): string {
  return cause instanceof Error && cause.message !== '' ? cause.message : 'Something went wrong.';
}

/**
 * **One comment as the feed draws it** (D-129, LAI-1122): a person's comment
 * a bordered card, an agent's a progress note on the raised fill, a round's
 * finish summary folded to its first lines with *Show full summary · N more
 * points*, and a send-back's reason a reason card. Each says *Edited* when it
 * was, with the time in its `title`, and offers Edit and Delete to a reader
 * the server would let change it.
 */
export function FeedComment({
  comment,
  kind,
  agent,
  people,
  meId,
  cards,
  mayChange,
  now,
  onChanged,
  onDeleted,
}: FeedCommentProps) {
  const [editing, setEditing] = useState(false);
  /** What the server answered a save with, until the thread's read catches up. */
  const [saved, setSaved] = useState<{ readonly from: number; readonly body: string } | undefined>(
    undefined,
  );
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | undefined>(undefined);
  const editButton = useRef<HTMLButtonElement | null>(null);

  const body = saved?.from === comment.updated_at ? saved.body : comment.body_md;

  /*
   * The confirmation's Escape closes the dialog and not the drawer under it.
   * That is ConfirmDialog's own since LAI-1205 (`useModalLayer`): the top
   * layer spends the key and stops it before the drawer's window listener.
   * The window-capture `preventDefault` that used to stand in for it here
   * now read to the dialog as "already spent", so it is gone.
   */

  const remove = (): void => {
    setDeleting(true);
    setDeleteError(undefined);
    deleteComment(comment.id)
      .then(() => {
        setConfirming(false);
        onDeleted(comment.id);
        onChanged();
      })
      .catch((cause: unknown) => {
        setDeleteError(refusal(cause));
      })
      .finally(() => {
        setDeleting(false);
      });
  };

  if (editing) {
    return (
      <div className="cmt-body">
        <div className="cmt-editing">
          <LazyRichEditor
            compact
            value={body}
            label="Edit comment"
            placeholder="Edit the comment — @ to mention someone"
            submitLabel="Save"
            people={people}
            meId={meId}
            cards={cards}
            onClose={() => {
              setEditing(false);
              editButton.current?.focus();
            }}
            onSubmit={async (next) => {
              const answer = await editComment(comment.id, next);
              setSaved({ from: comment.updated_at, body: answer.body_md });
              setEditing(false);
              onChanged();
            }}
          />
        </div>
      </div>
    );
  }

  const variant =
    kind.kind === 'finish_summary'
      ? 'summary'
      : kind.kind === 'send_back'
        ? 'reason'
        : agent
          ? 'note'
          : 'person';

  const edited =
    comment.edited_at === null ? null : (
      <span className="cmt-edited" title={`Edited ${timeLabel(comment.edited_at, now).full}`}>
        Edited
      </span>
    );

  const actions = mayChange ? (
    <span className="cmt-actions">
      <button
        ref={editButton}
        type="button"
        className="cmt-action"
        aria-label="Edit comment"
        onClick={() => {
          setEditing(true);
        }}
      >
        Edit
      </button>
      <button
        type="button"
        className="cmt-action"
        aria-label="Delete comment"
        onClick={() => {
          setDeleteError(undefined);
          setConfirming(true);
        }}
      >
        Delete
      </button>
    </span>
  ) : null;

  return (
    <div className="cmt-body">
      {variant === 'summary' && kind.kind === 'finish_summary' ? (
        <FinishSummary
          round={kind.round}
          body={body}
          people={people}
          meId={meId}
          foot={
            edited !== null || actions !== null ? (
              <>
                {edited}
                {actions}
              </>
            ) : null
          }
        />
      ) : (
        <div className={`cmt-card cmt-card-${variant}`} data-comment-kind={variant}>
          {variant === 'reason' && (
            <span className="cmt-sent-back">
              <span aria-hidden="true">↩</span> Sent back
            </span>
          )}
          <CommentBody body={body} people={people} meId={meId} />
          {(edited !== null || actions !== null) && (
            <div className="cmt-card-foot">
              {edited}
              {actions}
            </div>
          )}
        </div>
      )}
      {confirming && (
        <ConfirmDialog
          title="Delete this comment?"
          confirmLabel="Delete"
          danger
          busy={deleting}
          error={deleteError}
          onConfirm={remove}
          onClose={() => {
            setConfirming(false);
          }}
        >
          It leaves the thread for everyone reading this task. The history keeps a line saying a
          comment was deleted.
        </ConfirmDialog>
      )}
    </div>
  );
}

interface FinishSummaryProps {
  readonly round: number;
  readonly body: string;
  readonly people: readonly MentionCandidate[];
  readonly meId?: string | undefined;
  readonly foot: ReactNode;
}

/**
 * A round's finish summary, folded (D-129, LAI-1122): the first ~112px with a
 * fade at its foot and *Show full summary · N more points* under it. A summary
 * short enough to fit is drawn whole, with no button to press for nothing.
 */
function FinishSummary({ round, body, people, meId, foot }: FinishSummaryProps) {
  const [open, setOpen] = useState(false);
  const [tall, setTall] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);
  const id = useId();

  useLayoutEffect(() => {
    const el = box.current;
    if (el === null) return;
    const measure = (): void => {
      setTall(el.scrollHeight > FOLD_PX + 1);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => {
      watch.disconnect();
    };
  }, [body]);

  // *Full summary in activity ↓* names a round (`reveal-finish.ts`): this
  // card answers for its own, opens and comes into view.
  const card = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onReveal = (event: Event): void => {
      if (roundOf(event) !== round) return;
      event.preventDefault();
      setOpen(true);
      card.current?.scrollIntoView({ block: 'start' });
    };
    document.addEventListener(REVEAL_FINISH_EVENT, onReveal);
    return () => {
      document.removeEventListener(REVEAL_FINISH_EVENT, onReveal);
    };
  }, [round]);

  const folded = tall && !open;
  return (
    <div
      ref={card}
      className="cmt-finish"
      data-comment-kind="summary"
      data-round={round}
      data-open={open ? 'true' : 'false'}
    >
      <span className="cmt-finish-title">Finish summary · round {round}</span>
      <div
        ref={box}
        id={id}
        className="cmt-finish-body"
        data-folded={folded ? 'true' : 'false'}
        style={folded ? { maxHeight: `${String(FOLD_PX)}px` } : undefined}
      >
        <CommentBody body={body} people={people} meId={meId} />
      </div>
      {(tall || foot !== null) && (
        <div className="cmt-card-foot">
          {tall && (
            <button
              type="button"
              className="cmt-fold"
              aria-expanded={open}
              aria-controls={id}
              onClick={() => {
                setOpen((was) => !was);
              }}
            >
              {foldLabel(body, open)}
            </button>
          )}
          {foot}
        </div>
      )}
    </div>
  );
}
