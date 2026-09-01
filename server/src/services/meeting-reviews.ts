import { createHash } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { type Db } from '../db/client.ts';
import { newId } from '../db/ids.ts';
import { meetingReviews, projects, tasks } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { type ProviderClient, ProviderResponseError } from './provider.ts';

/**
 * A meeting transcript becomes a **reviewable proposal set** (SPEC §10.2,
 * LAI-450).
 *
 * ## What this does not do
 *
 * **Nothing applies without explicit human acceptance.** This module stores a
 * proposal set and changes nothing else — no task moves, no comment appears, no
 * context is written. `POST /meeting-reviews/:id/apply` is the half that mutates
 * and it is LAI-451, deliberately separate so it can be reviewed as the half
 * that mutates.
 *
 * ## The transcript is not stored
 *
 * §4.12 keeps a `transcript_hash`, and D-005 is why: *"transcripts are never
 * stored"*. The hash is enough to notice the same meeting arriving twice and
 * carries none of what was said.
 */

/** §10.2's four kinds. A proposal outside them is not storable. */
const PROPOSAL_KINDS = ['new', 'change', 'dead', 'decision'] as const;
type ProposalKind = (typeof PROPOSAL_KINDS)[number];

export interface StoredProposal {
  /** Assigned here, at store time. Opaque to the model (D-024). */
  id: string;
  kind: ProposalKind;
  /** The task key this concerns, for `change` and `dead`. */
  task: string | null;
  title: string | null;
  description: string | null;
  changes: Record<string, unknown> | null;
  reason: string | null;
  /** §10.2: every proposal renders with the quote it was reacting to. */
  quote: string;
}

/** Unreviewed proposals expire after 7 days (§4.12, §11.6). */
export const REVIEW_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Everything §10.2 says the provider receives, and **nothing else**.
 *
 * Built as its own function so a test can assert its contents exactly. §10.2
 * lists three things — the transcript, the project's open tasks (key, title,
 * status, assignee) and the current `context_md` — and this is the one place in
 * Laika where data leaves the instance, so *"and nothing else"* is the property
 * rather than a nicety.
 *
 * Not the whole board, not other projects, not `activity`, and not a task's
 * description: §10.2 names four fields per task and four is what goes.
 */
export function buildPrompt(db: Db, projectId: string, prefix: string, transcript: string): string {
  const open = db
    .select({
      number: tasks.number,
      title: tasks.title,
      status: tasks.status,
      assigneeId: tasks.assigneeId,
    })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), inArray(tasks.status, OPEN_STATUSES)))
    .all();

  const project = db
    .select({ context: projects.contextMd })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();

  const lines = open.map(
    (t) =>
      `${prefix}-${String(t.number)} | ${t.title} | ${t.status} | ${t.assigneeId ?? 'unassigned'}`,
  );

  return [
    'You are given a meeting transcript, a project context document, and the',
    "project's open tasks. Return STRICT JSON and nothing else, in this shape:",
    '{"proposals":[{"kind":"new|change|dead|decision","task":"KEY-1","title":"",',
    '"description":"","changes":{},"reason":"","quote":""}]}',
    'Every proposal must carry a `quote` taken verbatim from the transcript.',
    '',
    '## Context document',
    project?.context ?? '(none)',
    '',
    '## Open tasks (key | title | status | assignee)',
    ...lines,
    '',
    '## Transcript',
    transcript,
  ].join('\n');
}

/** §5's statuses that are not finished. `cancelled` and `done` are not open. */
const OPEN_STATUSES = ['backlog', 'todo', 'in_progress', 'review'] as const;

/**
 * Parse what the model returned, strictly.
 *
 * **The model is untrusted input** (LAI-450's Notes): everything here is
 * attacker-influenced if anybody can get text into a meeting, so it is treated
 * the way a request body is. Nothing is coerced, nothing is defaulted into
 * existence, and a shape §10.2 does not describe is refused rather than
 * salvaged.
 */
export function parseProposals(text: string): StoredProposal[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // **Not salvaged.** A model that wraps JSON in prose has not followed the
    // instruction, and digging the object out of the surrounding text is how a
    // parser starts accepting things nobody specified.
    throw new ProviderResponseError('the response was not JSON');
  }

  const root = parsed as { proposals?: unknown };
  if (!Array.isArray(root.proposals)) {
    throw new ProviderResponseError('the response has no `proposals` array');
  }

  return root.proposals.map((raw, index) => toProposal(raw, index));
}

function toProposal(raw: unknown, index: number): StoredProposal {
  /**
   * The fields §10.2 names, all optional, all `unknown`.
   *
   * A shape rather than `Record<string, unknown>` so the reads below are dot
   * notation the linter is happy with — and, more usefully, so a field this
   * function reads that §10.2 does not name is a compile error rather than a
   * string somebody typed.
   */
  const p = (typeof raw === 'object' && raw !== null ? raw : {}) as {
    kind?: unknown;
    task?: unknown;
    title?: unknown;
    description?: unknown;
    changes?: unknown;
    reason?: unknown;
    quote?: unknown;
  };
  const kind = p.kind;

  if (typeof kind !== 'string' || !(PROPOSAL_KINDS as readonly string[]).includes(kind)) {
    throw new ProviderResponseError(
      `proposal ${String(index)} has an unknown kind ${JSON.stringify(kind)}`,
    );
  }

  const quote = p.quote;
  if (typeof quote !== 'string' || quote.trim() === '') {
    // §10.2: every proposal renders with the quote it was reacting to, "so a
    // human can see what the model was reacting to". One without a quote cannot
    // be reviewed, so it is not storable.
    throw new ProviderResponseError(`proposal ${String(index)} has no quote`);
  }

  return {
    // **Assigned here, once, at store time** (D-024). Not from the model, which
    // has no reason to make one unique or stable, and not from the array index,
    // which shifts the moment a set is regenerated.
    id: newId(),
    kind: kind as ProposalKind,
    task: str(p.task),
    title: str(p.title),
    description: str(p.description),
    changes:
      typeof p.changes === 'object' && p.changes !== null
        ? (p.changes as Record<string, unknown>)
        : null,
    reason: str(p.reason),
    quote,
  };
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

export interface StoreTranscriptInput {
  projectSlug: string;
  transcript: string;
  source: string;
}

/**
 * Transcript in, `meeting_reviews` row out. **Nothing else changes.**
 */
export async function storeTranscriptReview(
  db: Db,
  client: ProviderClient,
  input: StoreTranscriptInput,
  now: number,
): Promise<{ id: string; proposals: number }> {
  const project = db
    .select({ id: projects.id, prefix: projects.prefix })
    .from(projects)
    .where(eq(projects.slug, input.projectSlug))
    .get();
  if (project === undefined) throw ApiError.notFound(`No project with slug "${input.projectSlug}"`);

  const prompt = buildPrompt(db, project.id, project.prefix, input.transcript);
  const proposals = parseProposals(await client.complete({ prompt }));

  const id = newId();
  db.insert(meetingReviews)
    .values({
      id,
      projectId: project.id,
      source: input.source,
      // D-005: the hash, never the transcript.
      transcriptHash: createHash('sha256').update(input.transcript, 'utf8').digest('hex'),
      proposalsJson: JSON.stringify(proposals),
      status: 'pending',
      reviewedBy: null,
      reviewedAt: null,
      expiresAt: now + REVIEW_TTL_MS,
      createdAt: now,
    })
    .run();

  return { id, proposals: proposals.length };
}
