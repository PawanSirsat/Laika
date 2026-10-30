import { useEffect, useId, useRef, useState } from 'react';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { AgentChip } from '../../../components/agent/AgentChip.tsx';
import { Dropdown } from '../../../components/Dropdown.tsx';
import {
  diffLinesOf,
  getContextDiff,
  getContextRevision,
  listContextRevisions,
  type ContextDiff,
  type ContextRevision,
  type ContextRevisionSummary,
} from '../../../api/project-context.ts';
import { agentHarness, type RegisteredAgent } from '../../../api/agents.ts';
import { agentDevice, twinNames } from '../../../api/selected-agent.ts';
import type { Member } from '../../../api/tasks.ts';
import { dateTime } from '../../../api/time-label.ts';
import { DeliveredTo } from './DeliveredTo.tsx';

/**
 * What the reader asked to see under the history: one revision whole, or the
 * changes between two.
 */
export type ContextView =
  | { readonly kind: 'revision'; readonly revision: number }
  | { readonly kind: 'diff'; readonly from: number; readonly to: number };

type Load<T> =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly error: unknown }
  | { readonly kind: 'ready'; readonly value: T };

function isAbort(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError';
}

/**
 * One revision or one diff, fetched when `view` names it.
 *
 * A `ContextView` is a value the caller rebuilds on every render, so the
 * effect keys on its fields rather than on the object.
 */
function useContextView(
  slug: string,
  view: ContextView,
): Load<ContextRevision | ContextDiff> & { readonly retry: () => void } {
  const [state, setState] = useState<Load<ContextRevision | ContextDiff>>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const a = view.kind === 'revision' ? view.revision : view.from;
  const b = view.kind === 'revision' ? -1 : view.to;

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'loading' });
    const fetched: Promise<ContextRevision | ContextDiff> =
      b === -1
        ? getContextRevision(slug, a, controller.signal)
        : getContextDiff(slug, a, b, controller.signal);
    fetched
      .then((value) => {
        setState({ kind: 'ready', value });
      })
      .catch((cause: unknown) => {
        if (isAbort(cause)) return;
        setState({ kind: 'error', error: cause });
      });
    return () => {
      controller.abort();
    };
  }, [slug, a, b, attempt]);

  return {
    ...state,
    retry: () => {
      setAttempt((n) => n + 1);
    },
  };
}

export interface ContextDiffPanelProps {
  readonly slug: string;
  readonly from: number;
  readonly to: number;
  /** The diff was too large to send: open `to` whole instead. */
  readonly onOpenWhole: (revision: number) => void;
}

/**
 * The changes between two revisions, as the server diffed them (§6.4).
 *
 * **Truncated is said, never drawn as empty.** Past 2,000 changed lines the
 * server sends no diff at all; an empty box there would read as "nothing
 * changed", which is the opposite of the truth. The reader is told and offered
 * the revision whole.
 */
