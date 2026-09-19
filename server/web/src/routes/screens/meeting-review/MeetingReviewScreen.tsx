import { Spinner } from '../../../components/Spinner.tsx';
import { useEffect, useState } from 'react';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { EmptyState } from '../../../components/EmptyState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { SpaceSlot } from '../../../components/space/SpaceSlot.tsx';
import {
  applyMeetingReview,
  discardMeetingReview,
  getMeetingReview,
  listMeetingReviews,
  type ApplyResult,
  type MeetingReview,
  type MeetingReviewDetail,
  type ProposalView,
} from '../../../api/meeting-reviews.ts';
import { listTasks, type Task } from '../../../api/tasks.ts';
import {
  changedFields,
  describeChange,
  describeOutcome,
  isActionable,
  KIND_LABEL,
  KIND_MEANING,
  landedState,
  whyNotActionable,
} from './review-derive.ts';
import './meeting-review.css';

export interface MeetingReviewScreenProps {
  readonly slug: string | undefined;
  readonly onOpenTask: (taskKey: string) => void;
}

/**
 * Meeting review (§10.2, §11.4.2) — **the highest-stakes screen in Laika.**
 *
 * Every other screen shows a person what is on their board. This one asks them
 * to authorise **an LLM's reading of a conversation** to change it. So the design
 * job is not to make accepting easy; it is to make **accepting something wrong
 * hard**.
 *
 * Three things follow from that and are not negotiable here:
 *
 * 1. **Nothing is accepted by default**, and an empty selection is not "apply
 *    everything". A screen whose safe action is the one the user did not take is
 *    the wrong way round for something that rewrites a board.
 * 2. **Every proposal shows the sentence it is accountable to.** There is no
 *    transcript to put beside it (D-056) — quotes are kept and the meeting is
 *    not — so the quote is the whole of the evidence and it is never truncated
 *    away.
 * 3. **What landed is read from the response.** LAI-451 refuses proposals
 *    individually; a member may legitimately apply a task change and not a
 *    `decision`, which is lead-only. Reporting the selection would report a
 *    success that did not happen.
 *
 * There is deliberately **no "accept all"**. If one is added it should be a
 * decision with a reason, not a convenience that arrives during implementation.
 */
