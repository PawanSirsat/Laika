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
