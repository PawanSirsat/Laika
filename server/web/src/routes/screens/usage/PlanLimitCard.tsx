import { useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '../../../api/errors.ts';
import { parseTokens } from '../../../api/budgets.ts';
import {
  clearPlanLimit,
  forecastLine,
  getPlanLimit,
  minuteLabel,
  parseMinute,
  planFact,
  PLAN_KINDS,
  PLAN_LABELS,
  PLAN_SOURCE,
  PLAN_WINDOWS,
  setPlanLimit,
  usedLine,
  WEEKDAYS,
  WINDOW_LABELS,
  type PlanKind,
  type PlanLimit,
  type PlanWindow,
} from '../../../api/plan-limit.ts';
import { compactTokens, readerZone } from '../../../api/usage.ts';
import { Dropdown } from '../../../components/Dropdown.tsx';
import { InfoTip } from '../profile/InfoTip.tsx';

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly view: PlanLimit }
  | { readonly kind: 'error'; readonly message: string };

/**
 * *Your plan limit* (LAI-773, D-087): the developer's own limit and their own
 * recent rate — *"at this rate you reach your limit around 15:40"* — on the
 * Usage page, **for them and nobody else**: the read and the write are their
 * own, on a web session, and no admin or agent can ask for it.
 *
 * **An estimate, and said to be, twice.** Laika sees when tokens reached the
 * board, within a sync of when they were spent, and the vendor's own meter
 * is not Laika's. And **no plan carries a token figure**: Anthropic states its
 * plans' limits as five-hour sessions and a weekly limit, not tokens, so the
 * number is the developer's.
 */