export function ContextDiffPanel({ slug, from, to, onOpenWhole }: ContextDiffPanelProps) {
  const state = useContextView(slug, { kind: 'diff', from, to });
  if (state.kind === 'loading') {
    return (
      <LoadingState
        shape="row"
        count={3}
        label={`Loading the changes r${String(from)} → r${String(to)}`}
      />
    );
  }
  if (state.kind === 'error') {
    return (
      <ApiErrorState
        error={state.error}
        resource="these changes"
        scope="project"
        onRetry={state.retry}
      />
    );
  }
  const diff = state.value as ContextDiff;
  if (diff.truncated) {
    return (
      <div className="ctx-diff-truncated" data-diff-truncated>
        <p>
          Too many lines changed between r{diff.from_revision} and r{diff.to_revision} to show them
          here, so no changes were sent.
        </p>
        <button
          type="button"
          className="ctx-link"
          onClick={() => {
            onOpenWhole(diff.to_revision);
          }}
        >
          Open r{diff.to_revision} in full
        </button>
      </div>
    );
  }
  const lines = diffLinesOf(diff.diff);
  if (lines.length === 0) {
    return (
      <p className="ctx-diff-none" data-diff-none>
        No changes between r{diff.from_revision} and r{diff.to_revision}.
      </p>
    );
  }
  return (
    <div className="ctx-diff-wrap">
      <p className="ctx-diff-count">
        <span className="ctx-diff-count-added">{diff.added ?? 0} added</span>
        {' · '}
        <span className="ctx-diff-count-removed">{diff.removed ?? 0} removed</span>
      </p>
      {/* A list rather than a <pre>: each line says what it is aloud, because
          colour alone is not the difference between added and removed. */}
      <ol className="ctx-diff" aria-label={`Changes from r${String(from)} to r${String(to)}`}>
        {lines.map((line, i) => (
          <li key={i} className={`ctx-diff-line ctx-diff-${line.kind}`} data-diff-line={line.kind}>
            <span className="ctx-diff-mark" aria-hidden="true">
              {line.kind === 'added'
                ? '+'
                : line.kind === 'removed'
                  ? '−'
                  : line.kind === 'hunk'
                    ? ''
                    : ' '}
            </span>
            {line.kind === 'added' && <span className="visually-hidden">Added: </span>}
            {line.kind === 'removed' && <span className="visually-hidden">Removed: </span>}
            <span className="ctx-diff-text">{line.text === '' ? ' ' : line.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** One revision's whole text, read-only. */
export function RevisionBody({
  slug,
  revision,
}: {
  readonly slug: string;
  readonly revision: number;
}) {
  const state = useContextView(slug, { kind: 'revision', revision });
  if (state.kind === 'loading') {
    return <LoadingState shape="row" count={3} label={`Loading r${String(revision)}`} />;
  }
  if (state.kind === 'error') {
    return (
      <ApiErrorState
        error={state.error}
        resource={`revision ${String(revision)}`}
        scope="project"
        onRetry={state.retry}
      />
    );
  }
  const body = (state.value as ContextRevision).body;
  return body === '' ? (
    <p className="ctx-diff-none">This revision is the empty document.</p>
  ) : (
    <pre className="ctx-revision-body" tabIndex={0} aria-label={`Text of r${String(revision)}`}>
      {body}
    </pre>
  );
}

export interface ContextHistoryProps {
  readonly slug: string;
  /**
   * Rises whenever the document may have changed — a save here, or a
   * `project.context_updated` frame. The list is read again **in place**: no
   * loading state, no focus moved, the open revision or comparison kept.
   */
  readonly refreshKey: number;
  readonly members: ReadonlyMap<string, Member>;
  /** The reader's own agents: the only ones this screen may name. */
  readonly agents: readonly RegisteredAgent[];
}

/**
 * The context document's revision history (SPEC §4.68, §6.4, LAI-556).
 *
 * Every save is a revision; this lists them newest first with who saved each —
 * the person, and the registered agent when one wrote it — when, and how long
 * the document was. Any revision opens whole, and any two compare through the
 * server's bounded diff.
 *
 * An agent is named only when it is **the reader's own** (`GET /agents` answers
 * nobody else's). Another person's agent is said to be an agent and not named:
 * the honest answer from what this reader may see.
 */
export function ContextHistory({ slug, refreshKey, members, agents }: ContextHistoryProps) {
  const [list, setList] = useState<Load<readonly ContextRevisionSummary[]>>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState<ContextView | undefined>(undefined);
  const [from, setFrom] = useState<number | undefined>(undefined);
  const [to, setTo] = useState<number | undefined>(undefined);
  const viewerRef = useRef<HTMLHeadingElement>(null);
  const moveFocus = useRef(false);
  const ids = useId();

  useEffect(() => {
    const controller = new AbortController();
    listContextRevisions(slug, controller.signal)
      .then((revisions) => {
        setList({ kind: 'ready', value: revisions });
      })
      .catch((cause: unknown) => {
        if (isAbort(cause)) return;
        // A failed refresh keeps the list already on screen; only a first
        // load with nothing to show becomes the error state.
        setList((was) => (was.kind === 'ready' ? was : { kind: 'error', error: cause }));
      });
    return () => {
      controller.abort();
    };
  }, [slug, refreshKey, attempt]);

  // Focus follows the reader's own action only — never a live refresh.
  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    viewerRef.current?.focus();
  }, [view]);

  /**
   * The control **outside** the viewer that opened it, so Hide can hand focus
   * back to it. Navigating inside the viewer — "Open r3 in full" from a
   * truncated comparison — keeps it: that button is gone once it is used.
   */
  const opener = useRef<HTMLElement | null>(null);

  const show = (next: ContextView): void => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest('[data-context-viewer]') === null) {
      opener.current = active;
    }
    moveFocus.current = true;
    setView(next);
  };

  if (list.kind === 'loading') {
    return (
      <section className="ctx-history" aria-labelledby={`${ids}-h`}>
        <h3 id={`${ids}-h`} className="ctx-history-title">
          History
        </h3>
        <LoadingState shape="row" count={3} label="Loading the revision history" />
      </section>
    );
  }
  if (list.kind === 'error') {
    return (
      <section className="ctx-history" aria-labelledby={`${ids}-h`}>
        <h3 id={`${ids}-h`} className="ctx-history-title">
          History
        </h3>
        <ApiErrorState
          error={list.error}
          resource="the revision history"
          scope="project"
          onRetry={() => {
            setList({ kind: 'loading' });
            setAttempt((n) => n + 1);
          }}
        />
      </section>
    );
  }

  const revisions = list.value;
  const current = revisions[0]?.revision;
  const pickFrom = from ?? revisions[1]?.revision ?? 0;
  const pickTo = to ?? current ?? 0;
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  // D-120: an agent is its harness and device. LAI-583's mark only where two
  // of the reader's agents share both — a legacy duplicate — never otherwise.
  const twins = twinNames(agents);

  return (
    <section className="ctx-history" aria-labelledby={`${ids}-h`} data-context-history>
      <h3 id={`${ids}-h`} className="ctx-history-title">
        History
      </h3>

      {revisions.length === 0 ? (
        <p className="ctx-history-empty" data-history-empty>
          No revisions yet. Each save becomes one, listed here with who saved it.
        </p>
      ) : (
        <>
          <ol className="ctx-revisions">
            {revisions.map((r) => {
              const author = r.author_id === null ? undefined : members.get(r.author_id);
              const agent = r.agent_id === null ? undefined : agentById.get(r.agent_id);
              const selected =
                view?.kind === 'revision' ? view.revision === r.revision : view?.to === r.revision;
              return (
                <li
                  key={r.revision}
                  className="ctx-revision"
                  data-revision={r.revision}
                  aria-current={selected ? 'true' : undefined}
                >
                  <div className="ctx-revision-head">
                    <code className="ctx-revision-number">r{r.revision}</code>
                    {r.revision === current && (
                      <span className="ctx-revision-current">Current</span>
                    )}
                    <span className="ctx-revision-who">
                      {r.author_id === null
                        ? 'Author not recorded'
                        : (author?.name ?? 'A former member')}
                    </span>
                    {agent !== undefined ? (
                      <span className="ctx-revision-agent">
                        <span className="visually-hidden">through </span>
                        <AgentChip
                          client={agentHarness(agent)}
                          device={agentDevice(agent)}
                          twin={twins.get(agent.id)}
                        />
                      </span>
                    ) : (
                      r.agent_id !== null && (
                        <span className="ctx-revision-agent-anon">through an agent</span>
                      )
                    )}
                  </div>
                  <div className="ctx-revision-meta">
                    <span>{dateTime(r.created_at, Date.now())}</span>
                    <span aria-hidden="true">·</span>
                    <span>{r.length.toLocaleString()} characters</span>
                  </div>
                  <div className="ctx-revision-actions">
                    <button
                      type="button"
                      className="ctx-link"
                      aria-label={`View r${String(r.revision)}`}
                      onClick={() => {
                        show({ kind: 'revision', revision: r.revision });
                      }}
                    >
                      View
                    </button>
                    <button
                      type="button"
                      className="ctx-link"
                      aria-label={`Changes in r${String(r.revision)}`}
                      onClick={() => {
                        show({ kind: 'diff', from: r.revision - 1, to: r.revision });
                      }}
                    >
                      Changes
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>

          <form
            className="ctx-compare"
            onSubmit={(event) => {
              event.preventDefault();
              show({
                kind: 'diff',
                from: Math.min(pickFrom, pickTo),
                to: Math.max(pickFrom, pickTo),
              });
            }}
          >
            <span className="ctx-compare-label">Compare</span>
            <Dropdown
              className="ctx-compare-field"
              aria-label="From revision"
              value={String(pickFrom)}
              options={[
                ...revisions.map((r) => ({
                  value: String(r.revision),
                  label: `r${String(r.revision)}`,
                })),
                { value: '0', label: 'r0 (empty)' },
              ]}
              onChange={(value) => {
                setFrom(Number(value));
              }}
            />
            <span aria-hidden="true">→</span>
            <Dropdown
              className="ctx-compare-field"
              aria-label="To revision"
              value={String(pickTo)}
              options={revisions.map((r) => ({
                value: String(r.revision),
                label: `r${String(r.revision)}`,
              }))}
              onChange={(value) => {
                setTo(Number(value));
              }}
            />
            <button type="submit" className="ctx-secondary" disabled={pickFrom === pickTo}>
              Compare
            </button>
          </form>
        </>
      )}

      {view !== undefined && (
        <section className="ctx-viewer" aria-labelledby={`${ids}-v`} data-context-viewer>
          <div className="ctx-viewer-head">
            <h4 id={`${ids}-v`} className="ctx-viewer-title" tabIndex={-1} ref={viewerRef}>
              {view.kind === 'revision'
                ? `r${String(view.revision)}`
                : `Changes r${String(view.from)} → r${String(view.to)}`}
            </h4>
            <button
              type="button"
              className="ctx-link"
              onClick={() => {
                setView(undefined);
                // Hide removes itself; focus goes back to what opened the
                // viewer rather than falling to the page.
                opener.current?.focus();
              }}
            >
              Hide
            </button>
          </div>
          {view.kind === 'revision' ? (
            <>
              <RevisionBody slug={slug} revision={view.revision} />
              <DeliveredTo slug={slug} revision={view.revision} agents={agents} />
            </>
          ) : (
            <ContextDiffPanel
              slug={slug}
              from={view.from}
              to={view.to}
              onOpenWhole={(revision) => {
                show({ kind: 'revision', revision });
              }}
            />
          )}
        </section>
      )}
    </section>
  );
}
