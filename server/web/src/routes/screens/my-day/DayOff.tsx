import { useEffect, useState, type MouseEvent } from 'react';
import { dateLabelShort } from '../../../api/date-only.ts';
import { everyPage } from '../../../api/every-page.ts';
import type { MeProfile } from '../../../api/me.ts';
import { getOrg } from '../../../api/org.ts';
import type { Project } from '../../../api/projects.ts';
import { listAllTasks, type TaskSummary } from '../../../api/tasks.ts';
import { LoadingState } from '../../../components/LoadingState.tsx';
import {
  OFF_PLATE_CAP,
  OFF_PLATE_STATUSES,
  offPlate,
  type OffPlateRow,
} from './off-plate-derive.ts';
import { plainClick, taskHref } from './task-link.ts';
import './day-states.css';

export interface DayOffProps {
  readonly me: MeProfile | undefined;
  /** The spaces the reader can read: `undefined` while reading, `null` if that failed. */
  readonly spaces: readonly Project[] | null | undefined;
  /**
   * The reader holds `org.time.set` (`GET /permissions`, LAI-970 — never the
   * role): only then does the note offer the way to the setting.
   */
  readonly canTurnOn: boolean;
  /** The page's clock, so *overdue* agrees with the rest of My day. */
  readonly now: number;
  readonly onNavigate: (to: string) => void;
}

type OffLoad =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly tasks: readonly TaskSummary[]; readonly truncated: boolean }
  | { readonly kind: 'error' };

/**
 * The reader's open work across every space they may read: one
 * `GET /tasks?assignee=<me>&status=<kind>` a kind, each to its last page.
 * `GET /tasks` takes no due-date filter, so the order is the client's
 * ({@link offPlate}).
 */
function useOpenWork(me: MeProfile | undefined, tick: number): OffLoad {
  const [load, setLoad] = useState<OffLoad>({ kind: 'loading' });
  useEffect(() => {
    if (me === undefined) return;
    const controller = new AbortController();
    const { signal } = controller;
    setLoad({ kind: 'loading' });
    Promise.all(
      OFF_PLATE_STATUSES.map((status) =>
        everyPage((cursor) =>
          listAllTasks(
            { assignee: me.id, status, limit: 100, ...(cursor === undefined ? {} : { cursor }) },
            signal,
          ),
        ),
      ),
    )
      .then((pages) => {
        if (signal.aborted) return;
        setLoad({
          kind: 'ready',
          tasks: pages.flatMap((p) => p.items),
          truncated: pages.some((p) => p.truncated),
        });
      })
      .catch(() => {
        if (!signal.aborted) setLoad({ kind: 'error' });
      });
    return () => {
      controller.abort();
    };
  }, [me, tick]);
  return load;
}

/** What a row says beside its title: the date that makes it urgent, or its status. */
function rowNote(row: OffPlateRow): {
  readonly text: string;
  readonly tone: 'bad' | 'wait' | 'quiet';
} {
  const { task, kind } = row;
  if (kind === 'overdue' && task.due_on !== null) {
    return { text: `Overdue · ${dateLabelShort(task.due_on)}`, tone: 'bad' };
  }
  if (kind === 'soon' && task.due_on !== null) {
    return { text: `Due ${dateLabelShort(task.due_on)}`, tone: 'wait' };
  }
  return { text: task.status_name, tone: 'quiet' };
}

/**
 * Time tracking is off for the organisation (`settings.org_mode === 'off'`):
 * nothing is collected or drafted, so there is no day to draw. Rather than a
 * card that only leads to a setting (the audit's V2, LAI-1130), My day shows
 * the reader's own open work — overdue, due soon, in progress, the rest —
 * each opening in its own space, under a one-line note that tracking is off.
 * The note links to the setting only for a reader who may change it.
 */
