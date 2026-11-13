import type { ReactNode } from 'react';
import { DashLink } from './DashLink.tsx';
import { fewDated, type WindowCounts } from './summary-derive.ts';

/**
 * Where each figure goes (LAI-1195): the List, filtered to the work the
 * figure counts, so no card is a dead end. Built by the screen, which knows
 * the space and the range.
 */
export interface StatLinks {
  readonly done: string;
  readonly touched: string;
  readonly created: string;
  readonly due: string;
  readonly overdue: string;
}

/**
 * The four figures across the top (LAI-711) — Jira's Summary row: what got
 * done, what was touched, what is new, and what is coming due.
 *
 * **"Touched", not "updated"** (LAI-817, D-092 item 5): the figure counts tasks
 * whose `updated_at` falls in the range, and a sprint move, a reorder, a branch
 * match or a PR link moves it as surely as work does. And **due soon says when
 * it speaks for few tasks**: on OnRoute 2 of 301 open tasks had a date, so a
 * "1 due soon" read as a schedule when it was a sample.
 *
 * Done is the server's (`/metrics`), the rest are counted from the task list;
 * `undefined` done means metrics have not answered, and the card says so with
 * a dash rather than a zero it does not know.
 */
export function StatCards({
  done,
  counts,
  window,
  links,
}: {
  readonly done: number | undefined;
  readonly counts: WindowCounts;
  /** "in the last 7 days", "all time" — what the first three cards cover. */
  readonly window: string;
  readonly links: StatLinks;
}) {
  return (
    <div className="dash-stats" role="list" aria-label="Summary">
      <Stat
        kind="done"
        figure={done}
        noun="done"
        sub={window}
        href={links.done}
        action="Open finished work in the List"
      />
      <Stat
        kind="touched"
        figure={counts.touched}
        noun="touched"
        sub={window}
        href={links.touched}
        action="Open recently changed work in the List"
        title="Tasks changed in any way — an edit, a move, a sprint change, a reorder, a linked branch or PR"
      />
      <Stat
        kind="created"
        figure={counts.created}
        noun="created"
        sub={window}
        href={links.created}
        action="Open the newest work in the List"
      />
      <Stat
        kind="due"
        figure={counts.dueSoon}
        noun="due soon"
        sub="in the next 7 days"
        href={links.due}
        action="Open work by due date in the List"
        extra={
          counts.overdue > 0 ? (
            <DashLink
              href={links.overdue}
              className="dash-stat-overdue"
              title="Open overdue work in the List"
            >
              {counts.overdue} overdue
            </DashLink>
          ) : undefined
        }
        note={
          fewDated(counts)
            ? `only ${String(counts.dated)} of ${String(counts.open)} open ${
                counts.open === 1 ? 'task has' : 'tasks have'
              } a due date`
            : undefined
        }
      />
    </div>
  );
}

type StatKind = 'done' | 'touched' | 'created' | 'due';

function Stat({
  kind,
  figure,
  noun,
  sub,
  extra,
  note,
  title,
  href,
  action,
}: {
  readonly kind: StatKind;
  readonly figure: number | undefined;
  readonly noun: string;
  readonly sub: string;
  readonly extra?: ReactNode;
  /** A caveat on its own line — what the figure does not cover. */
  readonly note?: string | undefined;
  /** What the figure counts, on hover. */
  readonly title?: string | undefined;
  /** The filtered view the figure summarises; the whole card is its target. */
  readonly href: string;
  /** What following the link does, for a screen reader and on hover. */
  readonly action: string;
}) {
  return (
    <section className={`dash-card dash-stat dash-stat-${kind}`} role="listitem">
      <span className="dash-stat-icon" aria-hidden="true">
        <StatIcon kind={kind} />
      </span>
      <div className="dash-stat-text">
        <p className="dash-stat-figure">
          {/* One link per card, stretched over it in CSS: the figure is the
              link's name, so a screen reader hears "8 done, link", and its
              title says where it goes. */}
          <DashLink
            href={href}
            className="dash-stat-link"
            title={`${action}${title === undefined ? '' : ` — ${title}`}`}
          >
            <span className="dash-stat-n" data-stat={kind}>
              {figure ?? '—'}
            </span>{' '}
            {noun}
          </DashLink>
        </p>
        <p className="dash-stat-sub">
          {sub}
          {extra !== undefined && <> · {extra}</>}
        </p>
        {note !== undefined && <p className="dash-stat-note">{note}</p>}
      </div>
    </section>
  );
}

/** Line icons in `currentColor`; the card's class picks the token. */
function StatIcon({ kind }: { readonly kind: StatKind }) {
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
    case 'touched':
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
