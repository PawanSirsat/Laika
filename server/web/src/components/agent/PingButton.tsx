import { useEffect, useRef, useState } from 'react';
import { PING_WAIT_MS, getCapacityPing, pingAgent, type CapacityPing } from '../../api/capacity.ts';
import { clockTime, timeLabel } from '../../api/time-label.ts';
import { PING_WORDS, answerItems, answeredAgo, isStale, pingRefusal } from './capacity-derive.ts';
import { Tooltip } from '../tooltip/Tooltip.tsx';
import './agent.css';

/** How often a ping that got no answer within the wait is asked about again. */
const WATCH_EVERY_MS = 10_000;
/**
 * How often a ping is asked about **inside** the wait. The board holds only
 * one request per requester per ping and answers a repeat at once with the
 * ping as it stands (LAI-1038 review), so a `pending` that comes back early
 * is not *no answer* yet: the wait is the reader's, from their click.
 */
const WAIT_POLL_MS = 1_000;
/** How often the answer's age is re-read on screen. */
const TICK_MS = 10_000;
/**
 * How long one check may take. A check is a read the board answers at once,
 * so one that has not come back by then is a failed check, retried like any
 * other: a request that hangs can never hold Ping (LAI-1108).
 */
const CHECK_TIMEOUT_MS = 5_000;
/**
 * How long the ping itself may take. The board holds it at most the wait, so
 * an answer later than the wait and this margin is not coming (LAI-1108).
 */
const POST_TIMEOUT_MS = PING_WAIT_MS + 5_000;

