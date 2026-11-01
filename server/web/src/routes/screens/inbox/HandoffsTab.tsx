import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import {
  approveHandoff,
  cancelHandoff,
  handoffRefusal,
  listPersonHandoffs,
  PERSON_INBOX_VIEWS,
  type PersonHandoffAgent,
  type PersonHandoffView,
  type PersonInboxCounts,
  type PersonInboxView,
} from '../../../api/handoffs.ts';
import { agentDevice, selectedHarness } from '../../../api/selected-agent.ts';
import { clockTime } from '../../../api/time-label.ts';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { EmptyState } from '../../../components/EmptyState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { AgentChip } from '../../../components/agent/AgentChip.tsx';
import { Spinner } from '../../../components/Spinner.tsx';
import { KindShape } from '../../../components/agent/HandoffInbox.tsx';
import {
  HANDOFF_FILTER_WORDS,
  HANDOFF_KIND_WORDS,
} from '../../../components/agent/agent-states.ts';
import { ageWords } from '../../../components/agent/execution-derive.ts';
import {
  acceptanceWords,
  approvalWords,
  checkpointWords,
  EMPTY_VIEW_WORDS,
  expiryWords,
  mayApprove,
  mayWithdraw,
  mergeHeld,
  nextActionWords,
  type ShownRow,
} from '../../../components/agent/person-handoffs.ts';
import { plainClick, taskHref } from '../my-day/task-link.ts';
import '../../../components/agent/agent.css';

/** Offers expire in minutes; a visible tab re-reads twice a minute, quietly. */
const POLL_MS = 30_000;
const PAGE = 50;

export interface HandoffsTabProps {
  /** The signed-in person, for *Approve*: never offered for an agent they own. */
  readonly meId: string | undefined;
  /** The shell's counts, shown until this tab's own read answers. */
  readonly counts: PersonInboxCounts | undefined;
  /** An approve or a withdraw changed the badge: the shell re-reads it. */
  readonly onChanged: () => void;
  readonly onNavigate: (to: string) => void;
}

interface Loaded {
  readonly status: 'loading' | 'ready' | 'error';
  readonly rows: readonly ShownRow[];
  readonly waiting: number;
  readonly cursor: string | null;
  readonly counts: PersonInboxCounts | undefined;
  readonly error: unknown;
  /** When the last read that succeeded answered. */
  readonly readAt: number | undefined;
  /** A re-read failed after one succeeded: what is shown is as of `readAt`. */
  readonly stale: boolean;
}

const START: Loaded = {
  status: 'loading',
  rows: [],
  waiting: 0,
  cursor: null,
  counts: undefined,
  error: undefined,
  readAt: undefined,
  stale: false,
};

/**
 * Inbox → Hand-offs (LAI-550), from a person's inbox as the server serves it
 * (`GET /handoff-offers`, LAI-1009): four views, each the server's, with the
 * server's live counts.
 *
 * **A re-read never moves the row being acted on.** While a write is in
 * flight or the focus is inside the list, rows change in place, one the view
 * no longer lists stays (marked), and new ones wait behind *Show N new* —
 * {@link mergeHeld}. Nothing here takes the focus.
 */
