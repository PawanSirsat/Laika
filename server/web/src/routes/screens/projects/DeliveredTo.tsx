import { useEffect, useId, useState } from 'react';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { AgentChip } from '../../../components/agent/AgentChip.tsx';
import {
  DELIVERIES_PAGE,
  listContextDeliveries,
  type ContextDeliveries,
  type ContextDelivery,
} from '../../../api/project-context.ts';
import { agentHarness, type RegisteredAgent } from '../../../api/agents.ts';
import { agentDevice, twinNames } from '../../../api/selected-agent.ts';
import { timeLabel } from '../../../api/time-label.ts';

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly error: unknown }
  | {
      readonly kind: 'ready';
      /** The revision these answers are for — never shown under another. */
      readonly revision: number;
      readonly on: ContextDeliveries;
      readonly all: ContextDeliveries;
    };

function isAbort(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError';
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

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'loading' });
    Promise.all([
      listContextDeliveries(slug, revision, controller.signal),
      listContextDeliveries(slug, null, controller.signal),
    ])
      .then(([on, all]) => {
        if (controller.signal.aborted) return;
        setState({ kind: 'ready', revision, on, all });
      })
      .catch((cause: unknown) => {
        if (isAbort(cause) || controller.signal.aborted) return;
        setState({ kind: 'error', error: cause });
      });
    return () => {
      controller.abort();
    };
  }, [slug, revision, attempt]);

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
    const older = state.all.data.filter((d) => d.revision < revision);
    body = (
      <>
        {state.on.data.length === 0 ? (
          <p className="ctx-delivered-empty" data-delivered-empty>
            Not delivered to any agent session yet.
          </p>
        ) : (
          <ul className="ctx-deliveries" aria-label={`Sessions that received ${r}`}>
            {state.on.data.map((d) => row(d, false))}
          </ul>
        )}
        {state.on.next_cursor !== null && (
          <p className="ctx-delivered-more">Showing the {DELIVERIES_PAGE} most recent sessions.</p>
        )}
        {older.length > 0 && (
          <div className="ctx-delivered-older" data-delivered-older>
            <h6 className="ctx-delivered-subtitle" id={`${ids}-o`}>
              Still on an older revision
            </h6>
            <ul className="ctx-deliveries" aria-labelledby={`${ids}-o`}>
              {older.map((d) => row(d, true))}
            </ul>
            {state.all.next_cursor !== null && (
              <p className="ctx-delivered-more">
                Checked the {DELIVERIES_PAGE} most recent sessions.
              </p>
            )}
          </div>
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
