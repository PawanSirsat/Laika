import { useEffect, useRef, useState } from 'react';
import { PING_WAIT_MS, getCapacityPing, pingAgent, type CapacityPing } from '../../api/capacity.ts';
import { timeLabel } from '../../api/time-label.ts';
import { PING_WORDS, answerItems, answeredAgo, isStale, pingRefusal } from './capacity-derive.ts';
import './agent.css';

/** How often a ping that got no answer within the wait is asked about again. */
const WATCH_EVERY_MS = 10_000;
/** How often the answer's age is re-read on screen. */
const TICK_MS = 10_000;

type Outcome =
  | { readonly kind: 'idle' }
  | { readonly kind: 'waiting' }
  | { readonly kind: 'answered'; readonly ping: CapacityPing }
  | { readonly kind: 'pending'; readonly ping: CapacityPing; readonly lost: boolean }
  | { readonly kind: 'expired' }
  | { readonly kind: 'refused' }
  | { readonly kind: 'limited'; readonly seconds: number; readonly until: number }
  | { readonly kind: 'failed'; readonly message: string };

export interface PingButtonProps {
  readonly agentId: string;
  /** The space's slug: a ping is asked, and may be refused, per space. */
  readonly project: string;
  /** The task it is asked about, from the drawer. */
  readonly taskId?: string | undefined;
  /** *Claude Code · Belka* — who is asked, in every sentence. */
  readonly target: string;
  /** `button`: the panels' small button. `link`: the drawer's quiet link. */
  readonly variant?: 'button' | 'link';
  /** An answer arrived — a screen showing presence reads it again. */
  readonly onAnswered?: ((ping: CapacityPing) => void) | undefined;
  /** An earlier answer to show until this one asks (the panel's latest). */
  readonly initial?: CapacityPing | null | undefined;
}

/**
 * **Ping** — ask a tool's device whether it can take work now (D-126, LAI-1102).
 *
 * `POST /agents/:id/capacity-pings`, held up to {@link PING_WAIT_MS}: *Waiting
 * for Claude Code · Belka…*, then the answer, every fact from the answer
 * itself. No answer within the wait says so, and the ping is asked about
 * again until it expires — a late answer still shows, and an expiry says so.
 * A `404` is the board's one answer for an agent that does not exist and one
 * this reader may not ping, and is said that way; a `429` names the wait.
 *
 * Offered only where the caller decided the reader may ping (`pingProjectFor`,
 * the drawer's own-agent check). **Never moves focus**: the button stays
 * where it is and is `aria-disabled` while busy, never `disabled`, so focus is
 * not dropped; what happened is read out by a polite live region that exists
 * before anything is put in it.
 */
