/**
 * "What this delivers" — the pure rules for a task's `deliverables`, `solves`
 * and `unlocks` (§4.5, LAI-1115). Every writer — `createTask`, `updateTask`,
 * `finishTask`, `registerCheckpoint` — shapes its input here, so a service
 * reached without zod refuses what the column does not allow, and the route
 * and the tool keep only literal sanity bounds (`shadowed-bounds.test.ts`).
 *
 * The stored shape is `TaskDeliverable` with its keys in one fixed order:
 * `taskVersion` hashes the view, so the same list must serialise to the same
 * bytes whoever wrote it.
 */

import { newId } from '../db/ids.ts';
import { DELIVERABLE_STATES, type DeliverableState } from '../db/enums.ts';
import type { TaskDeliverable } from '../db/schema.ts';
import { ApiError } from '../errors.ts';

export const DELIVERABLE_LIMITS = {
  /** Ships items on one task. */
  items: 20,
  title: 200,
  detail: 2000,
  /** Lines of `solves` or `unlocks`. */
  points: 20,
  /** One such line. */
  point: 300,
} as const;

/** One Ships item as a caller sends it; `id` keeps an existing item. */
export interface DeliverableInput {
  id?: string | undefined;
  title: string;
  detail?: string | null | undefined;
  /** Absent: the kept item's state, else `pending`. */
  state?: DeliverableState | undefined;
}

function refuse(field: string, message: string, details: Record<string, unknown>): ApiError {
  return new ApiError('unprocessable', message, { field, ...details });
}

/**
 * The list as it is stored: ids kept or minted, texts trimmed, every object
 * in the one key order. An `id` must name an item the task already has — its
 * state survives unless `state` is sent, and its position is wherever the
 * caller put it. Anything else is `unprocessable`, naming the field and a
 * `reason` the client can branch on.
 */
export function normaliseDeliverables(
  incoming: readonly DeliverableInput[],
  existing: readonly TaskDeliverable[],
  mint: () => string = newId,
): TaskDeliverable[] {
  if (incoming.length > DELIVERABLE_LIMITS.items) {
    throw refuse(
      'deliverables',
      `A task ships at most ${String(DELIVERABLE_LIMITS.items)} things`,
      { reason: 'too_many', count: incoming.length },
    );
  }
  const known = new Map(existing.map((item) => [item.id, item]));
  const seen = new Set<string>();
  return incoming.map((item) => {
    const title = item.title.trim();
    if (title === '') {
      throw refuse('deliverables', 'A deliverable needs a title', { reason: 'empty_title' });
    }
    if (title.length > DELIVERABLE_LIMITS.title) {
      throw refuse(
        'deliverables',
        `A deliverable's title is at most ${String(DELIVERABLE_LIMITS.title)} characters`,
        { reason: 'title_too_long', length: title.length },
      );
    }
    const rawDetail = item.detail ?? null;
    const detail = rawDetail === null || rawDetail.trim() === '' ? null : rawDetail.trim();
    if (detail !== null && detail.length > DELIVERABLE_LIMITS.detail) {
      throw refuse(
        'deliverables',
        `A deliverable's detail is at most ${String(DELIVERABLE_LIMITS.detail)} characters`,
        { reason: 'detail_too_long', length: detail.length },
      );
    }
    if (item.state !== undefined && !DELIVERABLE_STATES.includes(item.state)) {
      throw refuse('deliverables', 'A deliverable is pending, in_progress or done', {
        reason: 'unknown_state',
        state: item.state,
      });
    }
    const kept = item.id === undefined ? undefined : known.get(item.id);
    if (item.id !== undefined && kept === undefined) {
      throw refuse('deliverables', 'No deliverable of this task has that id', {
        reason: 'unknown_deliverable',
        id: item.id,
      });
    }
    const id = kept?.id ?? mint();
    if (seen.has(id)) {
      throw refuse('deliverables', 'A deliverable is listed twice', {
        reason: 'duplicate_deliverable',
        id,
      });
    }
    seen.add(id);
    return { id, title, detail, state: item.state ?? kept?.state ?? 'pending' };
  });
}

/** `solves` / `unlocks`: trimmed, non-empty, bounded; `field` names which. */
export function normalisePoints(
  field: 'solves' | 'unlocks',
  incoming: readonly string[],
): string[] {
  if (incoming.length > DELIVERABLE_LIMITS.points) {
    throw refuse(field, `A task lists at most ${String(DELIVERABLE_LIMITS.points)} ${field}`, {
      reason: 'too_many',
      count: incoming.length,
    });
  }
  return incoming.map((line) => {
    const point = line.trim();
    if (point === '') throw refuse(field, `A ${field} line is not empty`, { reason: 'empty_line' });
    if (point.length > DELIVERABLE_LIMITS.point) {
      throw refuse(
        field,
        `A ${field} line is at most ${String(DELIVERABLE_LIMITS.point)} characters`,
        {
          reason: 'line_too_long',
          length: point.length,
        },
      );
    }
    return point;
  });
}

export interface DeliverableMark {
  id: string;
  title: string;
  from: DeliverableState;
  to: DeliverableState;
}

export interface MarkedDeliverables {
  /** The list after the marks, in the same order. */
  deliverables: TaskDeliverable[];
  /** What moved; a no-op is not listed. */
  marked: DeliverableMark[];
  /** Refs naming no item, in input order. */
  unmatched: string[];
}

/**
 * Move the items `refs` name to `to`. A ref is an item's id, else its exact
 * title after trimming both — case-sensitive, so an agent passes back the
 * title `get_task_context` printed. `in_progress` never moves a `done` item
 * back; moving to the state an item is in is nothing, and listed nowhere.
 */
export function markDeliverables(
  list: readonly TaskDeliverable[],
  refs: readonly string[],
  to: DeliverableState,
): MarkedDeliverables {
  const byId = new Map(list.map((item) => [item.id, item]));
  const byTitle = new Map<string, TaskDeliverable>();
  for (const item of list) if (!byTitle.has(item.title)) byTitle.set(item.title, item);

  const moves = new Map<string, DeliverableState>();
  const unmatched: string[] = [];
  for (const raw of refs) {
    const ref = raw.trim();
    const item = byId.get(ref) ?? byTitle.get(ref);
    if (item === undefined) {
      unmatched.push(raw);
      continue;
    }
    if (item.state === to) continue;
    if (to === 'in_progress' && item.state === 'done') continue;
    moves.set(item.id, to);
  }

  const marked: DeliverableMark[] = [];
  const deliverables = list.map((item) => {
    const next = moves.get(item.id);
    if (next === undefined) return { ...item };
    marked.push({ id: item.id, title: item.title, from: item.state, to: next });
    return { id: item.id, title: item.title, detail: item.detail, state: next };
  });
  return { deliverables, marked, unmatched };
}

/** `n of m` built, for prose that names where a task stands. */
export function deliveredCount(list: readonly TaskDeliverable[]): { done: number; total: number } {
  return { done: list.filter((item) => item.state === 'done').length, total: list.length };
}

/** The checkbox a Ships item draws in prose: ticked, half, or empty. */
export function deliverableMark(state: DeliverableState): string {
  return DELIVERABLE_MARKS[state];
}
const DELIVERABLE_MARKS: Record<DeliverableState, string> = {
  pending: '[ ]',
  in_progress: '[~]',
  done: '[x]',
};
