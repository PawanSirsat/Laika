import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PersonInboxCounts } from '../../../api/handoffs.ts';
import {
  acceptReview,
  decidableCount,
  evidenceSummary,
  getReviewQueue,
  NO_FILTER,
  sendBackReview,
  waitingFor,
  type QueueFilter,
  type ReviewQueue,
  type ReviewQueueItem,
} from '../../../api/review.ts';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { Dropdown } from '../../../components/Dropdown.tsx';
import { EmptyState } from '../../../components/EmptyState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { ScreenHeader } from '../../../components/ScreenHeader.tsx';
import { InfoTip } from '../profile/InfoTip.tsx';
import { HandoffsTab } from '../inbox/HandoffsTab.tsx';
import { SCREEN_COPY } from '../screen-copy.ts';
import { applyToEach, type BulkRun } from '../list/list-bulk.ts';
import { effectiveSelection, NO_SELECTION } from '../list/list-select.ts';
import { NeedsApprovalSection } from './NeedsApprovalSection.tsx';
import { ReviewBulkBar } from './ReviewBulkBar.tsx';
import { ReviewDialog } from './ReviewDialog.tsx';
import { ReviewGroups } from './ReviewGroups.tsx';
import {
  acceptSummary,
  advanceAfterDecide,
  flatOrder,
  groupBySpace,
  itemParam,
  positionOf,
  reviewView,
  visibleQueue,
  withItem,
  withView,
  type ReviewView,
} from './review-derive.ts';
import { SendBackDialog } from './SendBackDialog.tsx';
import '../profile/profile.css';
import './review.css';

export interface ReviewScreenProps {
  /**
   * The address's query: `?view=all` lists everything in review, `?view=handoffs`
   * every hand-off (D-146), `?item=<taskId>` the task open in the dialog.
   */
  readonly params: URLSearchParams;
  /** `push` for opening the dialog, so Back closes it; a replace otherwise. */
  readonly setParams: (next: URLSearchParams, options?: { readonly push?: boolean }) => void;
  /** Go somewhere in the app — the board, for "Open on board". */
  readonly onNavigate: (to: string) => void;
  /** An accept or a send-back changed the queue — the sidebar's count re-reads. */
  readonly onChanged?: () => void;
  /** The hand-offs folded into this tab (D-146 item 4): who reads, the shell's counts, its re-read. */
  readonly handoffs: {
    readonly meId: string | undefined;
    readonly counts: PersonInboxCounts | undefined;
    readonly onChanged: () => void;
  };
}

/**
 * There is no organisation-wide stream — each project's SSE is its own
 * (§11.5) — so the queue re-reads on a timer, when the tab comes back, and
 * after every decision made here, as Capacity does. A task panel's proof is
 * live through the board's store instead.
 */
const POLL_MS = 20_000;

function errorText(cause: unknown): string {
  return cause instanceof Error && cause.message !== '' ? cause.message : 'Something went wrong.';
}

function boardHref(item: ReviewQueueItem): string {
  return `/board?project=${encodeURIComponent(item.project.slug)}&task=${encodeURIComponent(item.task.id)}`;
}

/**
 * The review queue (§11.4, D-082, LAI-758) as a decision queue (D-146,
 * LAI-1168): the tasks waiting in a review status on the projects this
 * person can act on, oldest waiting first, with the proof each finish
 * carried. It opens on what *this* reader may decide, grouped by space;
 * *Everything in review* is one toggle away. A person accepts a task into
 * done — one or many at once — or sends it back with a reason; nothing else
 * on the board can mark agent work done. A row opens in the Review dialog
 * (LAI-1169), `?item=` in the address; the hand-offs waiting on the reader's
 * approval head the page, and *All hand-offs* is `?view=handoffs`.
 */