export function DayOff({ me, spaces, canTurnOn, now, onNavigate }: DayOffProps) {
  const [org, setOrg] = useState<string | undefined>(undefined);
  const [tick, setTick] = useState(0);
  const load = useOpenWork(me, tick);
  useEffect(() => {
    const controller = new AbortController();
    getOrg(controller.signal)
      .then((o) => {
        if (!controller.signal.aborted) setOrg(o.name);
      })
      .catch(() => undefined);
    return () => {
      controller.abort();
    };
  }, []);

  const follow = (to: string) => (event: MouseEvent) => {
    // Modified clicks stay the browser's — new tab, new window.
    if (!plainClick(event)) return;
    event.preventDefault();
    onNavigate(to);
  };

  const slugOf = new Map((spaces ?? []).map((p) => [p.id, p.slug]));
  const rows = load.kind === 'ready' ? offPlate(load.tasks, now) : [];
  const shown = rows.slice(0, OFF_PLATE_CAP);
  const hidden = rows.length - shown.length;
  const allHref = me === undefined ? '/work' : `/work?person=${encodeURIComponent(me.id)}`;

  return (
    <>
      <p className="myday-viewing-banner dstate-off-note" role="note" data-day-off>
        <span className="dstate-off-icon" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 18 18">
            <circle cx="9" cy="9" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="M9 5.5V9l2.5 1.5M3 15L15 3"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </span>
        <span>
          <strong>Time tracking is off for {org ?? 'your organisation'}.</strong> Nothing is
          collected or drafted, so here is your open work instead.
        </span>
        {canTurnOn && (
          <a
            className="myday-linkish dstate-off-link"
            href="/organisation"
            onClick={follow('/organisation')}
            data-day-off-settings
          >
            Organisation settings
          </a>
        )}
      </p>
      <section
        className="myday-card myday-plate dstate-off-plate"
        aria-labelledby="myday-off-plate-title"
        data-off-plate
      >
        <header className="myday-card-head">
          <h2 className="myday-card-title" id="myday-off-plate-title">
            On your plate
          </h2>
          {load.kind === 'ready' && (
            <span className="myday-card-figure" data-off-plate-count>
              {rows.length}
              {load.truncated ? '+' : ''} open
            </span>
          )}
          <span className="myday-card-head-gap" />
          <a className="plate-more" href={allHref} onClick={follow(allHref)}>
            All your work →
          </a>
        </header>
        {load.kind === 'loading' && (
          <LoadingState shape="row" count={4} label="Reading your work" />
        )}
        {load.kind === 'error' && (
          <p className="myday-quiet" role="status">
            Your tasks could not be read just now.{' '}
            <button
              type="button"
              className="myday-linkish"
              onClick={() => {
                setTick((n) => n + 1);
              }}
            >
              Retry
            </button>
          </p>
        )}
        {load.kind === 'ready' && rows.length === 0 && (
          <p className="myday-quiet">Nothing is assigned to you that is still open.</p>
        )}
        {shown.length > 0 && (
          <ul className="plate-list" data-off-plate-list>
            {shown.map((row) => {
              const href = taskHref(row.task, slugOf.get(row.task.project_id));
              const note = rowNote(row);
              return (
                <li key={row.task.id} data-off-plate-row={row.kind}>
                  <a className="plate-item" href={href} onClick={follow(href)}>
                    <span className="plate-key">{row.task.key}</span>
                    <span className="plate-title">{row.task.title}</span>
                  </a>
                  <span
                    className={
                      note.tone === 'quiet'
                        ? 'plate-note dstate-off-status'
                        : `plate-note plate-note-${note.tone}`
                    }
                  >
                    {note.text}
                  </span>
                </li>
              );
            })}
            {hidden > 0 && (
              <li className="plate-rests">
                <a className="plate-rest" href={allHref} onClick={follow(allHref)} data-plate-more>
                  +{hidden} more
                </a>
              </li>
            )}
          </ul>
        )}
      </section>
    </>
  );
}
