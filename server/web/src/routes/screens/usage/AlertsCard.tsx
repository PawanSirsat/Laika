import { useState, type MouseEvent } from 'react';
import { ApiError } from '../../../api/errors.ts';
import {
  alertHref,
  alertLine,
  dismissTokenAlert,
  type TokenAlert,
} from '../../../api/token-alerts.ts';
import { compactTokens } from '../../../api/usage.ts';
import { useToast } from '../../../components/toast/ToastProvider.tsx';
import { InfoTip } from '../profile/InfoTip.tsx';
import { alertRows } from './usage-derive.ts';
import { Icon } from '../../../components/icon/Icon.tsx';
import { Tooltip } from '../../../components/tooltip/Tooltip.tsx';

/** How many alerts show before *Show all N* (the owner's design, LAI-1127). */
export const ALERTS_COLLAPSED = 6;

/**
 * *Budget alerts* (LAI-773, laid out to the owner's design in LAI-1127): the
 * signed-in person's own open token alerts — budgets crossed on work they
 * hold or lead, and a runaway agent on a task of theirs — most spent first,
 * each with a way to it and a way to put it away. The list is the shell's
 * (`GET /me/token-alerts`), so this card and the rail's badge are one answer.
 *
 * In-app only: nothing here is emailed or sent anywhere. Soft: an alert
 * refuses nothing, and putting one away changes only this person's view.
 * *Dismiss all* is one `POST …/dismiss` per alert — there is no bulk route.
 *
 * Putting alerts away says so in the app's toast once the server has taken
 * them (LAI-1129) — with no Undo, because there is no endpoint that brings a
 * dismissed alert back, and no confirm either: it takes nothing that matters.
 */
export function AlertsCard({
  alerts,
  onNavigate,
  onChanged,
}: {
  readonly alerts: readonly TokenAlert[] | undefined;
  readonly onNavigate: (to: string) => void;
  readonly onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = useState(false);
  const toast = useToast();

  const open = alertRows((alerts ?? []).filter((a) => !gone.has(a.id)));
  const shown = expanded ? open : open.slice(0, ALERTS_COLLAPSED);
  const over = open.filter((a) => a.over).length;

  const dismiss = (ids: readonly string[]): void => {
    setBusy(true);
    setError(undefined);
    void Promise.allSettled(ids.map((id) => dismissTokenAlert(id).then(() => id))).then(
      (results) => {
        const done = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
        const failed = results.find((r) => r.status === 'rejected');
        setGone((current) => new Set([...current, ...done]));
        if (failed !== undefined) {
          const cause: unknown = failed.reason;
          setError(cause instanceof ApiError ? cause.message : 'That alert could not be put away.');
        }
        setBusy(false);
        if (done.length > 0) {
          toast.show({
            text: done.length === 1 ? 'Alert put away.' : `${String(done.length)} alerts put away.`,
            tone: 'success',
            mark: 'alert-dismissed',
          });
          onChanged();
        }
      },
    );
  };

  const follow = (to: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onNavigate(to);
  };

  return (
    <section
      className="prof-card usage-card usage-alerts"
      data-section="alerts"
      aria-labelledby="usage-alerts-title"
    >
      <header className="prof-card-head">
        <h3 className="prof-card-title" id="usage-alerts-title">
          Budget alerts
        </h3>
        <span className="prof-card-caption" data-alert-summary>
          {open.length === 0
            ? 'yours'
            : `${String(open.length)} ${open.length === 1 ? 'alert' : 'alerts'} · ${String(over)} over budget`}
        </span>
        <InfoTip label="About budget alerts">
          <p className="usage-info">
            Yours alone: budgets crossed on work you hold or lead, and a runaway agent on a task of
            yours. Soft alerts: nothing is ever blocked, and they are in Laika only. A runaway alert
            is shown to protect your quota, never reported on you.
          </p>
        </InfoTip>
        {open.length > 1 && (
          <button
            type="button"
            className="usage-link-button prof-card-actions"
            disabled={busy}
            onClick={() => {
              dismiss(open.map((a) => a.alert.id));
            }}
          >
            Dismiss all
          </button>
        )}
      </header>

      {open.length === 0 ? (
        <p className="prof-empty">
          {alerts === undefined ? 'Reading your alerts…' : 'No budget alerts for you.'}
        </p>
      ) : (
        <ul className="usage-alerts-list" aria-label="Your budget alerts">
          {shown.map(({ alert, share, over: isOver }) => {
            const href = alertHref(alert);
            return (
              <li
                key={alert.id}
                className="usage-alert"
                data-kind={alert.kind}
                data-over={isOver ? 'true' : undefined}
              >
                <span className="usage-alert-mark">
                  {alert.kind === 'runaway' ? 'p95' : `${String(Math.round(share * 100))}%`}
                </span>
                {/* The alert's whole line on the link it names (LAI-1214) — on
                    the row it was a title= the dismiss button's tooltip sat on. */}
                <Tooltip content={alertLine(alert)}>
                  <a className="usage-alert-line" href={href} onClick={follow(href)}>
                    {alert.task !== null && (
                      <span className="usage-task-key">{alert.task.key}</span>
                    )}{' '}
                    <span className="usage-alert-title">{alertTitle(alert)}</span>
                  </a>
                </Tooltip>
                <span className="usage-alert-use">
                  <span className="usage-alert-figures">
                    {compactTokens(alert.tokens)} / {compactTokens(alert.limit_tokens)}
                    {isOver && <span className="visually-hidden"> — over budget</span>}
                  </span>
                  <span className="usage-alert-track" aria-hidden="true">
                    <span
                      className="usage-alert-bar"
                      style={{ width: `${String(Math.min(100, share * 100))}%` }}
                    />
                  </span>
                </span>
                <Tooltip content="Dismiss">
                  <button
                    type="button"
                    className="usage-alert-dismiss"
                    aria-label={`Dismiss ${alert.task?.key ?? 'alert'}`}
                    disabled={busy}
                    onClick={() => {
                      dismiss([alert.id]);
                    }}
                  >
                    <Icon name="close" size="tiny" />
                  </button>
                </Tooltip>
              </li>
            );
          })}
        </ul>
      )}

      <footer className="usage-alerts-foot">
        <span>Soft alerts · nothing is blocked</span>
        {open.length > ALERTS_COLLAPSED && (
          <button
            type="button"
            className="usage-link-button"
            aria-expanded={expanded}
            onClick={() => {
              setExpanded((e) => !e);
            }}
          >
            {expanded ? 'Show fewer' : `Show all ${String(open.length)}`}
          </button>
        )}
      </footer>
      {error !== undefined && (
        <p className="usage-form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

/** What the alert is about, in a few words: the task's title, or the sprint or month. */
function alertTitle(alert: TokenAlert): string {
  if (alert.kind === 'runaway') return `${alert.task?.title ?? 'A task'} · runaway agent`;
  if (alert.scope === 'task') return alert.task?.title ?? 'A task';
  if (alert.scope === 'sprint')
    return `${alert.sprint?.name ?? 'A sprint'} in ${alert.project.name}`;
  return `${alert.project.name} this month`;
}
