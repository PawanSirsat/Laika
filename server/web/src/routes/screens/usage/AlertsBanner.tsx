import { useState, type MouseEvent } from 'react';
import { ApiError } from '../../../api/errors.ts';
import {
  alertHref,
  alertLine,
  dismissTokenAlert,
  type TokenAlert,
} from '../../../api/token-alerts.ts';

/**
 * *For you* (LAI-773): the signed-in person's own open token alerts on the
 * Usage page — budgets crossed on work they hold or lead, and a runaway
 * agent on a task of theirs — each with a way to it and a way to put it away.
 * The list is the shell's, so this banner and the rail's badge are one answer.
 *
 * In-app only: nothing here is emailed or sent anywhere. Soft: an alert
 * refuses nothing, and putting one away changes only this person's view.
 */
export function AlertsBanner({
  alerts,
  onNavigate,
  onChanged,
}: {
  readonly alerts: readonly TokenAlert[] | undefined;
  readonly onNavigate: (to: string) => void;
  readonly onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());

  const shown = (alerts ?? []).filter((a) => !gone.has(a.id));
  if (shown.length === 0) return null;

  const dismiss = (id: string): void => {
    setBusy(id);
    setError(undefined);
    dismissTokenAlert(id)
      .then(() => {
        setGone((current) => new Set([...current, id]));
        onChanged();
      })
      .catch((cause: unknown) => {
        setError(cause instanceof ApiError ? cause.message : 'That alert could not be put away.');
      })
      .finally(() => {
        setBusy(undefined);
      });
  };

  const follow = (to: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onNavigate(to);
  };

  return (
    <section className="usage-alerts" aria-labelledby="usage-alerts-title" data-section="alerts">
      <h3 className="usage-alerts-title" id="usage-alerts-title">
        For you · {String(shown.length)} {shown.length === 1 ? 'alert' : 'alerts'}
      </h3>
      <ul className="usage-alerts-list">
        {shown.map((alert) => (
          <li key={alert.id} className="usage-alert" data-kind={alert.kind}>
            <span className="usage-alert-mark" aria-hidden="true">
              {alert.kind === 'runaway' ? 'p95' : `${String(alert.threshold)}%`}
            </span>
            <a
              className="usage-alert-line"
              href={alertHref(alert)}
              onClick={follow(alertHref(alert))}
            >
              {alertLine(alert)}
            </a>
            <button
              type="button"
              className="usage-chip usage-alert-dismiss"
              disabled={busy === alert.id}
              onClick={() => {
                dismiss(alert.id);
              }}
            >
              Dismiss
            </button>
          </li>
        ))}
      </ul>
      <p className="usage-alerts-note">
        Soft alerts: nothing is ever blocked, and they are in Laika only. A runaway alert is yours
        alone — shown to protect your quota, never reported on you.
      </p>
      {error !== undefined && (
        <p className="usage-form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