export function PlanLimitCard() {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const [plan, setPlan] = useState<PlanKind>('claude-pro');
  const [span, setSpan] = useState<PlanWindow>('5h');
  const [limit, setLimit] = useState('');
  const [weekday, setWeekday] = useState(1);
  const [time, setTime] = useState('09:00');

  useEffect(() => {
    const controller = new AbortController();
    getPlanLimit(controller.signal)
      .then((view) => {
        if (controller.signal.aborted) return;
        setLoad({ kind: 'ready', view });
        setEditing(view.plan === null);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setLoad({
          kind: 'error',
          message: cause instanceof ApiError ? cause.message : 'Your plan limit could not be read.',
        });
      });
    return () => {
      controller.abort();
    };
  }, []);

  const startEdit = (view: PlanLimit): void => {
    setPlan(view.plan ?? 'claude-pro');
    setSpan(view.window ?? '5h');
    setLimit(view.limit_tokens === null ? '' : compactTokens(view.limit_tokens));
    setWeekday(view.week_reset?.weekday ?? 1);
    setTime(minuteLabel(view.week_reset?.minute ?? 540));
    setError(undefined);
    setEditing(true);
  };

  const save = (event: FormEvent): void => {
    event.preventDefault();
    const tokens = parseTokens(limit);
    if (tokens === undefined) {
      setError('Enter your limit as a number of tokens — 2,500,000 or 2.5M.');
      return;
    }
    const minute = parseMinute(time);
    if (span === 'week' && minute === undefined) {
      setError('Enter the reset time as HH:MM.');
      return;
    }
    setBusy(true);
    setError(undefined);
    setPlanLimit({
      plan,
      window: span,
      limit_tokens: tokens,
      tz: readerZone(),
      ...(span === 'week' ? { week_reset: { weekday, minute: minute ?? 0 } } : {}),
    })
      .then((view) => {
        setLoad({ kind: 'ready', view });
        setEditing(false);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof ApiError ? cause.message : 'That did not save.');
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const clear = (): void => {
    setBusy(true);
    setError(undefined);
    clearPlanLimit()
      .then(() => getPlanLimit())
      .then((view) => {
        setLoad({ kind: 'ready', view });
        setEditing(true);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof ApiError ? cause.message : 'That did not clear.');
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const view = load.kind === 'ready' ? load.view : undefined;

  return (
    <section
      className="prof-card usage-card usage-plan"
      data-section="plan-limit"
      aria-labelledby="usage-plan-title"
    >
      <header className="prof-card-head">
        <h3 className="prof-card-title" id="usage-plan-title">
          Your plan limit
        </h3>
        <span className="prof-card-caption">yours only · an estimate</span>
        <InfoTip label="About the plan limit">
          <p className="usage-info">
            Only you see this — not owners, not admins, not your agents. It is an{' '}
            <strong>estimate</strong>: Laika counts the tokens that reached the board from your
            machines, within a sync of when they were spent, and your plan’s own meter is not
            Laika’s. No plan’s limit is published in tokens —{' '}
            <a href={PLAN_SOURCE} target="_blank" rel="noreferrer">
              Anthropic describes them
            </a>{' '}
            as a session that resets every five hours and a weekly limit — so the number is yours.
          </p>
        </InfoTip>
      </header>

      {load.kind === 'loading' && <p className="prof-empty">Reading your plan limit…</p>}
      {load.kind === 'error' && <p className="prof-empty">{load.message}</p>}

      {view !== undefined && !editing && view.plan !== null && (
        <div className="usage-plan-body">
          <p className="usage-plan-forecast" data-forecast>
            {forecastLine(view)}
          </p>
          <p className="usage-plan-meta">
            <span className="usage-plan-estimate">Estimate</span> {usedLine(view)} ·{' '}
            {PLAN_LABELS[view.plan]} · {view.window === null ? '' : WINDOW_LABELS[view.window]}
            {view.week_reset !== null &&
              ` (resets ${WEEKDAYS[view.week_reset.weekday] ?? ''} ${minuteLabel(view.week_reset.minute)})`}
          </p>
          <div className="usage-plan-actions">
            <button
              type="button"
              className="usage-chip"
              onClick={() => {
                startEdit(view);
              }}
            >
              Change
            </button>
            <button type="button" className="usage-chip" disabled={busy} onClick={clear}>
              Clear
            </button>
          </div>
        </div>
      )}

      {view !== undefined && editing && (
        <form className="usage-plan-form" onSubmit={save} aria-label="Your plan limit">
          <div className="usage-field">
            <label className="usage-field-label" htmlFor="usage-plan-kind">
              Plan
            </label>
            <Dropdown<PlanKind>
              id="usage-plan-kind"
              value={plan}
              options={PLAN_KINDS.map((p) => ({ value: p, label: PLAN_LABELS[p] }))}
              onChange={setPlan}
            />
            <span className="usage-field-note">{planFact(plan)}</span>
          </div>
          <div className="usage-field">
            <label className="usage-field-label" htmlFor="usage-plan-window">
              Counted over
            </label>
            <Dropdown<PlanWindow>
              id="usage-plan-window"
              value={span}
              options={PLAN_WINDOWS.map((w) => ({ value: w, label: WINDOW_LABELS[w] }))}
              onChange={setSpan}
            />
          </div>
          {span === 'week' && (
            <div className="usage-field-row">
              <div className="usage-field">
                <label className="usage-field-label" htmlFor="usage-plan-weekday">
                  Resets on
                </label>
                <Dropdown
                  id="usage-plan-weekday"
                  value={String(weekday)}
                  options={WEEKDAYS.map((day, i) => ({ value: String(i), label: day }))}
                  onChange={(value) => {
                    setWeekday(Number(value));
                  }}
                />
              </div>
              <label className="usage-field">
                <span className="usage-field-label">at</span>
                <input
                  className="input"
                  value={time}
                  inputMode="numeric"
                  aria-label="Reset time, HH:MM"
                  onChange={(e) => {
                    setTime(e.target.value);
                  }}
                />
              </label>
            </div>
          )}
          <label className="usage-field">
            <span className="usage-field-label">Your limit, in tokens</span>
            <input
              className="input"
              value={limit}
              placeholder="2.5M"
              inputMode="decimal"
              onChange={(e) => {
                setLimit(e.target.value);
              }}
            />
            <span className="usage-field-note">
              Input, output and cache writes — the figure the Usage page counts. Yours to set: no
              plan publishes one.
            </span>
          </label>
          {error !== undefined && (
            <p className="usage-form-error" role="alert">
              {error}
            </p>
          )}
          <div className="usage-plan-actions">
            <button type="submit" className="usage-chip" aria-pressed="true" disabled={busy}>
              Save
            </button>
            {view.plan !== null && (
              <button
                type="button"
                className="usage-chip"
                onClick={() => {
                  setEditing(false);
                }}
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      )}
      {!editing && error !== undefined && (
        <p className="usage-form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
