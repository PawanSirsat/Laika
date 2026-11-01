import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  acceptReview,
  ciLine,
  ciVerdict,
  evidenceSummary,
  roundAgentName,
  filterQueue,
  getReviewQueue,
  NO_FILTER,
  proofStamp,
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
import { Spinner } from '../../../components/Spinner.tsx';
import { buildLabel } from '../../../api/estimates.ts';
import { InfoTip } from '../profile/InfoTip.tsx';
import { EvidenceSection } from '../task/EvidenceSection.tsx';
import { SCREEN_COPY } from '../screen-copy.ts';
import { SendBackDialog } from './SendBackDialog.tsx';
import '../profile/profile.css';
import './review.css';

export interface ReviewScreenProps {
  /** Go somewhere in the app — the board, for "Open on board". */
  readonly onNavigate: (to: string) => void;
  /** An accept or a send-back changed the queue — the sidebar's count re-reads. */
  readonly onChanged?: () => void;
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
 * The review queue (§11.4, D-082, LAI-758): every task waiting in a review
 * status on the projects this person can act on, oldest waiting first, with
 * the proof each finish carried. A person accepts it into done or sends it
 * back with a reason; nothing else on the board can mark agent work done.
 */
export function ReviewScreen({ onNavigate, onChanged }: ReviewScreenProps) {
  const [queue, setQueue] = useState<ReviewQueue | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [filter, setFilter] = useState<QueueFilter>(NO_FILTER);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ taskId: string; message: string } | null>(null);
  const [sending, setSending] = useState<ReviewQueueItem | null>(null);
  const [sendError, setSendError] = useState<string | undefined>(undefined);
  const [now, setNow] = useState(() => Date.now());
  const loaded = useRef(false);
  const opener = useRef<HTMLButtonElement | null>(null);

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