export function PingButton({
  agentId,
  project,
  taskId,
  target,
  variant = 'button',
  onAnswered,
  initial,
}: PingButtonProps) {
  const [asked, setOutcome] = useState<Outcome>({ kind: 'idle' });
  // Until this button asks, the panel's latest answer is what it shows.
  const outcome: Outcome =
    asked.kind === 'idle' && initial !== undefined && initial !== null && initial.answer !== null
      ? { kind: 'answered', ping: initial }
      : asked;
  const [now, setNow] = useState(() => Date.now());
  const controller = useRef<AbortController | null>(null);
  const watch = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const answered = useRef(onAnswered);
  useEffect(() => {
    answered.current = onAnswered;
  }, [onAnswered]);

  // Everything this button started ends with it.
  useEffect(
    () => () => {
      controller.current?.abort();
      clearTimeout(watch.current);
    },
    [],
  );

  // An answer's age, and a rate limit's wait, move on screen.
  const ticking = outcome.kind === 'answered' || outcome.kind === 'limited';
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, [ticking]);
  const until = outcome.kind === 'limited' ? outcome.until : undefined;
  useEffect(() => {
    if (until === undefined) return;
    const timer = setTimeout(
      () => {
        setNow(Date.now());
      },
      Math.max(0, until - Date.now()),
    );
    return () => {
      clearTimeout(timer);
    };
  }, [until]);

  const settle = (ping: CapacityPing, signal: AbortSignal): void => {
    if (signal.aborted) return;
    if (ping.state === 'answered') {
      setNow(Date.now());
      setOutcome({ kind: 'answered', ping });
      answered.current?.(ping);
      return;
    }
    if (ping.state === 'expired') {
      setOutcome({ kind: 'expired' });
      return;
    }
    setOutcome({ kind: 'pending', ping, lost: false });
    // Asked about again until it expires, and once just after.
    const delay = Math.min(WATCH_EVERY_MS, Math.max(0, ping.expires_at - Date.now()) + 500);
    watch.current = setTimeout(() => {
      getCapacityPing(ping.id, signal)
        .then(({ ping: again }) => {
          settle(again, signal);
        })
        .catch(() => {
          if (signal.aborted) return;
          setOutcome({ kind: 'pending', ping, lost: true });
        });
    }, delay);
  };

  const limited = outcome.kind === 'limited' && now < outcome.until;
  const busy = outcome.kind === 'waiting' || outcome.kind === 'pending' || limited;

  const ping = (): void => {
    if (busy) return;
    controller.current?.abort();
    clearTimeout(watch.current);
    const next = new AbortController();
    controller.current = next;
    setOutcome({ kind: 'waiting' });
    pingAgent(
      agentId,
      { project, wait_ms: PING_WAIT_MS, ...(taskId === undefined ? {} : { task_id: taskId }) },
      next.signal,
    )
      .then(({ ping: first }) => {
        settle(first, next.signal);
      })
      .catch((cause: unknown) => {
        if (next.signal.aborted) return;
        const refusal = pingRefusal(cause);
        setNow(Date.now());
        setOutcome(
          refusal.kind === 'limited'
            ? { ...refusal, until: Date.now() + refusal.seconds * 1000 }
            : refusal,
        );
      });
  };

  return (
    <div
      className="agent-ping"
      data-ping={outcome.kind}
      data-variant={variant}
      aria-busy={outcome.kind === 'waiting' || undefined}
    >
      <button
        type="button"
        className={variant === 'link' ? 'agent-ping-link' : 'dx-btn dx-btn-sm agent-ping-button'}
        aria-disabled={busy || undefined}
        aria-label={`Ping ${target}`}
        onClick={ping}
      >
        Ping
      </button>
      <div className="agent-ping-status" role="status" aria-live="polite" aria-atomic="true">
        <PingStatus outcome={outcome} target={target} now={now} />
      </div>
    </div>
  );
}

function PingStatus({
  outcome,
  target,
  now,
}: {
  readonly outcome: Outcome;
  readonly target: string;
  readonly now: number;
}) {
  switch (outcome.kind) {
    case 'idle':
      return null;
    case 'waiting':
      return <p className="agent-ping-line">{PING_WORDS.waiting(target)}</p>;
    case 'pending':
      return (
        <p className="agent-ping-line" data-ping-pending>
          {PING_WORDS.noAnswer(PING_WAIT_MS / 1000)}
          {outcome.lost && ' The board could not be asked again.'}
        </p>
      );
    case 'expired':
      return <p className="agent-ping-line">{PING_WORDS.expired}</p>;
    case 'refused':
      return <p className="agent-ping-line agent-ping-problem">{PING_WORDS.refused(target)}</p>;
    case 'limited': {
      const left = Math.max(0, Math.ceil((outcome.until - now) / 1000));
      return (
        <p className="agent-ping-line agent-ping-problem">
          {left > 0 ? PING_WORDS.limited(target, left) : `${target} can be pinged again.`}
        </p>
      );
    }
    case 'failed':
      return (
        <p className="agent-ping-line agent-ping-problem">{PING_WORDS.failed(outcome.message)}</p>
      );
    case 'answered': {
      const { ping } = outcome;
      if (ping.answer === null || ping.answered_at === null) return null;
      const at = timeLabel(ping.answered_at, now);
      const stale = isStale(ping, now);
      return (
        <div className="agent-ping-answer" data-stale={stale || undefined}>
          <p className="agent-ping-line">
            {stale ? 'Stale: ' : ''}
            {target}{' '}
            <time dateTime={at.iso} title={at.full}>
              {answeredAgo(ping.answered_at, now)}
            </time>
            {stale && ' — ping again for its state now'}
          </p>
          <ul className="agent-ping-facts" aria-label={`${target}’s answer`}>
            {answerItems(ping.answer).map((item) => (
              <li key={item.key} data-answer={item.key}>
                {item.text}
              </li>
            ))}
          </ul>
        </div>
      );
    }
  }
}