type Outcome =
  | { readonly kind: 'idle' }
  /** Inside the reader's wait. `lost`: the last check failed, and another is on its way. */
  | { readonly kind: 'waiting'; readonly lost: boolean }
  | { readonly kind: 'answered'; readonly ping: CapacityPing }
  /** The wait is over and the ping is still open. `lost` as above. */
  | { readonly kind: 'pending'; readonly ping: CapacityPing; readonly lost: boolean }
  /** `unread`: it expired while the board could not be reached — answered or not is unknown. */
  | { readonly kind: 'expired'; readonly unread: boolean }
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
 * itself. A `pending` that comes back before the wait is over — a repeat,
 * which the board answers at once — is asked about again until the wait
 * ends. No answer within the wait says so, and the ping is asked about
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

  // An answer's age moves on screen; a rate limit's end is timed below.
  const ticking = outcome.kind === 'answered';
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

  /** Ask about `ping` again in `delay`; `failures` checks in a row have failed. */
  const check = (
    ping: CapacityPing,
    signal: AbortSignal,
    waitUntil: number,
    delay: number,
    failures: number,
  ): void => {
    watch.current = setTimeout(() => {
      // Its own deadline beside the button's lifetime; `signal.aborted` below
      // is the button's alone, so a check that timed out is lost, not dropped.
      getCapacityPing(ping.id, AbortSignal.any([signal, AbortSignal.timeout(CHECK_TIMEOUT_MS)]))
        .then(({ ping: again }) => {
          settle(again, signal, waitUntil);
        })
        .catch(() => {
          if (signal.aborted) return;
          lose(ping, signal, waitUntil, failures + 1);
        });
    }, delay);
  };

  /** What a ping's state means now, `waitUntil` being the end of the reader's wait. */
  const settle = (ping: CapacityPing, signal: AbortSignal, waitUntil: number): void => {
    if (signal.aborted) return;
    if (ping.state === 'answered') {
      setNow(Date.now());
      setOutcome({ kind: 'answered', ping });
      answered.current?.(ping);
      return;
    }
    if (ping.state === 'expired') {
      setOutcome({ kind: 'expired', unread: false });
      return;
    }
    const at = Date.now();
    // Inside the wait it is still *Waiting…*; after it, *no answer*, asked
    // about again until it expires, and once just after.
    if (at < waitUntil) {
      // A failed check, once said inside the wait, stays said until the
      // outcome changes kind: a board that flaps failed / recovered is not
      // read out again on every flap (LAI-1108).
      setOutcome((was) =>
        was.kind === 'waiting' && was.lost ? was : { kind: 'waiting', lost: false },
      );
      check(ping, signal, waitUntil, Math.min(WAIT_POLL_MS, waitUntil - at), 0);
      return;
    }
    setOutcome({ kind: 'pending', ping, lost: false });
    check(
      ping,
      signal,
      waitUntil,
      Math.min(WATCH_EVERY_MS, Math.max(0, ping.expires_at - at) + 500),
      0,
    );
  };

  /**
   * A check failed (LAI-1102 review, B2). The ping's own clock still holds:
   * ask again, backing off — 1 s, 2 s, 4 s, up to the usual 10 s — but never
   * past the end of the wait, so *no answer* is said on time, nor past the
   * expiry, after which a failed check is the last: *expired, answered or not
   * unknown*. A failure inside the wait is still *Waiting…*, never an early
   * *no answer*.
   */
  const lose = (
    ping: CapacityPing,
    signal: AbortSignal,
    waitUntil: number,
    failures: number,
  ): void => {
    const at = Date.now();
    if (at >= ping.expires_at) {
      setOutcome({ kind: 'expired', unread: true });
      return;
    }
    const inWait = at < waitUntil;
    setOutcome(inWait ? { kind: 'waiting', lost: true } : { kind: 'pending', ping, lost: true });
    const backoff = Math.min(WATCH_EVERY_MS, WAIT_POLL_MS * 2 ** (failures - 1));
    const bound = inWait ? waitUntil - at : Math.max(0, ping.expires_at - at) + 500;
    check(ping, signal, waitUntil, Math.min(backoff, bound), failures);
  };

  const limited = outcome.kind === 'limited' && now < outcome.until;
  // A ping still being watched holds the button; one whose checks are failing
  // does not — asking again is the reader's way out.
  const busy =
    outcome.kind === 'waiting' || (outcome.kind === 'pending' && !outcome.lost) || limited;

  const ping = (): void => {
    if (busy) return;
    controller.current?.abort();
    clearTimeout(watch.current);
    const next = new AbortController();
    controller.current = next;
    const waitUntil = Date.now() + PING_WAIT_MS;
    setOutcome({ kind: 'waiting', lost: false });
    const deadline = AbortSignal.timeout(POST_TIMEOUT_MS);
    pingAgent(
      agentId,
      { project, wait_ms: PING_WAIT_MS, ...(taskId === undefined ? {} : { task_id: taskId }) },
      AbortSignal.any([next.signal, deadline]),
    )
      .then(({ ping: first }) => {
        settle(first, next.signal, waitUntil);
      })
      .catch((cause: unknown) => {
        if (next.signal.aborted) return;
        const refusal = deadline.aborted
          ? { kind: 'failed' as const, message: PING_WORDS.unanswered(POST_TIMEOUT_MS / 1000) }
          : pingRefusal(cause);
        // One reading of the clock for both: two would put `until` a moment
        // past `now + seconds`, and the wait would round up to a second more
        // than the board said.
        const at = Date.now();
        setNow(at);
        setOutcome(
          refusal.kind === 'limited' ? { ...refusal, until: at + refusal.seconds * 1000 } : refusal,
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
      <div
        className="agent-ping-status"
        data-stale={(outcome.kind === 'answered' && isStale(outcome.ping, now)) || undefined}
      >
        {/* How long ago moves on screen and is not read out: it sits outside
            the live region, which changes only when the outcome does
            (LAI-1102 review). */}
        {outcome.kind === 'answered' && <AnswerAge ping={outcome.ping} target={target} now={now} />}
        <div className="agent-ping-live" role="status" aria-live="polite" aria-atomic="true">
          <PingStatus outcome={outcome} target={target} limitPassed={!limited} />
        </div>
      </div>
    </div>
  );
}

function AnswerAge({
  ping,
  target,
  now,
}: {
  readonly ping: CapacityPing;
  readonly target: string;
  readonly now: number;
}) {
  if (ping.answered_at === null) return null;
  const at = timeLabel(ping.answered_at, now);
  const stale = isStale(ping, now);
  return (
    <p className="agent-ping-line agent-ping-age">
      {stale ? 'Stale: ' : ''}
      {target}{' '}
      <Tooltip content={at.full} lazy>
        <time dateTime={at.iso}>{answeredAgo(ping.answered_at, now)}</time>
      </Tooltip>
      {stale && ' — ping again for its state now'}
    </p>
  );
}

function PingStatus({
  outcome,
  target,
  limitPassed,
}: {
  readonly outcome: Outcome;
  readonly target: string;
  /** The rate limit's wait is over: said once, never counted down aloud. */
  readonly limitPassed: boolean;
}) {
  switch (outcome.kind) {
    case 'idle':
      return null;
    case 'waiting':
      return (
        <p className="agent-ping-line">
          {outcome.lost ? PING_WORDS.waitingLost(target) : PING_WORDS.waiting(target)}
        </p>
      );
    case 'pending':
      return (
        <p className="agent-ping-line" data-ping-pending>
          {outcome.lost
            ? PING_WORDS.noAnswerLost(
                PING_WAIT_MS / 1000,
                clockTime(outcome.ping.expires_at, { seconds: true }),
              )
            : PING_WORDS.noAnswer(PING_WAIT_MS / 1000)}
        </p>
      );
    case 'expired':
      return (
        <p className="agent-ping-line">
          {outcome.unread ? PING_WORDS.expiredUnread(target) : PING_WORDS.expired}
        </p>
      );
    case 'refused':
      return <p className="agent-ping-line agent-ping-problem">{PING_WORDS.refused(target)}</p>;
    case 'limited':
      return (
        <p className="agent-ping-line agent-ping-problem">
          {limitPassed
            ? `${target} can be pinged again.`
            : PING_WORDS.limited(target, outcome.seconds)}
        </p>
      );
    case 'failed':
      return (
        <p className="agent-ping-line agent-ping-problem">{PING_WORDS.failed(outcome.message)}</p>
      );
    case 'answered': {
      const { answer } = outcome.ping;
      if (answer === null) return null;
      return (
        <>
          <span className="visually-hidden">{target} answered.</span>
          <ul className="agent-ping-facts" aria-label={`${target}’s answer`}>
            {answerItems(answer).map((item) => (
              <li key={item.key} data-answer={item.key}>
                {item.text}
              </li>
            ))}
          </ul>
        </>
      );
    }
  }
}
