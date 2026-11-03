/**
 * The activity feed grouped by who acted (§11.4.2.1, LAI-1117): consecutive
 * items by one actor in one session form a **run**, drawn under one actor row.
 * A person and the agent acting for them are two actors; one agent in two
 * sessions is two runs — the session is part of who did it (D-118).
 *
 * The order is the caller's; this only cuts it where the actor changes.
 */

import type { Round } from '../../../api/review.ts';
import type { Comment } from '../../../api/comments.ts';

export interface Run<T> {
  readonly key: string;
  readonly items: readonly T[];
}

/** Cut `items` into runs of equal `keyOf`, keeping their order. */
export function groupRuns<T>(items: readonly T[], keyOf: (item: T) => string): Run<T>[] {
  const runs: { key: string; items: T[] }[] = [];
  for (const item of items) {
    const key = keyOf(item);
    const last = runs.at(-1);
    if (last?.key === key) last.items.push(item);
    else runs.push({ key, items: [item] });
  }
  return runs;
}

/**
 * Who acted, as a run's key: the person, the agent they acted through, and
 * the session. A system row is its own actor; a redacted agent is still an
 * agent — keyed apart from its person without saying which one.
 */
export function actorKey(row: {
  readonly actor_id: string | null;
  readonly actor_kind?: 'user' | 'agent' | 'system';
  readonly agent_id?: string | null;
  readonly agent_session?: { readonly id: string } | null;
}): string {
  if (row.actor_kind === 'system' || row.actor_id === null) return 'system';
  const agent = row.agent_id ?? (row.actor_kind === 'agent' ? 'agent' : null);
  return [row.actor_id, agent ?? '', row.agent_session?.id ?? ''].join('|');
}

export type CommentKind =
  | { readonly kind: 'plain' }
  | { readonly kind: 'send_back' }
  | { readonly kind: 'finish_summary'; readonly round: number };

/**
 * What a comment is, from what the server already says (LAI-1117): a
 * send-back's reason carries `sent_back`; a finish's summary is the comment
 * `finishTask` posted with the round — the same text, by the same person, at
 * the same instant (one `now` writes both). Anything else is a comment.
 */
export function commentKind(
  comment: Pick<Comment, 'sent_back' | 'body_md' | 'created_at' | 'author_id'>,
  rounds: readonly Pick<Round, 'number' | 'summary_md' | 'created_at' | 'finished_by'>[],
): CommentKind {
  if (comment.sent_back) return { kind: 'send_back' };
  const round = rounds.find(
    (r) =>
      r.created_at === comment.created_at &&
      r.finished_by === comment.author_id &&
      r.summary_md === comment.body_md,
  );
  return round === undefined ? { kind: 'plain' } : { kind: 'finish_summary', round: round.number };
}

/** The first non-blank line of a finish summary, markdown marks stripped: what a folded card shows. */
export function firstLine(md: string, max = 240): string {
  const line =
    md
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l !== '') ?? '';
  const plain = line.replace(/^[-*+]\s+/, '').replace(/[*_`]/g, '');
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}

/** Where an item sits in its run: alone, first, between, or last. */
export type RunPosition = 'solo' | 'start' | 'mid' | 'end';

/**
 * Each item's place in its run (LAI-1122): the first draws the run's header
 * row — avatar, name, agent chip, time — and the rest hang off the rail under
 * it. Same cut as {@link groupRuns}, one answer per item, in order.
 */
export function runPositions<T>(items: readonly T[], keyOf: (item: T) => string): RunPosition[] {
  return groupRuns(items, keyOf).flatMap((run) =>
    run.items.map((_, i): RunPosition => {
      if (run.items.length === 1) return 'solo';
      if (i === 0) return 'start';
      return i === run.items.length - 1 ? 'end' : 'mid';
    }),
  );
}

const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s+/;
const FENCE = /^\s*(```|~~~)/;

/**
 * How many points a finish summary makes (LAI-1122): each list item, each
 * paragraph, each heading and each fenced block is one. A paragraph is a run
 * of lines with no blank between them; a fence is one point however long.
 */
export function summaryPoints(md: string): number {
  let points = 0;
  let inParagraph = false;
  let inFence = false;
  for (const line of md.split('\n')) {
    if (inFence) {
      if (FENCE.test(line)) inFence = false;
      continue;
    }
    if (FENCE.test(line)) {
      points += 1;
      inFence = true;
      inParagraph = false;
    } else if (line.trim() === '') {
      inParagraph = false;
    } else if (LIST_ITEM.test(line) || /^\s*#{1,6}\s/.test(line)) {
      points += 1;
      inParagraph = false;
    } else if (!inParagraph) {
      points += 1;
      inParagraph = true;
    }
  }
  return points;
}

/**
 * The folded summary's button (D-129, LAI-1122): *Show full summary · 6 more
 * points* — every point after the first, which is what a folded card shows —
 * and *Show less* once open.
 */
export function foldLabel(md: string, open: boolean): string {
  if (open) return 'Show less';
  const more = Math.max(summaryPoints(md) - 1, 0);
  if (more === 0) return 'Show full summary';
  return `Show full summary · ${String(more)} more ${more === 1 ? 'point' : 'points'}`;
}
