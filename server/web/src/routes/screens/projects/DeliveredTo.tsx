import { useEffect, useId, useRef, useState } from 'react';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { AgentChip } from '../../../components/agent/AgentChip.tsx';
import { listContextDeliveries, type ContextDelivery } from '../../../api/project-context.ts';
import { agentHarness, type RegisteredAgent } from '../../../api/agents.ts';
import { agentDevice, twinNames } from '../../../api/selected-agent.ts';
import { timeLabel } from '../../../api/time-label.ts';

/** The two reads: the sessions on the revision, and every session's latest. */
type Which = 'on' | 'all';

/** One read's pages so far, and the cursor for the next, if there is one. */
interface Pages {
  readonly rows: readonly ContextDelivery[];
  readonly next_cursor: string | null;
}

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly error: unknown }
  | {
      readonly kind: 'ready';
      /** The revision these answers are for — never shown under another. */
      readonly revision: number;
      readonly on: Pages;
      readonly all: Pages;
      /** The *Show more* read in flight: one at a time, for either list. */
      readonly more: Which | null;
      /** The last *Show more* failed; the rows already shown stay. */
      readonly moreFailed: boolean;
    };

function isAbort(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError';
}

/**
 * One row a session, at the **highest** revision any answer saw it on.
 *
 * The reads are separate requests, so they can describe different moments: a
 * session sent r3 between them is r2 in one answer and r3 in the other, and
 * would otherwise be listed both as having received r3 and as still on r2. The
 * server only ever moves a session forward (§4.69), so the highest revision
 * seen is the latest known. A session past `revision` is under a later one
 * and is in neither list; newest first, as the server orders a page.
 */
function reconcile(revision: number, ...reads: readonly (readonly ContextDelivery[])[]) {
  const latest = new Map<string, ContextDelivery>();
  for (const rows of reads) {
    for (const d of rows) {
      const seen = latest.get(d.session_id);
      if (
        seen === undefined ||
        d.revision > seen.revision ||
        (d.revision === seen.revision && d.delivered_at > seen.delivered_at)
      ) {
        latest.set(d.session_id, d);
      }
    }
  }
  const newest = [...latest.values()].sort(
    (a, b) =>
      b.delivered_at - a.delivered_at ||
      (a.session_id < b.session_id ? 1 : a.session_id > b.session_id ? -1 : 0),
  );
  return {
    on: newest.filter((d) => d.revision === revision),
    older: newest.filter((d) => d.revision < revision),
  };
}

/** The tail of a session id: enough to tell two apart, the whole on hover. */
function shortSession(id: string): string {
  return id.length <= 6 ? id : `…${id.slice(-6)}`;
}

export interface DeliveredToProps {
  readonly slug: string;
  readonly revision: number;
  /** The reader's own agents, for the twin mark History already uses. */
  readonly agents: readonly RegisteredAgent[];
}

/**
 * **Delivered to** — the agent sessions Laika sent a revision to (SPEC §4.69,
 * §6.4, LAI-1004).
 *
 * Two things the wording must not overstate. *Delivered* is what the server
 * did: it sent the revision, and what the agent did with it is not known, so
 * a row says **received**. And the server keeps each session's **latest**
 * delivery only (LAI-1003): a session sent a later revision is listed there
 * and no longer here, which the note under the heading says.
 *
 * Sessions still on an older revision are listed apart, each saying which
 * revision it **has**. An agent is named by its harness and device only when
 * it is the reader's own; the server sends no label for anyone else's
 * (D-121), and the row says so.
 */
