import type { ActivityEvent } from '../../../api/activity.ts';
import type { Checkpoint } from '../../../api/handoffs.ts';
import type { Round } from '../../../api/review.ts';
import { claimFactOf } from '../../../components/agent/execution-derive.ts';

/**
 * **The execution timeline, merged on the client** (LAI-1199; Workroom spec
 * §1.6) from three reads the panel already makes: the task's activity (claims
 * taken, reclaimed, expired), its checkpoints (saves) and its rounds (finish
 * and review). Nothing is inferred: each row is one record, badged with the
 * read it came from.
 *
 * **Runs** are grouped by claim generation, which claims and saves carry.
 * Rounds and reviews carry none, so they sit in the timeline by time alone.
 * The server has no claims history read (`GET /tasks/:id/claims`), so runs
 * are rebuilt from activity — whose first page is the newest 50 — and the
 * panel says so.
 */

export type TimelineSource = 'activity' | 'save' | 'round' | 'review';

export interface TimelineRow {
  readonly id: string;
  readonly at: number;
  readonly source: TimelineSource;
  readonly title: string;
  readonly detail?: string | undefined;
  /** The claim generation, when the record carries one. */
  readonly generation: number | null;
  /** Whether the record is a claim or a save verified, contradicted, or open. */
  readonly tone?: 'ok' | 'warn' | 'bad' | undefined;
}

const VERIFICATION_WORDS: Readonly<Record<Checkpoint['verification'], string>> = {
  pending: 'not yet verified',
  verified: 'verified',
  ref_deleted: 'its branch was deleted',
  uncertain: 'could not be verified',
};

function short(sha: string): string {
  return sha.slice(0, 7);
}

function claimRows(activity: readonly ActivityEvent[]): TimelineRow[] {
  const rows: TimelineRow[] = [];
  for (const event of activity) {
    const fact = claimFactOf(event);
    if (fact === undefined) continue;
    const words =
      fact.kind === 'taken'
        ? 'Claim taken'
        : fact.kind === 'reclaimed'
          ? 'Claim taken back'
          : 'Claim expired';
    rows.push({
      id: `activity:${event.id}`,
      at: fact.at,
      source: 'activity',
      title: words,
      detail: fact.session?.harness ?? undefined,
      generation: fact.generation,
      ...(fact.kind === 'expired' ? { tone: 'warn' as const } : {}),
    });
  }
  return rows;
}

function saveRows(checkpoints: readonly Checkpoint[]): TimelineRow[] {
  return checkpoints.map((c) => ({
    id: `save:${c.id}`,
    at: c.created_at,
    source: 'save',
    title: `Saved ${short(c.commit_sha)} on ${c.branch}`,
    detail: `${String(c.manifest.length)} file${c.manifest.length === 1 ? '' : 's'} · ${VERIFICATION_WORDS[c.verification]}`,
    generation: c.claim_generation,
    tone: c.verification === 'verified' ? 'ok' : c.verification === 'pending' ? undefined : 'warn',
  }));
}

function roundRows(rounds: readonly Round[]): TimelineRow[] {
  const rows: TimelineRow[] = [];
  for (const round of rounds) {
    rows.push({
      id: `round:${round.id}`,
      at: round.created_at,
      source: 'round',
      title: `Round ${String(round.number)} submitted`,
      detail: round.pull_request?.url ?? round.branch?.name ?? undefined,
      generation: null,
    });
    if (round.decision !== null) {
      const accepted = round.decision.kind === 'accepted';
      rows.push({
        id: `review:${round.id}`,
        at: round.decision.created_at,
        source: 'review',
        title: accepted
          ? `Round ${String(round.number)} accepted`
          : `Round ${String(round.number)} sent back`,
        generation: null,
        tone: accepted ? 'ok' : 'bad',
      });
    }
  }
  return rows;
}

/** Every row, newest first; a tie keeps a stable order by id. */
export function timelineRows(input: {
  readonly activity: readonly ActivityEvent[];
  readonly checkpoints: readonly Checkpoint[];
  readonly rounds: readonly Round[];
}): readonly TimelineRow[] {
  return [
    ...claimRows(input.activity),
    ...saveRows(input.checkpoints),
    ...roundRows(input.rounds),
  ].sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
}

export interface TimelineGroup {
  /** `Run 3`, or `null` for rows outside any run. */
  readonly generation: number | null;
  readonly rows: readonly TimelineRow[];
}

/**
 * The rows in **consecutive** groups: each change of generation starts a new
 * group, and a row with none (a round, a review) joins no run and stands in
 * its own group. Order is kept exactly; grouping never moves a row.
 */
export function groupRuns(rows: readonly TimelineRow[]): readonly TimelineGroup[] {
  const groups: { generation: number | null; rows: TimelineRow[] }[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last?.generation === row.generation && last !== undefined) last.rows.push(row);
    else groups.push({ generation: row.generation, rows: [row] });
  }
  return groups;
}

export interface AgentNote {
  readonly id: string;
  readonly kind: 'decisions' | 'open_questions';
  /** The agent's words, exactly as saved — never re-flowed or split. */
  readonly text: string;
  readonly checkpointId: string;
  readonly at: number;
  readonly agentId: string | null;
  readonly generation: number;
  readonly verification: Checkpoint['verification'];
}

/**
 * **Decisions and open questions, as the agent wrote them** (Workroom spec
 * §1.3): each checkpoint's non-empty `decisions` and `open_questions`, newest
 * first, with where it came from. These are free text an agent reported, not
 * a structured record anyone resolved, and the panel labels them so.
 */
export function agentNotes(checkpoints: readonly Checkpoint[]): {
  readonly decisions: readonly AgentNote[];
  readonly questions: readonly AgentNote[];
} {
  const newest = [...checkpoints].sort((a, b) => b.created_at - a.created_at);
  const notes = (kind: AgentNote['kind']): AgentNote[] =>
    newest
      .filter((c) => c.summary !== null && c.summary[kind].trim() !== '')
      .map((c) => ({
        id: `${kind}:${c.id}`,
        kind,
        text: c.summary?.[kind] ?? '',
        checkpointId: c.id,
        at: c.created_at,
        agentId: c.agent_id,
        generation: c.claim_generation,
        verification: c.verification,
      }));
  return { decisions: notes('decisions'), questions: notes('open_questions') };
}

/** The newest checkpoint, if any — the in-progress evidence, a save and not proof. */
export function latestSave(checkpoints: readonly Checkpoint[]): Checkpoint | undefined {
  return [...checkpoints].sort((a, b) => b.created_at - a.created_at)[0];
}