  const items = useMemo(() => queue?.tasks ?? [], [queue]);
  const shown = useMemo(() => filterQueue(items, filter), [items, filter]);

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
    const summaries = items.map((i) => evidenceSummary(i.round));
    return {
      waiting: items.length,
      oldest: items[0] === undefined ? '—' : waitingFor(items[0].waiting_since, now),
      failing: summaries.filter((s) => s.testsFailed > 0).length,
      bare: summaries.filter((s) => s.empty).length,
      fast: items.filter((i) => i.cue !== null).length,
    };
  }, [items, now]);

  const decided = (): void => {
    setSelected(null);
    load();
    onChanged?.();
  };

  const accept = (item: ReviewQueueItem): void => {
    setBusy(item.task.id);
    setFailure(null);
    acceptReview(item.task.id)
      .then(decided)
      .catch((cause: unknown) => {
        setFailure({ taskId: item.task.id, message: errorText(cause) });
      })
      .finally(() => {
        setBusy(null);
      });
  };

  const sendBack = (reason: string): void => {
    if (sending === null) return;
    const item = sending;
    setBusy(item.task.id);
    setSendError(undefined);
    sendBackReview(item.task.id, reason)
      .then(() => {
        setSending(null);
        decided();
      })
      .catch((cause: unknown) => {
        setSendError(errorText(cause));
      })
      .finally(() => {
        setBusy(null);
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
          : `${String(items.length)} waiting · oldest first${queue.truncated ? ' · first 200' : ''}`
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

  return (
    <div className="rev">
      {header}

      <section className="prof-card rev-summary" aria-labelledby="rev-summary-title">
        <header className="prof-card-head">
          <h3 className="prof-card-title" id="rev-summary-title">
            Waiting for a person
          </h3>
          <span className="prof-card-caption">across every project you can act on</span>
          <InfoTip label="About the review queue">
            <dl className="prof-defs">
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
                  Only a person signed in here decides. Accept moves it to done; send back returns
                  it to in progress with your reason, which the next agent reads first.
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

      {items.length > 0 && (
        <div className="rev-filters" role="group" aria-label="Filter the queue">
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
        <ul className="rev-list" aria-label="Tasks waiting for review">
          {shown.map((item) => {
            const open = selected === item.task.id;
            const summary = evidenceSummary(item.round);
            const ci = ciVerdict(item.round);
            const agent = item.round === null ? null : roundAgentName(item.round);
            const deciding = busy === item.task.id;
            return (
              <li
                key={item.task.id}
                className={open ? 'rev-row rev-row-open' : 'rev-row'}
                data-task={item.task.key}
              >
                <button
                  type="button"
                  className="rev-line"
                  aria-expanded={open}
                  aria-controls={`rev-detail-${item.task.id}`}
                  onClick={() => {
                    setSelected(open ? null : item.task.id);
                    setFailure(null);
                  }}
                >
                  <span className="rev-key">{item.task.key}</span>
                  <span className="rev-title">{item.task.title}</span>
                  <span className="rev-wait" title="Waiting since it entered review">
                    {waitingFor(item.waiting_since, now)}
                  </span>
                  <span className="rev-meta">
                    <span>{item.project.name}</span>
                    <span>{item.assignee_name ?? 'Unassigned'}</span>
                    {agent !== null && <span className="rev-agent">{agent}</span>}
                    {item.round !== null && <span>round {item.round.number}</span>}
                  </span>
                  <span className="rev-proof">
                    {item.cue !== null && (
                      <span
                        className="rev-chip rev-chip-check"
                        data-cue={item.cue.kind}
                        title={`Finished in ${buildLabel(item.cue.build_ms)} against a forecast of ${buildLabel(
                          item.cue.forecast_p50_ms,
                        )}, and CI has not confirmed it`}
                      >
                        check this one
                      </span>
                    )}
                    {summary.empty ? (
                      <span className="rev-chip rev-chip-none">no proof</span>
                    ) : (
                      <>
                        {summary.commits > 0 && (
                          <span className="rev-chip">
                            {summary.commits} {summary.commits === 1 ? 'commit' : 'commits'}
                          </span>
                        )}
                        {summary.pullRequest !== null && <span className="rev-chip">PR</span>}
                        {summary.testsPassed > 0 && (
                          <span className="rev-chip rev-chip-pass">
                            ✓ {summary.testsPassed} passed
                          </span>
                        )}
                        {summary.testsFailed > 0 && (
                          <span className="rev-chip rev-chip-fail">
                            ✗ {summary.testsFailed} failed
                          </span>
                        )}
                        {ci !== 'none' && item.round?.ci != null && (
                          <span
                            className={`rev-chip rev-chip-ci rev-chip-ci-${ci}`}
                            title={ciLine(item.round.ci)}
                            data-ci={ci}
                          >
                            {ci === 'failed' ? '✗ CI' : ci === 'confirmed' ? '✓ CI' : '… CI'}
                          </span>
                        )}
                      </>
                    )}
                  </span>
                </button>

                {open && (
                  <div className="rev-detail" id={`rev-detail-${item.task.id}`}>
                    <EvidenceSection
                      taskId={item.task.id}
                      // GitHub's confirmations move no task, so the queue's own
                      // re-read is what notices them (D-083).
                      refreshKey={item.task.updated_at + proofStamp(item.round)}
                      sendBack={item.task.send_back}
                      nameOf={nameOf}
                    />
                    {failure?.taskId === item.task.id && (
                      <p className="rev-error" role="alert">
                        {failure.message}
                      </p>
                    )}
                    <div className="rev-actions">
                      <button
                        type="button"
                        className="bar-control bar-control-primary"
                        disabled={!item.can_decide || deciding}
                        onClick={() => {
                          accept(item);
                        }}
                      >
                        {deciding && sending === null && <Spinner size="sm" />}
                        Accept
                      </button>
                      <button
                        type="button"
                        className="bar-control"
                        disabled={!item.can_decide || deciding}
                        onClick={(event) => {
                          opener.current = event.currentTarget;
                          setSendError(undefined);
                          setSending(item);
                        }}
                      >
                        Send back…
                      </button>
                      <a
                        className="rev-open"
                        href={boardHref(item)}
                        onClick={(event) => {
                          event.preventDefault();
                          onNavigate(boardHref(item));
                        }}
                      >
                        Open on board
                      </a>
                      {!item.can_decide && (
                        <span className="rev-why">
                          Only the assignee, a space admin or an organisation admin decides this
                          one.
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {sending !== null && (
        <SendBackDialog
          taskKey={sending.task.key}
          title={sending.task.title}
          busy={busy === sending.task.id}
          error={sendError}
          onSend={sendBack}
          onClose={() => {
            setSending(null);
          }}
          restoreFocus={() => opener.current}
        />
      )}
    </div>
  );
}
