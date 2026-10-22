import { useEffect, useState, type MouseEvent } from 'react';
import { everyPage } from '../../../api/every-page.ts';
import type { MeProfile } from '../../../api/me.ts';
import type { Project } from '../../../api/projects.ts';
import type { ReviewQueueItem } from '../../../api/review.ts';
import { canConfigureProject, getTask, listTasks, type TaskStatus } from '../../../api/tasks.ts';
import { implicitlyLeads, usePermissions } from '../../../api/permissions.ts';
import { LoadingState } from '../../../components/LoadingState.tsx';
import {
  blockerIds,
  capped,
  moreLinks,
  plateOf,
  type Blocker,
  type MineTask,
  type PlateGroup,
  type PlateItem,
} from './plate-derive.ts';
import { plainClick, taskHref } from './task-link.ts';

export interface OnYourPlateProps {
  readonly me: MeProfile | undefined;
  /**
   * The spaces the reader can read, read once by the page: `undefined` while
   * reading, `null` if the read failed.
   */
  readonly spaces: readonly Project[] | null | undefined;
  /** The reader's own open work, read once by the page ({@link usePlate}). */
  readonly load: PlateLoad;
  /** The review queue the shell already holds for the sidebar's badge. */
  readonly queue: readonly ReviewQueueItem[] | undefined;
  /** The server cut the queue at its limit (LAI-820): the count is a floor. */
  readonly reviewCapped?: boolean | undefined;
  readonly onNavigate: (to: string) => void;
}

export type PlateLoad =
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
 * space's whole list — and each outside blocker once, by id. Read once by
 * the page (LAI-831): *On your plate* lists it, and the inspector offers the
 * cards in progress as chips.
 */
export function usePlate(
  me: MeProfile | undefined,
  readable: readonly Project[] | null | undefined,
): PlateLoad {
  const { permissions } = usePermissions(me !== undefined);
  const [load, setLoad] = useState<PlateLoad>({ kind: 'loading' });
  useEffect(() => {
    if (me === undefined || readable === undefined) return;
    if (readable === null) {
      setLoad({ kind: 'error' });
      return;
    }
    const controller = new AbortController();
    const { signal } = controller;
    const member = new Set(me.memberships.map((m) => m.project_id));

    void (async () => {
      const spaces = readable.filter(
        (p) =>
          p.archived_at === null &&
          (member.has(p.id) ||
            (implicitlyLeads(permissions, p.id) ??
              canConfigureProject(me.org_role, p.id, me.memberships))),
      );
      const pages = await Promise.all(
        spaces.flatMap((space) =>
          OPEN.map((status) =>
            everyPage((cursor) =>
              listTasks(
                space.slug,
                {
                  assignee: me.id,
                  status,
                  limit: 100,
                  ...(cursor === undefined ? {} : { cursor }),
                },
                signal,
              ),
            ).then(({ items: tasks }) => tasks.map((task) => ({ task, slug: space.slug }))),
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
  }, [me, permissions, readable]);
  return load;
}

/**
 * *On your plate* (LAI-796, the owner's reference): beside the day, the work
 * that is the reader's right now — in progress, waiting on their review, and
 * blocked — each opening in its own space. Everything here is something the
 * board already shows; this gathers the reader's own.
 */
export function OnYourPlate({
  me,
  spaces,
  load,
  queue,
  reviewCapped = false,
  onNavigate,
}: OnYourPlateProps) {
  const names = new Map((spaces ?? []).map((p) => [p.slug, p.name]));

  const follow = (to: string) => (event: MouseEvent) => {
    // Modified clicks stay the browser's — new tab, new window.
    if (!plainClick(event)) return;
    event.preventDefault();
    onNavigate(to);
  };

  const plate = load.kind === 'ready' ? plateOf(load.mine, load.blockers, queue) : undefined;

  const group = (
    id: PlateGroup,
    title: string,
    items: readonly PlateItem[] | undefined,
    empty: string,
    more?: { readonly href: string; readonly label: string },
    floor = false,
  ) => {
    const { shown, more: hidden } = capped(items ?? []);
    const rest = moreLinks(id, (items ?? []).slice(shown.length), me?.id, names);
    return (
      <div className="plate-group" data-plate={id}>
        <h3 className="plate-head">
          <span className={`plate-dot plate-dot-${id}`} aria-hidden="true" />
          {title}
          {items !== undefined && (
            <span className="plate-count">
              {items.length}
              {floor ? '+' : ''}
            </span>
          )}
          {/* Once *+N more* leads to the same place, the header need not. */}
          {more !== undefined && hidden === 0 && (
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
            {shown.map((item) => {
              const href = taskHref(item, item.slug);
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
            {rest.length > 0 && (
              <li className="plate-rests">
                {rest.map((link) => (
                  <a
                    key={link.href}
                    className="plate-rest"
                    href={link.href}
                    onClick={follow(link.href)}
                    data-plate-more
                  >
                    {link.label}
                  </a>
                ))}
              </li>
            )}
          </ul>
        )}
      </div>
    );
  };

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
          {group('progress', 'In progress', plate.inProgress, 'Nothing in progress.', {
            href: '/board',
            label: 'Board',
          })}
          {group(
            'review',
            'Waiting on your review',
            plate.review,
            'Nothing waiting for you to decide.',
            { href: '/inbox?tab=review', label: 'Inbox' },
            reviewCapped,
          )}
          {group('blocked', 'Blocked', plate.blocked, 'Nothing of yours is blocked.')}
        </div>
      )}
    </section>
  );
}
