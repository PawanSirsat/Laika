import { useCallback, useEffect, useState } from 'react';
import { request } from './client.ts';
import { compactTokens } from './usage.ts';

/**
 * A person's own token alerts (LAI-773, SPEC §6.4): budgets crossed on work
 * they hold or lead, and the runaway-agent alert, addressed to them alone.
 * Mirrors `services/token-budgets.ts`' `TokenAlertView`.
 *
 * **In-app only.** No email, no outbound call: the sidebar's badge on Usage,
 * the banner on the Usage page, and the task's own Tokens section. A web
 * session's: the server refuses every token (`token_alerts.own`), so an agent
 * neither reads nor puts away its person's alerts.
 */

export type TokenAlertKind = 'budget' | 'runaway';

export interface TokenAlert {
  readonly id: string;
  readonly kind: TokenAlertKind;
  readonly scope: 'task' | 'sprint' | 'project';
  /** 80 or 100 (% of a budget), or 95 (the forecast's p95, a runaway). */
  readonly threshold: number;
  readonly tokens: number;
  readonly limit_tokens: number;
  readonly created_at: number;
  readonly project: { readonly slug: string; readonly name: string };
  readonly task: { readonly id: string; readonly key: string; readonly title: string } | null;
  readonly sprint: { readonly id: string; readonly name: string } | null;
}

export function getTokenAlerts(
  signal?: AbortSignal,
): Promise<{ readonly alerts: readonly TokenAlert[] }> {
  return request<{ readonly alerts: readonly TokenAlert[] }>(
    '/me/token-alerts',
    signal === undefined ? {} : { signal },
  );
}

/** Put one away — for the caller only; nobody else's view changes. */
export function dismissTokenAlert(id: string): Promise<void> {
  return request<void>(`/me/token-alerts/${encodeURIComponent(id)}/dismiss`, { method: 'POST' });
}

/** What the alert is about, as a link target on the board. */
export function alertHref(alert: TokenAlert): string {
  const project = encodeURIComponent(alert.project.slug);
  return alert.task === null
    ? `/usage`
    : `/board?project=${project}&task=${encodeURIComponent(alert.task.id)}`;
}

/** One alert in words. A runaway is said as protecting the person's quota. */
export function alertLine(alert: TokenAlert): string {
  const spent = `${compactTokens(alert.tokens)} of ${compactTokens(alert.limit_tokens)}`;
  if (alert.kind === 'runaway') {
    return `${alert.task?.key ?? 'A task'}: your agent passed the task’s p95 of ${compactTokens(
      alert.limit_tokens,
    )} at ${compactTokens(alert.tokens)} with nothing landed for an hour.`;
  }
  const what =
    alert.scope === 'task'
      ? (alert.task?.key ?? 'A task')
      : alert.scope === 'sprint'
        ? `${alert.sprint?.name ?? 'A sprint'} in ${alert.project.name}`
        : `${alert.project.name} this month`;
  return `${what} reached ${String(alert.threshold)}% of its budget — ${spent}.`;
}

/** A minute is fresh enough for a badge; the Usage page re-reads on open. */
const REFRESH_MS = 60_000;

export interface TokenAlerts {
  /** The open alerts, or `undefined` — not asked yet, or the read failed. */
  readonly alerts: readonly TokenAlert[] | undefined;
  /** Read again now — after a dismiss changed the answer. */
  readonly refresh: () => void;
}

/**
 * The signed-in person's alerts, for the shell: **called once**, as the review
 * count is, so the sidebar's badge and the Usage page's banner are one list
 * from one request. Every signed-in person may read their own; a failed read
 * keeps the last answer, since an empty list would claim there is none.
 */
export function useTokenAlerts(enabled: boolean): TokenAlerts {
  const [alerts, setAlerts] = useState<readonly TokenAlert[] | undefined>(undefined);
  const [asked, setAsked] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setAlerts(undefined);
      return;
    }
    const controller = new AbortController();
    const read = (): void => {
      getTokenAlerts(controller.signal)
        .then((answer) => {
          if (!controller.signal.aborted) setAlerts(answer.alerts);
        })
        .catch(() => undefined);
    };
    read();
    const timer = setInterval(read, REFRESH_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [enabled, asked]);

  const refresh = useCallback(() => {
    setAsked((n) => n + 1);
  }, []);

  return { alerts, refresh };
}