export function HandoffsTab({ meId, counts, onChanged, onNavigate }: HandoffsTabProps) {
  const [view, setView] = useState<PersonInboxView>('received');
  const [closed, setClosed] = useState(false);
  const [state, setState] = useState<Loaded>(START);
  const [attempt, setAttempt] = useState(0);
  /*
   * **Every row's write in flight, not the last one started** (LAI-550 review
   * round 2). One id let Approve on row B re-enable row A while A's request
   * was still out, so A could be sent twice. The ref is checked and changed
   * synchronously, so two clicks before a render still send one request; the
   * state is what the rows draw.
   */
  const pending = useRef(new Set<string>());
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  const [focusInside, setFocusInside] = useState(false);
  const [notes, setNotes] = useState<Readonly<Record<string, { error: boolean; words: string }>>>(
    {},
  );
  const latest = useRef<readonly PersonHandoffView[]>([]);
  const holding = busy.size > 0 || focusInside;
  const holdingRef = useRef(holding);
  useEffect(() => {
    holdingRef.current = holding;
  }, [holding]);
  const panelId = useId();
  const tabIds = useId();
  const closedId = useId();
  /** The *Show more* read in flight, so a change of view can abort it. */
  const more = useRef<AbortController | null>(null);
  const tabRefs = useRef<Partial<Record<PersonInboxView, HTMLButtonElement | null>>>({});

  // A new view or the closed toggle starts again; a re-read of the same keeps what is drawn.
  const shownFor = useRef(`${view}:${String(closed)}`);
  useEffect(() => {
    const key = `${view}:${String(closed)}`;
    const fresh = shownFor.current !== key;
    if (fresh) {
      shownFor.current = key;
      more.current?.abort();
      setState(START);
      setNotes({});
    }
    const controller = new AbortController();
    listPersonHandoffs({ view, includeClosed: closed, limit: PAGE }, controller.signal)
      .then((page) => {
        latest.current = page.data;
        setState((s) => {
          const merged = mergeHeld(s.rows, page.data, !fresh && holdingRef.current);
          return {
            status: 'ready',
            rows: merged.rows,
            waiting: merged.waiting,
            cursor: page.next_cursor,
            counts: page.counts,
            error: undefined,
            readAt: Date.now(),
            stale: false,
          };
        });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        // A failed re-read is not news about the offers: keep them, say they are stale.
        setState((s) =>
          s.status === 'ready'
            ? { ...s, stale: true }
            : { ...START, status: 'error', error: cause },
        );
      });
    return () => {
      controller.abort();
    };
  }, [view, closed, attempt]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') setAttempt((n) => n + 1);
    }, POLL_MS);
    return () => {
      clearInterval(timer);
    };
  }, []);

  // The hold ended: put the newest answer in the server's order.
  useEffect(() => {
    if (holding) return;
    setState((s) =>
      s.status === 'ready' && (s.waiting > 0 || s.rows.some((r) => r.gone))
        ? { ...s, rows: mergeHeld(s.rows, latest.current, false).rows, waiting: 0 }
        : s,
    );
  }, [holding]);

  const reread = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  useEffect(
    () => () => {
      more.current?.abort();
    },
    [],
  );

  /**
   * The next page of **this** view. A later page belongs to the view and the
   * cursor it was asked for: one that answers after the reader moved to
   * another view, or after the list was read again from the top, is dropped —
   * never appended to rows it does not belong to (LAI-550 review).
   */
  const loadMore = (): void => {
    if (state.cursor === null) return;
    const cursor = state.cursor;
    const key = `${view}:${String(closed)}`;
    more.current?.abort();
    const controller = new AbortController();
    more.current = controller;
    listPersonHandoffs({ view, includeClosed: closed, limit: PAGE, cursor }, controller.signal)
      .then((page) => {
        if (controller.signal.aborted || shownFor.current !== key) return;
        setState((s) => {
          if (s.cursor !== cursor) return s;
          latest.current = [...latest.current, ...page.data];
          return {
            ...s,
            rows: [...s.rows, ...page.data.map((row) => ({ row, gone: false }))],
            cursor: page.next_cursor,
            counts: page.counts,
          };
        });
      })
      .catch(() => {
        if (controller.signal.aborted || shownFor.current !== key) return;
        setState((s) => ({ ...s, stale: true }));
      });
  };

  /** Another view: what is drawn, and any page in flight, belong to the last one. */
  const switchTo = (next: PersonInboxView): void => {
    if (next === view) return;
    more.current?.abort();
    // Cleared in the same render as the selection, so the selected tab
    // never sits over the last view's rows.
    setState(START);
    setView(next);
  };

  /** The tabs pattern's keys: arrows move and select, Home and End jump (WAI-ARIA APG). */
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>): void => {
    const at = PERSON_INBOX_VIEWS.indexOf(view);
    const last = PERSON_INBOX_VIEWS.length - 1;
    let to: number | undefined;
    if (event.key === 'ArrowRight') to = at === last ? 0 : at + 1;
    else if (event.key === 'ArrowLeft') to = at === 0 ? last : at - 1;
    else if (event.key === 'Home') to = 0;
    else if (event.key === 'End') to = last;
    const next = to === undefined ? undefined : PERSON_INBOX_VIEWS[to];
    if (next === undefined) return;
    event.preventDefault();
    switchTo(next);
    tabRefs.current[next]?.focus();
  };

  const write = (kind: 'approve' | 'withdraw', row: PersonHandoffView): void => {
    if (pending.current.has(row.id)) return;
    pending.current.add(row.id);
    setBusy(new Set(pending.current));
    setNotes((n) => ({ ...n, [row.id]: { error: false, words: '' } }));
    (kind === 'approve' ? approveHandoff(row.id) : cancelHandoff(row.id))
      .then(() => {
        setNotes((n) => ({
          ...n,
          [row.id]: {
            error: false,
            words:
              kind === 'approve'
                ? 'Approved. The receiving agent still has to accept it.'
                : 'Withdrawn. The sender’s claim resumes.',
          },
        }));
        onChanged();
        reread();
      })
      .catch((cause: unknown) => {
        setNotes((n) => ({ ...n, [row.id]: { error: true, words: handoffRefusal(cause) } }));
        reread();
      })
      .finally(() => {
        pending.current.delete(row.id);
        setBusy(new Set(pending.current));
      });
  };

  const shownCounts = state.counts ?? counts;

  const onFocus = (): void => {
    setFocusInside(true);
  };
  const onBlur = (event: FocusEvent<HTMLElement>): void => {
    if (!event.currentTarget.contains(event.relatedTarget)) setFocusInside(false);
  };

  return (
    <section className="handoff-inbox handoffs-tab" aria-label="Hand-offs" data-handoffs-tab>
      <div className="handoffs-toolbar">
        <div className="handoff-filters" role="tablist" aria-label="Show hand-offs">
          {PERSON_INBOX_VIEWS.map((id) => {
            const count = shownCounts?.[id];
            const selected = id === view;
            return (
              <button
                key={id}
                ref={(el) => {
                  tabRefs.current[id] = el;
                }}
                id={`${tabIds}-${id}`}
                type="button"
                role="tab"
                className="handoff-filter"
                aria-selected={selected}
                aria-controls={panelId}
                tabIndex={selected ? 0 : -1}
                data-filter={id}
                onClick={() => {
                  switchTo(id);
                }}
                onKeyDown={onTabKey}
              >
                {HANDOFF_FILTER_WORDS[id]}
                {count !== undefined && count > 0 && (
                  <span className="handoff-filter-count" data-count={id}>
                    {count}
                    <span className="visually-hidden"> open</span>
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <label className="handoffs-closed" htmlFor={closedId}>
          <input
            id={closedId}
            type="checkbox"
            checked={closed}
            onChange={(event) => {
              more.current?.abort();
              setState(START);
              setClosed(event.target.checked);
            }}
          />
          Show closed and expired
        </label>
      </div>

      <div
        id={panelId}
        role="tabpanel"
        aria-labelledby={`${tabIds}-${view}`}
        className="handoffs-panel"
      >
        {state.stale && (
          <p className="handoffs-stale" role="status" data-stale>
            Could not refresh — showing what was read at{' '}
            {state.readAt === undefined ? 'the last read' : clockTime(state.readAt)}.{' '}
            <button type="button" className="button button-secondary" onClick={reread}>
              Try again
            </button>
          </p>
        )}

        {state.waiting > 0 && (
          <p className="handoffs-waiting" role="status">
            <button
              type="button"
              className="button button-secondary"
              data-show-new
              onClick={() => {
                setFocusInside(false);
                setState((s) => ({
                  ...s,
                  rows: mergeHeld(s.rows, latest.current, false).rows,
                  waiting: 0,
                }));
              }}
            >
              Show {state.waiting} new
            </button>
          </p>
        )}

        {state.status === 'loading' && (
          <LoadingState shape="row" count={3} label="Loading hand-offs" />
        )}
        {state.status === 'error' && (
          <ApiErrorState error={state.error} resource="your hand-offs" onRetry={reread} />
        )}
        {state.status === 'ready' && state.rows.length === 0 && (
          <EmptyState
            headline={`Nothing in ${HANDOFF_FILTER_WORDS[view]}`}
            body={
              closed
                ? EMPTY_VIEW_WORDS[view]
                : `${EMPTY_VIEW_WORDS[view]} Closed and expired offers are hidden.`
            }
          />
        )}
        {state.status === 'ready' && state.rows.length > 0 && (
          <ul className="handoff-list" onFocus={onFocus} onBlur={onBlur}>
            {state.rows.map(({ row, gone }) => (
              <HandoffRow
                key={row.id}
                row={row}
                gone={gone}
                meId={meId}
                busy={busy.has(row.id)}
                note={notes[row.id]}
                onNavigate={onNavigate}
                onApprove={() => {
                  write('approve', row);
                }}
                onWithdraw={() => {
                  write('withdraw', row);
                }}
              />
            ))}
          </ul>
        )}
        {state.status === 'ready' && state.cursor !== null && (
          <button
            type="button"
            className="button button-secondary handoffs-more"
            onClick={loadMore}
          >
            Show more
          </button>
        )}
      </div>
    </section>
  );
}

interface HandoffRowProps {
  readonly row: PersonHandoffView;
  readonly gone: boolean;
  readonly meId: string | undefined;
  readonly busy: boolean;
  readonly note: { readonly error: boolean; readonly words: string } | undefined;
  readonly onNavigate: (to: string) => void;
  readonly onApprove: () => void;
  readonly onWithdraw: () => void;
}

function HandoffRow({
  row,
  gone,
  meId,
  busy,
  note,
  onNavigate,
  onApprove,
  onWithdraw,
}: HandoffRowProps) {
  const titleId = useId();
  const href = taskHref({ id: row.task_id, key: row.task_key }, row.project_slug);
  // A row kept only because the reader is acting nearby offers nothing: its
  // hint is from a read the server has since replaced.
  const approve = !gone && mayApprove(row, meId);
  const withdraw = !gone && mayWithdraw(row);
  const hasAction = approve || withdraw;
  const expiry = expiryWords(row);
  const now = Date.now();
  const next = nextActionWords(row);

  /*
   * **A re-read can take away the control the reader is on** — Approve becomes
   * *waiting for the receiver*. The browser then drops the focus to <body>.
   * So an action that had the focus is remembered, and when it is gone the
   * focus moves to this row's *Next* line and the change is said politely.
   * Nothing moves the focus unless it was lost (LAI-550 review).
   */
  const nextRef = useRef<HTMLElement>(null);
  const actionFocused = useRef(false);
  const [moved, setMoved] = useState('');
  useEffect(() => {
    if (hasAction || !actionFocused.current) return;
    actionFocused.current = false;
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    nextRef.current?.focus();
    setMoved(`That action is no longer available. Next: ${next}`);
  }, [hasAction, next]);
  const onActionFocus = (): void => {
    actionFocused.current = true;
  };
  const onActionBlur = (event: FocusEvent<HTMLButtonElement>): void => {
    // A blur the reader caused leaves the button in the page; one caused by
    // the button being removed does not, and then the focus was lost.
    const button = event.currentTarget;
    queueMicrotask(() => {
      if (button.isConnected) actionFocused.current = false;
    });
  };
  return (
    <li
      className={
        gone ? 'handoff-row handoff-row-live handoff-row-gone' : 'handoff-row handoff-row-live'
      }
      data-kind={row.kind}
      data-state={row.state}
      data-offer-id={row.id}
      aria-labelledby={titleId}
      aria-busy={busy}
    >
      <span className="handoff-kind">
        <KindShape kind={row.kind} />
        {HANDOFF_KIND_WORDS[row.kind]}
      </span>
      <a
        id={titleId}
        className="handoff-task"
        href={href}
        onClick={(event: MouseEvent) => {
          if (!plainClick(event)) return;
          event.preventDefault();
          onNavigate(href);
        }}
      >
        <code>{row.task_key}</code> {row.task_title}
      </a>
      <span className="handoff-route">
        <Party
          agent={row.from_agent}
          meId={meId}
          unnamed={
            row.kind === 'recovery' && !row.from_agent_redacted
              ? 'The expired claim'
              : 'A registered agent'
          }
        />
        <span aria-hidden="true">→</span>
        <span className="visually-hidden">to</span>
        <Party
          agent={row.to_agent}
          meId={meId}
          unnamed={row.to_agent_redacted ? 'A registered agent' : 'Any eligible agent'}
        />
      </span>
      <dl className="handoffs-facts">
        <div>
          <dt>Approval</dt>
          <dd data-approval>{approvalWords(row)}</dd>
        </div>
        <div>
          <dt>Acceptance</dt>
          <dd data-acceptance>{acceptanceWords(row)}</dd>
        </div>
        <div>
          <dt>Save</dt>
          <dd data-checkpoint>{checkpointWords(row, now)}</dd>
        </div>
        {row.reason !== null && row.reason !== '' && (
          <div>
            <dt>Reason</dt>
            {/* Untrusted (D-115 item 7): text, never markup. */}
            <dd className="handoffs-reason">{row.reason}</dd>
          </div>
        )}
        <div>
          <dt>Next</dt>
          <dd data-next={row.next_action} ref={nextRef} tabIndex={-1}>
            {next}
          </dd>
        </div>
      </dl>
      <span className="handoff-state">
        Offered {ageWords(Math.max(0, now - row.created_at))}
        {expiry !== undefined && ` · ${expiry}`}
        {gone && ' · No longer in this view'}
      </span>
      {hasAction && (
        <span className="handoffs-actions">
          {approve && (
            <button
              type="button"
              className="button button-primary"
              aria-disabled={busy || undefined}
              aria-busy={busy || undefined}
              onClick={() => {
                // Not `disabled`: a disabled button loses the focus mid-write.
                if (!busy) onApprove();
              }}
              onFocus={onActionFocus}
              onBlur={onActionBlur}
              data-approve
            >
              {busy && <Spinner size="sm" />}
              Approve
            </button>
          )}
          {withdraw && (
            <button
              type="button"
              className="button button-secondary"
              aria-disabled={busy || undefined}
              aria-busy={busy || undefined}
              onClick={() => {
                // Not `disabled`: a disabled button loses the focus mid-write.
                if (!busy) onWithdraw();
              }}
              onFocus={onActionFocus}
              onBlur={onActionBlur}
              data-withdraw
            >
              {busy && <Spinner size="sm" />}
              Withdraw
            </button>
          )}
        </span>
      )}
      {note?.error === true && note.words !== '' && (
        <p className="handoffs-note handoffs-note-error" role="alert">
          {note.words}
        </p>
      )}
      {/* Always present, so what lands in it is announced — politely. */}
      <p className="handoffs-note" role="status" data-row-status>
        {note !== undefined && !note.error && note.words !== '' ? note.words : moved}
      </p>
    </li>
  );
}

/** An agent as *harness · device*, with whose it is. */
function Party({
  agent,
  meId,
  unnamed,
}: {
  readonly agent: PersonHandoffAgent | null;
  readonly meId: string | undefined;
  readonly unnamed: string;
}) {
  if (agent === null) return <span className="handoff-nobody">{unnamed}</span>;
  const owner = agent.owner.id === meId ? 'yours' : agent.owner.name;
  return (
    <span className="handoffs-party">
      <AgentChip
        client={selectedHarness(agent)}
        device={agentDevice(agent)}
        owner={agent.owner.name}
      />
      <span className="handoffs-owner">{owner}</span>
    </span>
  );
}