export function ReviewScreen({
  params,
  setParams,
  onNavigate,
  onChanged,
  handoffs,
}: ReviewScreenProps) {
  const [queue, setQueue] = useState<ReviewQueue | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [filter, setFilter] = useState<QueueFilter>(NO_FILTER);
  const [selected, setSelected] = useState<ReadonlySet<string>>(NO_SELECTION);
  /** A deep link to a task no longer waiting: said once above the queue. */
  const [notice, setNotice] = useState<string | null>(null);
  const [run, setRun] = useState<BulkRun | undefined>(undefined);
  /**
   * Every decision in flight, by task id (review round 1, item 4): one id let
   * `a`, `j`, `a` re-enable the second Accept when the first answered. The
   * dialog holds Prev/Next and its keys while the set is not empty.
   */
  const [inFlight, setInFlight] = useState<ReadonlySet<string>>(() => new Set());
  const [failure, setFailure] = useState<{ taskId: string; message: string } | null>(null);
  const [sending, setSending] = useState<ReviewQueueItem | null>(null);
  const [sendError, setSendError] = useState<string | undefined>(undefined);
  const [now, setNow] = useState(() => Date.now());
  const loaded = useRef(false);
  const opener = useRef<HTMLElement | null>(null);
  /** The key of the last task the dialog drew — where focus goes when it closes. */
  const openedKey = useRef<string | null>(null);

  const view = reviewView(params);
  const decidable = view === 'mine';
  const openId = itemParam(params);
  /*
   * Read at response time, not at click time (review round 1, item 2): a
   * decision's `.then` ran 2.5 s after `a`, with the `openId` of the render
   * it was made in — so a dialog the reader had closed meanwhile reopened on
   * the next row. These are the live values.
   */
  const openIdRef = useRef(openId);
  openIdRef.current = openId;
  const paramsRef = useRef(params);
  paramsRef.current = params;
  /** Where the open item last stood, for Next once a poll has taken it. */
  const lastIndex = useRef(0);

  const load = useCallback((signal?: AbortSignal) => {
    getReviewQueue(signal)
      .then((answer) => {
        loaded.current = true;
        setQueue(answer);
        setError(null);
        setNow(Date.now());
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        // A failed re-read keeps the list it has; only a first read shows it.
        if (!loaded.current) setError(cause);
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    const timer = setInterval(() => {
      load(controller.signal);
    }, POLL_MS);
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') load(controller.signal);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  // A selection belongs to the view it was made in.
  useEffect(() => {
    setSelected(NO_SELECTION);
  }, [view]);

  const items = useMemo(() => queue?.tasks ?? [], [queue]);
  const mine = useMemo(() => decidableCount(items), [items]);
  /** The view's rows before the filters: what the tiles count. */
  const viewItems = useMemo(
    () => (decidable ? items.filter((item) => item.can_decide) : items),
    [items, decidable],
  );
  const shown = useMemo(
    () => visibleQueue(items, { decidable, filter }),
    [items, decidable, filter],
  );
  const groups = useMemo(() => groupBySpace(shown), [shown]);
  const order = useMemo(() => flatOrder(groups), [groups]);
  const orderRef = useRef(order);
  orderRef.current = order;
  // What a bulk Accept reaches: the ticked rows still on screen and decidable.
  const effective = useMemo(
    () =>
      effectiveSelection(
        selected,
        shown.filter((item) => item.can_decide).map((item) => ({ id: item.task.id })),
      ),
    [selected, shown],
  );

  /** The task the dialog shows; `undefined` while it is not in the queue. */
  const openItem = useMemo(
    () => (openId === null ? undefined : items.find((item) => item.task.id === openId)),
    [items, openId],
  );
  if (openItem !== undefined) openedKey.current = openItem.task.key;
  /**
   * `?item=` names a task the loaded queue does not have. Opened on it — a
   * re-read took it out from under the dialog — the dialog says so and offers
   * Next. Arrived at by link, there is nothing to show: the param goes and
   * the page says so once.
   */
  const vanished =
    openId !== null && openItem === undefined && queue !== undefined && openedKey.current !== null;
  useEffect(() => {
    if (openId === null || openItem !== undefined || queue === undefined || vanished) return;
    setNotice('That task is no longer waiting for review.');
    setParams(withItem(params, null));
  }, [openId, openItem, queue, vanished]);

  const names = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items) {
      if (item.task.assignee_id !== null && item.assignee_name !== null) {
        map.set(item.task.assignee_id, item.assignee_name);
      }
      if (item.round !== null && item.finished_by_name !== null) {
        map.set(item.round.finished_by, item.finished_by_name);
      }
    }
    return map;
  }, [items]);
  const nameOf = useCallback((id: string) => names.get(id) ?? 'someone', [names]);

  const projects = useMemo(() => {
    const seen = new Map<string, string>();
    for (const item of items) seen.set(item.project.slug, item.project.name);
    return [...seen].sort((a, b) => a[1].localeCompare(b[1]));
  }, [items]);
  const assignees = useMemo(
    () =>
      [...new Set(items.map((i) => i.task.assignee_id).filter((id): id is string => id !== null))]
        .map((id) => [id, nameOf(id)] as const)
        .sort((a, b) => a[1].localeCompare(b[1])),
    [items, nameOf],
  );

  const figures = useMemo(() => {
    const summaries = viewItems.map((i) => evidenceSummary(i.round));
    return {
      waiting: viewItems.length,
      oldest: viewItems[0] === undefined ? '—' : waitingFor(viewItems[0].waiting_since, now),
      failing: summaries.filter((s) => s.testsFailed > 0).length,
      bare: summaries.filter((s) => s.empty).length,
      fast: viewItems.filter((i) => i.cue !== null).length,
    };
  }, [viewItems, now]);

  const setView = (next: ReviewView): void => {
    setParams(withView(params, next));
  };

  const openTask = (id: string | null, push = false): void => {
    setParams(withItem(paramsRef.current, id), push ? { push: true } : undefined);
  };

  const begin = (id: string): void => {
    setInFlight((s) => new Set([...s, id]));
  };
  const end = (id: string): void => {
    setInFlight((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });
  };

  /**
   * After a decision in the dialog: the row leaves at once rather than with
   * the re-read, and the dialog moves to the next row **as the page drew them
   * when the decision was made** (`before`) — skipping any a poll has taken
   * since (`present`, the rows drawn now) — or closes at the end
   * (`advanceAfterDecide`). Only if the dialog is **still on that task**: a
   * reader who closed it while the request was out is not shown it again.
   * The re-read and the sidebar's count follow either way.
   */
  const decided = (id: string, before: readonly string[]): void => {
    const present = new Set(orderRef.current.filter((other) => other !== id));
    const next = advanceAfterDecide(before, id, present);
    setQueue((q) =>
      q === undefined ? q : { ...q, tasks: q.tasks.filter((item) => item.task.id !== id) },
    );
    if (openIdRef.current === id) openTask(next);
    load();
    onChanged?.();
  };

  const accept = (item: ReviewQueueItem): void => {
    const before = order;
    begin(item.task.id);
    setFailure(null);
    acceptReview(item.task.id)
      .then(() => {
        decided(item.task.id, before);
      })
      .catch((cause: unknown) => {
        setFailure({ taskId: item.task.id, message: errorText(cause) });
      })
      .finally(() => {
        end(item.task.id);
      });
  };

  /**
   * Accept every ticked row, **one request each, in the order the page draws
   * them** (`applyToEach`). The refused ids stay selected when it ends, so a
   * retry after reading the report is one click; the accepted rows leave
   * with the re-read.
   */
  const acceptSelected = (): void => {
    const ids = order.filter((id) => effective.has(id));
    if (ids.length === 0) return;
    const keyOf = new Map(items.map((item) => [item.task.id, item.task.key]));
    setRun({ phase: 'running', completed: 0, total: ids.length });
    void applyToEach(ids, acceptReview, (completed) => {
      setRun({ phase: 'running', completed, total: ids.length });
    }).then((outcome) => {
      setRun({
        phase: 'done',
        summary: acceptSummary(outcome),
        refusals: outcome.failed.map((f) => ({ key: keyOf.get(f.id) ?? f.id, message: f.message })),
      });
      setSelected(new Set(outcome.failed.map((f) => f.id)));
      load();
      onChanged?.();
    });
  };

  const sendBack = (reason: string): void => {
    if (sending === null) return;
    const item = sending;
    const before = order;
    begin(item.task.id);
    setSendError(undefined);
    sendBackReview(item.task.id, reason)
      .then(() => {
        setSending(null);
        decided(item.task.id, before);
      })
      .catch((cause: unknown) => {
        setSendError(errorText(cause));
      })
      .finally(() => {
        end(item.task.id);
      });
  };

  const filtered =
    filter.project !== null ||
    filter.assignee !== null ||
    filter.failing ||
    filter.noEvidence ||
    filter.ciFailed ||
    filter.ciConfirmed ||
    filter.fast;

  const header = (
    <ScreenHeader
      title="Review"
      context={
        queue === undefined
          ? 'Work agents handed back'
          : `${String(mine)} for you to decide · ${String(items.length)} in review${
              queue.truncated ? ' · first 200' : ''
            }`
      }
    />
  );

  if (error !== null) {
    return (
      <div className="rev">
        {header}
        <ApiErrorState error={error} resource="the review queue" scope="organisation" />
      </div>
    );
  }

  if (queue === undefined) {
    return (
      <div className="rev">
        {header}
        <LoadingState shape="row" count={3} label="Loading the review queue" />
      </div>
    );
  }

  const copy = SCREEN_COPY['/review'];
  const running = run?.phase === 'running';
  const position = openId === null ? null : positionOf(order, openId);
  if (position !== null) lastIndex.current = position.index;

  /** Where focus goes when the dialog closes: the row, else the first row, else a heading. */
  const restoreFromDialog = (): HTMLElement | null => {
    const key = openedKey.current;
    const row =
      key === null
        ? null
        : document.querySelector<HTMLElement>(`.rev-row[data-task="${CSS.escape(key)}"] .rev-line`);
    return (
      row ??
      document.querySelector<HTMLElement>('.rev-line') ??
      document.querySelector<HTMLElement>('.rev-group-title') ??
      document.querySelector<HTMLElement>('#rev-summary-title')
    );
  };

  /** The whole Hand-offs tab in the queue's place (D-146 item 4): `?view=handoffs`. */
  if (view === 'handoffs') {
    return (
      <div className="rev">
        {header}
        <div className="rev-back">
          <button
            type="button"
            className="bar-control"
            onClick={() => {
              setView('mine');
            }}
          >
            ← Back to review
          </button>
        </div>
        <HandoffsTab
          meId={handoffs.meId}
          counts={handoffs.counts}
          onChanged={handoffs.onChanged}
          onNavigate={onNavigate}
        />
      </div>
    );
  }

  return (
    <div className="rev">
      {header}

      <section className="prof-card rev-summary" aria-labelledby="rev-summary-title">
        <header className="prof-card-head">
          <h3 className="prof-card-title" id="rev-summary-title">
            Waiting for a person
          </h3>
          <span className="prof-card-caption">
            {decidable ? 'for you to decide' : 'everything in review'}
          </span>
          <InfoTip label="About the review queue">
            <dl className="prof-defs">
              <div>
                <dt>For you to decide</dt>
                <dd>
                  The tasks you may accept or send back: your own, and every one on a space you
                  administer. <em>Everything in review</em> lists the rest, read-only.
                </dd>
              </div>
              <div>
                <dt>Waiting</dt>
                <dd>Tasks in a review status, oldest first: since each last entered review.</dd>
              </div>
              <div>
                <dt>Proof</dt>
                <dd>
                  What the agent attached when it finished: commits, branch, pull request, test
                  runs. Each is claimed until something checks it.
                </dd>
              </div>
              <div>
                <dt>Check this one</dt>
                <dd>
                  Its first round finished in under a quarter of the time Laika forecast when work
                  started, and CI has not confirmed it. About the task, not the person: worth a
                  second look before accepting.
                </dd>
              </div>
              <div>
                <dt>Accept · Send back</dt>
                <dd>
                  Only a person signed in here decides. Accept moves it to done — tick several and
                  accept them together; send back returns one to in progress with your reason, which
                  the next agent reads first.
                </dd>
              </div>
            </dl>
          </InfoTip>
        </header>
        <dl className="prof-stats prof-stats-compact">
          <div className="prof-stat" data-stat="waiting">
            <dt className="prof-stat-label">Waiting</dt>
            <dd className="prof-stat-value">{figures.waiting}</dd>
          </div>
          <div className="prof-stat" data-stat="oldest">
            <dt className="prof-stat-label">Oldest</dt>
            <dd className="prof-stat-value">{figures.oldest}</dd>
          </div>
          <div className="prof-stat" data-stat="failing">
            <dt className="prof-stat-label">Failing tests</dt>
            <dd className="prof-stat-value">{figures.failing}</dd>
          </div>
          <div className="prof-stat" data-stat="bare">
            <dt className="prof-stat-label">No proof</dt>
            <dd className="prof-stat-value">{figures.bare}</dd>
          </div>
          <div className="prof-stat" data-stat="check">
            <dt className="prof-stat-label">Check these</dt>
            <dd className="prof-stat-value">{figures.fast}</dd>
          </div>
        </dl>
      </section>

      {notice !== null && (
        <p className="rev-notice" role="status">
          {notice}
        </p>
      )}

      <NeedsApprovalSection
        meId={handoffs.meId}
        counts={handoffs.counts}
        onChanged={handoffs.onChanged}
        onNavigate={onNavigate}
      />

      {items.length > 0 && (
        <div className="rev-filters" role="group" aria-label="Filter the queue">
          {/* The view first (D-146): what the page is about before how it is narrowed. */}
          <span className="rev-views" role="group" aria-label="Which tasks">
            <button
              type="button"
              className={decidable ? 'bar-control bar-control-on' : 'bar-control'}
              aria-pressed={decidable}
              onClick={() => {
                setView('mine');
              }}
            >
              For you to decide ({String(mine)})
            </button>
            <button
              type="button"
              className={!decidable ? 'bar-control bar-control-on' : 'bar-control'}
              aria-pressed={!decidable}
              onClick={() => {
                setView('all');
              }}
            >
              Everything in review ({String(items.length)})
            </button>
          </span>
          <Dropdown
            className="rev-filter"
            aria-label="Project"
            value={filter.project ?? ''}
            options={[
              { value: '', label: 'All projects' },
              ...projects.map(([slug, name]) => ({ value: slug, label: name })),
            ]}
            onChange={(value) => {
              setFilter((f) => ({ ...f, project: value === '' ? null : value }));
            }}
          />
          <Dropdown
            className="rev-filter"
            aria-label="Assignee"
            value={filter.assignee ?? ''}
            options={[
              { value: '', label: 'Anyone' },
              { value: 'none', label: 'Unassigned' },
              ...assignees.map(([id, name]) => ({ value: id, label: name })),
            ]}
            onChange={(value) => {
              setFilter((f) => ({ ...f, assignee: value === '' ? null : value }));
            }}
          />
          <button
            type="button"
            className={filter.failing ? 'bar-control bar-control-on' : 'bar-control'}
            aria-pressed={filter.failing}
            onClick={() => {
              setFilter((f) => ({ ...f, failing: !f.failing }));
            }}
          >
            Failing tests
          </button>
          <button
            type="button"
            className={filter.noEvidence ? 'bar-control bar-control-on' : 'bar-control'}
            aria-pressed={filter.noEvidence}
            onClick={() => {
              setFilter((f) => ({ ...f, noEvidence: !f.noEvidence }));
            }}
          >
            No proof
          </button>
          {/* GitHub's verdict on the head commit (D-083), as opposed to the
              exit codes the agent typed — the two can disagree, which is the
              point of having both. */}
          <button
            type="button"
            className={filter.ciFailed ? 'bar-control bar-control-on' : 'bar-control'}
            aria-pressed={filter.ciFailed}
            onClick={() => {
              setFilter((f) => ({ ...f, ciFailed: !f.ciFailed, ciConfirmed: false }));
            }}
          >
            CI failed
          </button>
          <button
            type="button"
            className={filter.ciConfirmed ? 'bar-control bar-control-on' : 'bar-control'}
            aria-pressed={filter.ciConfirmed}
            onClick={() => {
              setFilter((f) => ({ ...f, ciConfirmed: !f.ciConfirmed, ciFailed: false }));
            }}
          >
            CI confirmed
          </button>
          {/* LAI-772: finished far faster than forecast, nothing confirmed. */}
          <button
            type="button"
            className={filter.fast ? 'bar-control bar-control-on' : 'bar-control'}
            aria-pressed={filter.fast}
            onClick={() => {
              setFilter((f) => ({ ...f, fast: !f.fast }));
            }}
          >
            Check this one
          </button>
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState
          headline={copy?.headline ?? 'Nothing waiting for review'}
          {...(copy?.body === undefined ? {} : { body: copy.body })}
        />
      ) : decidable && mine === 0 && !filtered ? (
        <EmptyState
          headline="Nothing for you to decide"
          // The server sends the 200 oldest before marking who may decide
          // (D-146's second judgement call): past the cap, "someone else" is
          // only true of the first 200.
          body={
            queue.truncated
              ? `The first ${String(items.length)} tasks in review wait on someone else; yours may sit beyond them.`
              : `${String(items.length)} ${items.length === 1 ? 'task waits' : 'tasks wait'} on someone else.`
          }
          action={{
            label: 'Show everything in review',
            onClick: () => {
              setView('all');
            },
          }}
        />
      ) : shown.length === 0 && filtered ? (
        <EmptyState
          headline="Nothing matches these filters"
          body="Every task waiting for review is filtered out."
          action={{
            label: 'Clear filters',
            onClick: () => {
              setFilter(NO_FILTER);
            },
          }}
        />
      ) : (
        <ReviewGroups
          groups={groups}
          now={now}
          selected={effective}
          onSelect={setSelected}
          busy={running}
          open={openId}
          onOpen={(item) => {
            setFailure(null);
            setNotice(null);
            openTask(item.task.id, true);
          }}
        />
      )}

      {openId !== null && (openItem !== undefined || vanished) && (
        <ReviewDialog
          item={openItem}
          taskKey={openedKey.current ?? openId}
          position={position}
          now={now}
          deciding={openId !== null && inFlight.has(openId)}
          held={running || inFlight.size > 0}
          failure={failure?.taskId === openId ? failure.message : undefined}
          nameOf={nameOf}
          boardHref={boardHref}
          onNavigate={onNavigate}
          onPrev={() => {
            if (position?.prev != null) openTask(position.prev);
          }}
          onNext={() => {
            // From a vanished item: the row now drawn where it stood — the one
            // that was after it — else the first; with none left, close.
            const next =
              openItem === undefined
                ? (order[lastIndex.current] ?? order[0] ?? null)
                : (position?.next ?? null);
            openTask(next);
          }}
          onClose={() => {
            openTask(null);
          }}
          onAccept={accept}
          onSendBack={(item, from) => {
            opener.current = from;
            setSendError(undefined);
            setSending(item);
          }}
          restore={restoreFromDialog}
        >
          {sending !== null && (
            <SendBackDialog
              taskKey={sending.task.key}
              title={sending.task.title}
              busy={inFlight.has(sending.task.id)}
              error={sendError}
              onSend={sendBack}
              onClose={() => {
                setSending(null);
              }}
              // The Send back… button, unless the decision it sent has
              // disabled it meanwhile — then the dialog's heading, so focus
              // stays in the box (review round 1, item 1).
              restoreFocus={() => {
                const button = opener.current;
                return button !== null && button.isConnected && !button.matches(':disabled')
                  ? button
                  : document.querySelector<HTMLElement>('[data-dialog="review"] .rd-title');
              }}
            />
          )}
        </ReviewDialog>
      )}

      {(effective.size > 0 || run !== undefined) && (
        <ReviewBulkBar
          count={effective.size}
          run={run}
          onAccept={acceptSelected}
          onClear={() => {
            setSelected(NO_SELECTION);
            setRun(undefined);
          }}
          onDismissReport={() => {
            setRun(undefined);
          }}
        />
      )}
    </div>
  );
}