export function MeetingReviewScreen({ slug, onOpenTask }: MeetingReviewScreenProps) {
  const [reviews, setReviews] = useState<readonly MeetingReview[] | undefined>(undefined);
  const [openId, setOpenId] = useState<string | undefined>(undefined);
  const [detail, setDetail] = useState<MeetingReviewDetail | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  /**
   * The board, indexed by display key.
   *
   * **A change with no before is not reviewable** — *"set status to done"* tells
   * a reader nothing they can refuse; `in_progress → done` does. The proposal
   * carries only the new value, so the old one comes from the task it names, and
   * where the board does not hold that task the arrow is **omitted rather than
   * invented**: `? → done` claims a fact nobody has.
   *
   * A failure here is not an error on this screen. Losing the before makes the
   * proposals harder to judge; losing the screen makes them impossible to.
   */
  const [tasksByKey, setTasksByKey] = useState<ReadonlyMap<string, Task>>(new Map());

  /** Accepted ids. **Starts empty and is never pre-filled.** */
  const [accepted, setAccepted] = useState<ReadonlySet<string>>(new Set());
  const [sent, setSent] = useState<ReadonlySet<string>>(new Set());
  const [result, setResult] = useState<ApplyResult | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (slug === undefined) return;
    const controller = new AbortController();
    listMeetingReviews(slug, controller.signal)
      .then((page) => {
        setReviews(page.data);
        setOpenId((current) => current ?? page.data[0]?.id);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError(cause);
      });
    listTasks(slug, {}, controller.signal)
      .then((page) => {
        setTasksByKey(new Map(page.data.map((task) => [task.key, task])));
      })
      .catch(() => {
        // See `tasksByKey`: the arrow is dropped, the screen is not.
      });

    return () => {
      controller.abort();
    };
  }, [slug]);

  useEffect(() => {
    if (openId === undefined) return;
    const controller = new AbortController();
    setDetail(undefined);
    // A different review is a different set of proposals: carrying a selection
    // across would let somebody apply something they ticked on another meeting.
    setAccepted(new Set());
    setResult(undefined);
    setActionError(undefined);
    getMeetingReview(openId, controller.signal)
      .then(setDetail)
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError(cause);
      });
    return () => {
      controller.abort();
    };
  }, [openId]);

  if (slug === undefined) {
    return <EmptyState headline="Pick a project" body="Meeting reviews belong to a project." />;
  }
  if (error !== null) {
    return <ApiErrorState error={error} resource="meeting reviews" scope="project" />;
  }
  if (reviews === undefined) {
    return <LoadingState shape="row" count={3} label="Loading meeting reviews" />;
  }

  const toggle = (id: string): void => {
    setAccepted((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const apply = (): void => {
    if (detail === undefined || accepted.size === 0) return;
    setBusy(true);
    setActionError(undefined);
    const submitted = new Set(accepted);
    applyMeetingReview(detail.id, [...submitted])
      .then((applied) => {
        setSent(submitted);
        setResult(applied);
        return getMeetingReview(detail.id);
      })
      .then(setDetail)
      .catch((cause: unknown) => {
        setActionError(cause instanceof Error ? cause.message : 'Could not apply that review.');
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const discard = (): void => {
    if (detail === undefined) return;
    if (
      !window.confirm(
        `Discard all ${String(detail.proposals.length)} proposals from this meeting? The set is thrown away and cannot be applied afterwards.`,
      )
    ) {
      return;
    }
    discardMeetingReview(detail.id)
      .then(() => getMeetingReview(detail.id))
      .then(setDetail)
      .catch((cause: unknown) => {
        setActionError(cause instanceof Error ? cause.message : 'Could not discard that review.');
      });
  };

  const blocked = detail === undefined ? undefined : whyNotActionable(detail);
  const open = detail !== undefined && isActionable(detail);

  return (
    <div className="mr">
      <SpaceSlot
        context={
          reviews.length === 0
            ? undefined
            : `${String(reviews.length)} ${reviews.length === 1 ? 'review' : 'reviews'} · nothing is accepted until you say so`
        }
      />

      {reviews.length === 0 ? (
        <EmptyState
          headline="No meeting has been submitted"
          body="A meeting reaches Laika through the transcript webhook. What comes back is a set of proposals to review — nothing is written to the board until somebody accepts them."
        />
      ) : (
        <div className="mr-body">
          <aside className="mr-list" aria-label="Meeting reviews">
            {reviews.map((review) => (
              <button
                key={review.id}
                type="button"
                className={review.id === openId ? 'mr-item mr-item-on' : 'mr-item'}
                aria-pressed={review.id === openId}
                onClick={() => {
                  setOpenId(review.id);
                }}
              >
                <span className="mr-item-head">
                  <span className="mr-source">{review.source}</span>
                  <span className={`mr-status mr-status-${review.status}`}>{review.status}</span>
                </span>
                <span className="mr-item-meta">
                  {review.proposal_count} {review.proposal_count === 1 ? 'proposal' : 'proposals'} ·{' '}
                  {new Date(review.created_at).toLocaleDateString()}
                </span>
              </button>
            ))}
          </aside>

          <section className="mr-detail">
            {detail === undefined ? (
              <LoadingState shape="row" count={3} label="Loading proposals" />
            ) : (
              <>
                {blocked !== undefined && (
                  /* **Read-only with the reason** — not an error, and not an
                     empty state. An expired review still has everything that was
                     proposed, and a reader looking at it deserves to know why
                     they cannot act rather than being told nothing is here. */
                  <p className={`mr-blocked mr-blocked-${detail.status}`} role="status">
                    {blocked}
                  </p>
                )}

                {actionError !== undefined && (
                  <p className="mr-error" role="alert">
                    {actionError}
                  </p>
                )}

                <ul className="mr-proposals">
                  {detail.proposals.map((proposal) => (
                    <ProposalRow
                      key={proposal.id}
                      proposal={proposal}
                      accepted={accepted.has(proposal.id)}
                      actionable={open}
                      landed={
                        result === undefined ? undefined : landedState(proposal.id, sent, result)
                      }
                      onToggle={() => {
                        toggle(proposal.id);
                      }}
                      onOpenTask={onOpenTask}
                      before={proposal.task === null ? undefined : tasksByKey.get(proposal.task)}
                    />
                  ))}
                </ul>

                {open && (
                  <div className="mr-actions">
                    {/* **Discard is not beside apply.** It destroys the whole
                        set, and a destructive control within a thumb's width of
                        the ordinary one is how the wrong button gets pressed. */}
                    <button type="button" className="mr-discard" onClick={discard}>
                      Discard the whole set
                    </button>

                    <div className="mr-apply-group">
                      <span className="mr-count" aria-live="polite">
                        {accepted.size === 0
                          ? 'Nothing accepted yet'
                          : `${String(accepted.size)} of ${String(detail.proposals.length)} accepted`}
                      </span>
                      <button
                        type="button"
                        className="mr-apply"
                        /* An empty selection is **not** "apply everything", and
                           the control says so by being unavailable rather than
                           by sending nothing and reporting success. */
                        disabled={busy || accepted.size === 0}
                        onClick={apply}
                      >
                        {busy && <Spinner size="sm" />}
                        {`Apply ${String(accepted.size)}`}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function ProposalRow({
  proposal,
  accepted,
  actionable,
  landed,
  onToggle,
  onOpenTask,
  before,
}: {
  readonly proposal: ProposalView;
  /** The task this proposal edits, when the board holds it. */
  readonly before: Task | undefined;
  readonly accepted: boolean;
  readonly actionable: boolean;
  readonly landed: ReturnType<typeof landedState> | undefined;
  readonly onToggle: () => void;
  readonly onOpenTask: (taskKey: string) => void;
}) {
  const fields = changedFields(proposal);

  return (
    <li className={`mr-proposal mr-kind-${proposal.kind}`}>
      <div className="mr-proposal-head">
        <span className={`mr-tag mr-tag-${proposal.kind}`}>{KIND_LABEL[proposal.kind]}</span>
        <span className="mr-meaning">{KIND_MEANING[proposal.kind]}</span>
        {proposal.task !== null && (
          <button
            type="button"
            className="mr-task"
            onClick={() => {
              onOpenTask(proposal.task ?? '');
            }}
          >
            {proposal.task}
          </button>
        )}
      </div>

      {proposal.title !== null && <p className="mr-title">{proposal.title}</p>}
      {proposal.description !== null && <p className="mr-desc">{proposal.description}</p>}

      {fields.length > 0 && (
        <ul className="mr-changes">
          {fields.map((field) => {
            const change = describeChange(
              field,
              proposal.changes?.[field],
              before === undefined
                ? undefined
                : (before as unknown as Record<string, unknown>)[field],
            );
            return (
              <li key={field} className="mr-change">
                <span className="mr-change-field">{change.field}</span>
                {change.from !== undefined && (
                  <>
                    <span className="mr-change-from">{change.from}</span>
                    <span className="mr-change-arrow" aria-hidden="true">
                      →
                    </span>
                  </>
                )}
                <span className="mr-change-to">{change.to}</span>
              </li>
            );
          })}
        </ul>
      )}

      {proposal.reason !== null && <p className="mr-reason">{proposal.reason}</p>}

      {/* The sentence this is accountable to. There is no transcript to locate
          it in (D-056); the quote is the whole of the evidence. */}
      <blockquote className="mr-quote">{proposal.quote}</blockquote>

      <div className="mr-proposal-foot">
        {actionable ? (
          <label className="mr-accept">
            <input type="checkbox" checked={accepted} onChange={onToggle} />
            <span>Accept this one</span>
          </label>
        ) : (
          proposal.applied_at !== null && <span className="mr-landed">applied</span>
        )}

        {landed !== undefined && (
          <span className={`mr-landed mr-landed-${landed.state}`}>
            {landed.state === 'applied' && describeOutcome(landed.outcome, (id) => id)}
            {landed.state === 'already' && 'already applied — nothing changed'}
            {/* **Not an error.** The server decides each proposal on its own
                (LAI-451), and a member accepting a lead-only `decision` is the
                ordinary case, not a fault. */}
            {landed.state === 'refused' && 'not applied — you may not make this change'}
          </span>
        )}
      </div>
    </li>
  );
}
