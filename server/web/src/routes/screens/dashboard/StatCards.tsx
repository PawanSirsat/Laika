import type { ReactNode } from 'react';
import type { WindowCounts } from './summary-derive.ts';

/**
 * The four figures across the top (LAI-711) — Jira's Summary row: what got
 * done, what moved, what is new, and what is coming due.
 *
 * Done is the server's (`/metrics`), the rest are counted from the task list;
 * `undefined` done means metrics have not answered, and the card says so with
 * a dash rather than a zero it does not know.
 */
export function StatCards({
  done,
  counts,
  window,
}: {
  readonly done: number | undefined;
  readonly counts: WindowCounts;
  /** "in the last 7 days", "all time" — what the first three cards cover. */
  readonly window: string;
}) {
  return (
    <div className="dash-stats" role="list" aria-label="Summary">
      <Stat kind="done" figure={done} noun="done" sub={window} />
      <Stat kind="updated" figure={counts.updated} noun="updated" sub={window} />
      <Stat kind="created" figure={counts.created} noun="created" sub={window} />
      <Stat
        kind="due"
        figure={counts.dueSoon}
        noun="due soon"
        sub="in the next 7 days"
        extra={
          counts.overdue > 0 ? (
            <span className="dash-stat-overdue">{counts.overdue} overdue</span>
          ) : undefined
        }
      />
    </div>
  );
}

function Stat({
  kind,
  figure,
  noun,
  sub,
  extra,
}: {
  readonly kind: 'done' | 'updated' | 'created' | 'due';
  readonly figure: number | undefined;
  readonly noun: string;
  readonly sub: string;
  readonly extra?: ReactNode;
}) {
  return (
    <section className={`dash-card dash-stat dash-stat-${kind}`} role="listitem">
      <span className="dash-stat-icon" aria-hidden="true">
        <StatIcon kind={kind} />
      </span>
      <div className="dash-stat-text">
        <p className="dash-stat-figure">
          <span className="dash-stat-n" data-stat={kind}>
            {figure ?? '—'}
          </span>{' '}
          {noun}
        </p>
        <p className="dash-stat-sub">
          {sub}
          {extra !== undefined && <> · {extra}</>}
        </p>
      </div>
    </section>
  );
}

/** Line icons in `currentColor`; the card's class picks the token. */
function StatIcon({ kind }: { readonly kind: 'done' | 'updated' | 'created' | 'due' }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (kind) {
    case 'done':
      return (
        <svg {...common}>
          <path d="M20 6 9 17l-5-5" />
        </svg>
      );
    case 'updated':
      return (
        <svg {...common}>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
      );
    case 'created':
      return (
        <svg {...common}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case 'due':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
  }
}
