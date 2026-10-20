import { statusTransition, type ActivityEvent } from '../../../api/activity.ts';

/**
 * **Who contributed in the range** (LAI-817, D-092 item 1).
 *
 * The owner, on OnRoute: Work by person said *Ashutosh 24, Pawan 6* while
 * Pawan had done most of the work. That card counted **open tasks touched in
 * the range, by current assignee** — a person's backlog and the work waiting
 * on their reviewer, not what they did. D-092 says what contribution is, and
 * this is that rule, counted from the `task.status_changed` rows the dashboard
 * already loads for its range. No new endpoint: the activity window is the
 * range's, and its `truncated` flag already says when it is a floor.
 *
 * ## The rule
 *
 * - **Delivered** — distinct tasks a person moved **into review**, or **into
 *   done without review**. A task moved twice counts once.
 * - **Reviewed** — distinct tasks they moved **out of review**, to done or sent
 *   back, on work **someone else** delivered. Closing your own delivery is not
 *   a review.
 * - **Self-closed** — of delivered, the tasks moved to done without passing
 *   through review. Counted, and footnoted (D-092).
 *
 * ## An agent's move is its owner's
 *
 * The server writes an agent's row with `actor_kind: 'agent'` and `actor_id`
 * set to **the token's owner** (`activityActor` in `resolve-actor.ts`, SPEC
 * §4.8), so crediting `actor_id` whatever the kind credits the owner. Only
 * `system` rows — the cron, a webhook — have no person and count for nobody.
 *
 * ## Who delivered what a reviewer closed
 *
 * The last move into review **seen in the range**. When the delivery happened
 * before the range began there is none to see; the task's assignee stands in,
 * because a person closing work assigned to them is closing their own. Work
 * with no assignee and no delivery in sight counts as reviewed — it was
 * demonstrably not the closer's.
 */

export interface Contribution {
  /** The person — for an agent's move, its token's owner. */
  readonly id: string;
  /** Distinct tasks moved into review, or into done without review. */
  readonly delivered: number;
  /** Distinct tasks moved out of review on work someone else delivered. */
  readonly reviewed: number;
  /** Of {@link delivered}, the tasks moved to done without review. */
  readonly selfClosed: number;
}

export interface Contributors {
  /** Most delivered first; reviewed, then name, break a tie. */
  readonly rows: readonly Contribution[];
  /** Every self-close in {@link rows}, for the card's footnote. */
  readonly selfClosed: number;
}

export interface ContributorOptions {
  /** Count only these tasks — the card's sprint, priority and label filter. */
  readonly include?: ((taskId: string) => boolean) | undefined;
  /** Who holds a task now — the stand-in for a delivery before the range. */
  readonly assigneeOf?: ((taskId: string) => string | null | undefined) | undefined;
}

/** A move out of review that a reviewer makes: accepted, or sent back. */
const REVIEW_OUTCOMES: ReadonlySet<string> = new Set(['done', 'backlog', 'todo', 'in_progress']);

interface Tally {
  delivered: Set<string>;
  reviewed: Set<string>;
  selfClosed: Set<string>;
}

export function contributors(
  events: readonly ActivityEvent[],
  nameOf: (id: string) => string = (id) => id,
  options: ContributorOptions = {},
): Contributors {
  const byPerson = new Map<string, Tally>();
  const tally = (id: string): Tally => {
    let t = byPerson.get(id);
    if (t === undefined) {
      t = { delivered: new Set(), reviewed: new Set(), selfClosed: new Set() };
      byPerson.set(id, t);
    }
    return t;
  };
  /** The last person seen moving each task into review. */
  const deliveredBy = new Map<string, string>();

  // Oldest first, so "who delivered it" is known before its review is read.
  // The feed arrives newest first; `seq` is the server's own order.
  const moves = events
    .filter((e) => e.type === 'task.status_changed')
    .slice()
    .sort((a, b) => a.seq - b.seq);

  for (const event of moves) {
    const task = event.task_id;
    const actor = event.actor_id;
    if (task === null || actor === null || event.actor_kind === 'system') continue;
    if (options.include !== undefined && !options.include(task)) continue;
    const move = statusTransition(event);
    if (move === undefined) continue;
    const { from, to } = move;

    if (to === 'review' && from !== 'review') {
      tally(actor).delivered.add(task);
      deliveredBy.set(task, actor);
    } else if (to === 'done' && from !== 'review' && from !== 'done') {
      const t = tally(actor);
      t.delivered.add(task);
      t.selfClosed.add(task);
    } else if (from === 'review' && REVIEW_OUTCOMES.has(to)) {
      const deliverer = deliveredBy.get(task) ?? options.assigneeOf?.(task) ?? null;
      if (deliverer !== actor) tally(actor).reviewed.add(task);
    }
  }

  const rows = [...byPerson]
    .map(([id, t]) => ({
      id,
      delivered: t.delivered.size,
      reviewed: t.reviewed.size,
      selfClosed: t.selfClosed.size,
    }))
    .filter((row) => row.delivered > 0 || row.reviewed > 0)
    .sort(
      (a, b) =>
        b.delivered - a.delivered ||
        b.reviewed - a.reviewed ||
        nameOf(a.id).localeCompare(nameOf(b.id)),
    );
  return { rows, selfClosed: rows.reduce((sum, row) => sum + row.selfClosed, 0) };
}