export function DeliveredTo({ slug, revision, agents }: DeliveredToProps) {
  const [state, setState] = useState<Load>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const ids = useId();
  /** The *Show more* read in flight, so a new revision or a retry can abort it. */
  const moreRead = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'loading' });
    Promise.all([
      listContextDeliveries(slug, revision, controller.signal),
      listContextDeliveries(slug, null, controller.signal),
    ])
      .then(([on, all]) => {
        if (controller.signal.aborted) return;
        setState({
          kind: 'ready',
          revision,
          on: { rows: on.data, next_cursor: on.next_cursor },
          all: { rows: all.data, next_cursor: all.next_cursor },
          more: null,
          moreFailed: false,
        });
      })
      .catch((cause: unknown) => {
        if (isAbort(cause) || controller.signal.aborted) return;
        setState({ kind: 'error', error: cause });
      });
    return () => {
      controller.abort();
      moreRead.current?.abort();
      moreRead.current = null;
    };
  }, [slug, revision, attempt]);

  /**
   * The next page of one list — one page of at most §6.3's maximum a click,
   * and one read at a time. An answer for another revision, or for a list
   * already read again from the top, is dropped: never appended to rows it
   * does not belong to.
   */
  const showMore = (which: Which): void => {
    if (state.kind !== 'ready' || state.more !== null) return;
    const cursor = state[which].next_cursor;
    if (cursor === null) return;
    const asked = state.revision;
    const controller = new AbortController();
    moreRead.current = controller;
    setState({ ...state, more: which, moreFailed: false });
    listContextDeliveries(slug, which === 'on' ? asked : null, controller.signal, cursor)
      .then((page) => {
        if (controller.signal.aborted) return;
        setState((s) =>
          s.kind !== 'ready' || s.revision !== asked || s[which].next_cursor !== cursor
            ? s
            : {
                ...s,
                [which]: { rows: [...s[which].rows, ...page.data], next_cursor: page.next_cursor },
                more: null,
              },
        );
      })
      .catch((cause: unknown) => {
        if (isAbort(cause) || controller.signal.aborted) return;
        setState((s) =>
          s.kind !== 'ready' || s.revision !== asked ? s : { ...s, more: null, moreFailed: true },
        );
      })
      .finally(() => {
        if (moreRead.current === controller) moreRead.current = null;
      });
  };

  const moreButton = (which: Which, label: string) =>
    state.kind === 'ready' && (
      <button
        type="button"
        className="ctx-link"
        data-delivered-more={which}
        aria-label={state.more === which ? undefined : label}
        disabled={state.more !== null}
        onClick={() => {
          showMore(which);
        }}
      >
        {state.more === which ? 'Loading…' : 'Show more'}
      </button>
    );

  const twins = twinNames(agents);
  const r = `r${String(revision)}`;

  const row = (d: ContextDelivery, older: boolean) => {
    const when = timeLabel(d.delivered_at, Date.now());
    return (
      <li key={d.session_id} className="ctx-delivery" data-delivery={d.session_id}>
        <span className="ctx-delivery-who">
          {d.agent === null ? (
            <span className="ctx-delivery-anon">Another person’s agent</span>
          ) : (
            <>
              <AgentChip
                client={agentHarness(d.agent)}
                device={agentDevice(d.agent)}
                twin={twins.get(d.agent.id)}
              />
              {d.agent.status === 'revoked' && <span className="ctx-delivery-flag">revoked</span>}
            </>
          )}
        </span>
        <span className="ctx-delivery-meta">
          <span className="ctx-delivery-session" title={d.session_id}>
            session <code>{shortSession(d.session_id)}</code>
          </span>
          {older && (
            <span className="ctx-delivery-has" data-delivery-has={d.revision}>
              has r{d.revision}
            </span>
          )}
          <span>
            received{' '}
            <time
              className="ctx-delivery-when"
              dateTime={when.iso}
              title={when.full}
              data-full={when.full}
              tabIndex={0}
              aria-label={`${when.text}, ${when.full}`}
            >
              {when.text}
            </time>
          </span>
          {d.session_ended_at !== null && <span className="ctx-delivery-flag">session ended</span>}
        </span>
      </li>
    );
  };

  let body;
  if (state.kind === 'error') {
    body = (
      <ApiErrorState
        error={state.error}
        resource={`who ${r} was delivered to`}
        scope="project"
        onRetry={() => {
          setAttempt((n) => n + 1);
        }}
      />
    );
  } else if (state.kind === 'loading' || state.revision !== revision) {
    body = <LoadingState shape="row" count={2} label={`Loading who ${r} was delivered to`} />;
  } else {
    const { on, older } = reconcile(revision, state.on.rows, state.all.rows);
    body = (
      <>
        {on.length === 0 ? (
          <p className="ctx-delivered-empty" data-delivered-empty>
            Not delivered to any agent session yet.
          </p>
        ) : (
          <ul className="ctx-deliveries" aria-label={`Sessions that received ${r}`}>
            {on.map((d) => row(d, false))}
          </ul>
        )}
        {state.on.next_cursor !== null && (
          <p className="ctx-delivered-more" data-delivered-truncated="on">
            More sessions received {r} than the {on.length} shown.{' '}
            {moreButton('on', `Show more sessions that received ${r}`)}
          </p>
        )}
        {older.length > 0 && (
          <div className="ctx-delivered-older" data-delivered-older>
            <h6 className="ctx-delivered-subtitle" id={`${ids}-o`}>
              Still on an older revision
            </h6>
            <ul className="ctx-deliveries" aria-labelledby={`${ids}-o`}>
              {older.map((d) => row(d, true))}
            </ul>
          </div>
        )}
        {state.all.next_cursor !== null && (
          <p className="ctx-delivered-more" data-delivered-truncated="all">
            Checked the {state.all.rows.length} most recent sessions for one still on an older
            revision; there are more.{' '}
            {moreButton('all', 'Show more sessions checked for an older revision')}
          </p>
        )}
        {state.moreFailed && (
          <p className="ctx-delivered-more" role="alert" data-delivered-more-failed>
            The next page did not load. Show more tries again.
          </p>
        )}
      </>
    );
  }

  return (
    <section className="ctx-delivered" aria-labelledby={`${ids}-h`} data-delivered-to>
      <h5 id={`${ids}-h`} className="ctx-delivered-title">
        Delivered to
      </h5>
      <p className="ctx-delivered-note">
        Agent sessions Laika sent {r} to. Received says only that it was sent, not what the agent
        did with it. Each session is listed under the latest revision it was sent, so one sent a
        later revision moves there.
      </p>
      {body}
    </section>
  );
}
