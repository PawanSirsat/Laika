import { useEffect, useState, type MouseEvent } from 'react';
import { everyPage } from '../../../api/every-page.ts';
import type { MeProfile } from '../../../api/me.ts';
import { isProject, listProjects } from '../../../api/projects.ts';
import type { ReviewQueueItem } from '../../../api/review.ts';
import { getTask, listTasks, type TaskStatus } from '../../../api/tasks.ts';
import { LoadingState } from '../../../components/LoadingState.tsx';
import {
  blockerIds,
  plateOf,
  type Blocker,
  type MineTask,
  type PlateItem,
} from './plate-derive.ts';

export interface OnYourPlateProps {
  readonly me: MeProfile | undefined;
  /** The review queue the shell already holds for the sidebar's badge. */
  readonly queue: readonly ReviewQueueItem[] | undefined;
  readonly onNavigate: (to: string) => void;
}

type Load =
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'ready';
      readonly mine: readonly MineTask[];
      readonly blockers: ReadonlyMap<string, Blocker>;
    }
  | { readonly kind: 'error' };

/** The kinds of work that can be on someone's plate: started, or next. */
const OPEN: readonly TaskStatus[] = ['in_progress', 'todo'];
/** Blockers looked up one by one — enough for a person's own open work. */
const BLOCKER_LIMIT = 20;

/**
 * The reader's own open tasks, in the spaces they belong to: one slim,
 * filtered read per space and kind (`assignee`, `status`), never the
 * space's whole list — and each outside blocker once, by id.
 */
function usePlate(me: MeProfile | undefined): Load {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  useEffect(() => {
    if (me === undefined) return;
    const controller = new AbortController();
    const { signal } = controller;
    const member = new Set(me.memberships.map((m) => m.project_id));

    void (async () => {
      const { items } = await everyPage((cursor) =>
        listProjects(cursor === undefined ? { limit: 200 } : { limit: 200, cursor }, signal),
      );
      const spaces = items
        .filter(isProject)
        .filter((p) => p.archived_at === null && member.has(p.id));
      const pages = await Promise.all(
        spaces.flatMap((space) =>
          OPEN.map((status) =>
            listTasks(space.slug, { assignee: me.id, status, limit: 100 }, signal).then((page) =>
              page.data.map((task) => ({ task, slug: space.slug })),
            ),
          ),
        ),
      );
      const mine = pages.flat();
      const blockers = new Map<string, Blocker>();
      await Promise.all(
        blockerIds(mine)
          .slice(0, BLOCKER_LIMIT)
          .map((id) =>
            getTask(id, signal)
              .then((task) => {
                blockers.set(id, { key: task.key, status: task.status });
              })
              // One the reader may not read still blocks; it goes unnamed.
              .catch(() => undefined),
          ),
      );
      if (!signal.aborted) setLoad({ kind: 'ready', mine, blockers });
    })().catch(() => {
      if (!signal.aborted) setLoad({ kind: 'error' });
    });

    return () => {
      controller.abort();
    };
  }, [me]);
  return load;
}

/**
 * *On your plate* (LAI-796, the owner's reference): beside the day, the work
 * that is the reader's right now — in progress, waiting on their review, and
 * blocked — each opening in its own space. Everything here is something the
 * board already shows; this gathers the reader's own.
 */
export function OnYourPlate({ me, queue, onNavigate }: OnYourPlateProps) {
  const load = usePlate(me);

  const follow = (to: string) => (event: MouseEvent) => {
    // Modified clicks stay the browser's — new tab, new window.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onNavigate(to);
  };

  const plate = load.kind === 'ready' ? plateOf(load.mine, load.blockers, queue) : undefined;

  const group = (
    id: string,
    title: string,
    tone: 'progress' | 'review' | 'blocked',
    items: readonly PlateItem[] | undefined,
    empty: string,
    more?: { readonly href: string; readonly label: string },
  ) => (
    <div className="plate-group" data-plate={id}>
      <h3 className="plate-head">
        <span className={`plate-dot plate-dot-${tone}`} aria-hidden="true" />
        {title}
        {items !== undefined && <span className="plate-count">{items.length}</span>}
        {more !== undefined && (
          <a className="plate-more" href={more.href} onClick={follow(more.href)}>
            {more.label} →
          </a>
        )}
      </h3>
      {items === undefined ? (
        <p className="myday-quiet">Reading…</p>
      ) : items.length === 0 ? (
        <p className="myday-quiet">{empty}</p>
      ) : (
        <ul className="plate-list">
          {items.map((item) => {
            const href =
              item.slug === undefined
                ? `/board?q=${encodeURIComponent(item.key)}`
                : `/board?project=${encodeURIComponent(item.slug)}&task=${encodeURIComponent(item.id)}`;
            return (
              <li key={item.id}>
                <a className="plate-item" href={href} onClick={follow(href)}>
                  <span className="plate-key">{item.key}</span>
                  <span className="plate-title">{item.title}</span>
                </a>
                {item.note !== undefined && (
                  <span className={`plate-note plate-note-${item.tone ?? 'wait'}`}>
                    {item.note}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  return (
    <section className="myday-card myday-plate" aria-labelledby="myday-plate-title">
      <header className="myday-card-head">
        <h2 className="myday-card-title" id="myday-plate-title">
          On your plate
        </h2>
      </header>
      {load.kind === 'loading' && <LoadingState shape="row" count={3} label="Reading your work" />}
      {load.kind === 'error' && (
        <p className="myday-quiet" role="status">
          Your tasks could not be read just now. The board has them.
        </p>
      )}
      {plate !== undefined && (
        <div className="plate-groups">
          {group('progress', 'In progress', 'progress', plate.inProgress, 'Nothing in progress.')}
          {group(
            'review',
            'Waiting on your review',
            'review',
            plate.review,
            'Nothing waiting for you to decide.',
            { href: '/inbox?tab=review', label: 'Inbox' },
          )}
          {group('blocked', 'Blocked', 'blocked', plate.blocked, 'Nothing of yours is blocked.')}
        </div>
      )}
    </section>
  );
}
