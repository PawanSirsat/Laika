import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { activity, meetingReviews, projects, tasks, users } from '../../src/db/schema.ts';
import { newId } from '../../src/db/ids.ts';
import { ApiError } from '../../src/errors.ts';
import { ProviderResponseError, type ProviderClient } from '../../src/services/provider.ts';
import {
  appendDecision,
  applyMeetingReview,
  discardMeetingReview,
  getMeetingReview,
  listMeetingReviews,
  buildPrompt,
  parseProposals,
  storeTranscriptReview,
  REVIEW_TTL_MS,
} from '../../src/services/meeting-reviews.ts';
import { addMember } from '../../src/services/projects.ts';
import { freshDb, seed, type Seed, type TestDb } from '../helpers/db.ts';

/**
 * §10.2 — a transcript becomes a reviewable proposal set (LAI-450).
 *
 * **Nothing here applies anything.** The half that mutates is LAI-451, and the
 * first test in this file is the one that says so.
 */

let t: TestDb;
let s: Seed;

const QUOTE = 'we should drop the export screen';
const GOOD = JSON.stringify({
  proposals: [{ kind: 'dead', task: 'LAI-1', reason: 'nobody uses it', quote: QUOTE }],
});

function client(text: string): ProviderClient {
  return { complete: () => Promise.resolve(text) };
}

beforeEach(() => {
  t = freshDb();
  s = seed(t.db);
});
afterEach(() => {
  t.close();
});

function addTask(title: string, status: 'todo' | 'done', number: number): string {
  const id = newId();
  t.db
    .insert(tasks)
    .values({
      id,
      projectId: s.projectId,
      number,
      title,
      status,
      priority: 'p2',
      createdBy: s.userId,
      createdVia: 'web',
      createdAt: 1000,
      updatedAt: 1000,
    })
    .run();
  return id;
}

describe('storing a transcript changes nothing else', () => {
  it('writes one meeting_reviews row and touches no other table', async () => {
    // **Proved by row counts, not by reading the handler** — the criterion this
    // whole task is really about.
    addTask('Keep me', 'todo', 1);
    const before = {
      tasks: JSON.stringify(t.db.select().from(tasks).all()),
      projects: JSON.stringify(t.db.select().from(projects).all()),
    };

    await storeTranscriptReview(
      t.db,
      client(GOOD),
      { projectSlug: 'laika', transcript: 'a meeting', source: 'recorder' },
      5_000,
    );

    expect(t.db.select().from(meetingReviews).all()).toHaveLength(1);
    expect(JSON.stringify(t.db.select().from(tasks).all())).toBe(before.tasks);
    expect(JSON.stringify(t.db.select().from(projects).all())).toBe(before.projects);
  });

  it('stores the hash and never the transcript (D-005)', async () => {
    const transcript = 'somebody said something private in this meeting';

    await storeTranscriptReview(
      t.db,
      client(GOOD),
      { projectSlug: 'laika', transcript, source: 'recorder' },
      5_000,
    );

    const row = t.db.select().from(meetingReviews).get();
    expect(JSON.stringify(row)).not.toContain('something private');
    expect(row?.transcriptHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('404s a project slug that does not exist, before calling the provider', async () => {
    let called = false;
    const spy: ProviderClient = {
      complete: () => {
        called = true;
        return Promise.resolve(GOOD);
      },
    };

    await expect(
      storeTranscriptReview(
        t.db,
        spy,
        { projectSlug: 'nope', transcript: 'x', source: 'r' },
        5_000,
      ),
    ).rejects.toThrow();
    // The provider call is the expensive, data-leaving half. A bad slug must not
    // reach it.
    expect(called, 'a bad slug still called the provider').toBe(false);
  });
});

describe('proposal ids are assigned at store time (D-024)', () => {
  it('gives two stores of the same transcript disjoint ids', async () => {
    const input = { projectSlug: 'laika', transcript: 'same', source: 'r' } as const;

    await storeTranscriptReview(t.db, client(GOOD), input, 5_000);
    await storeTranscriptReview(t.db, client(GOOD), input, 6_000);

    const [first, second] = t.db
      .select()
      .from(meetingReviews)
      .all()
      .map((r) => (JSON.parse(r.proposalsJson) as { id: string }[]).map((p) => p.id));

    expect(first?.length).toBeGreaterThan(0);
    // **Neither set's ids appear in the other.** Re-deriving by array index
    // would make these identical, and an apply against a regenerated set would
    // then accept the wrong proposal.
    expect(second?.some((id) => first?.includes(id))).toBe(false);
  });

  it('ignores an id the model supplies', async () => {
    // The model has no reason to make one unique or stable, and §10.2 says the
    // ids are opaque to it.
    const withId = JSON.stringify({
      proposals: [{ id: 'model-chose-this', kind: 'decision', quote: QUOTE }],
    });

    await storeTranscriptReview(
      t.db,
      client(withId),
      { projectSlug: 'laika', transcript: 'x', source: 'r' },
      5_000,
    );

    expect(t.db.select().from(meetingReviews).get()?.proposalsJson).not.toContain(
      'model-chose-this',
    );
  });
});

describe('the model is untrusted input', () => {
  it('refuses prose around the JSON rather than digging it out', () => {
    // Salvaging is how a parser starts accepting things nobody specified.
    expect(() => parseProposals(`Here you go!\n${GOOD}`)).toThrow(ProviderResponseError);
  });

  it('refuses a response with no proposals key', () => {
    expect(() => parseProposals('{"items":[]}')).toThrow(ProviderResponseError);
  });

  it('refuses an unknown kind', () => {
    expect(() =>
      parseProposals(JSON.stringify({ proposals: [{ kind: 'delete-everything', quote: QUOTE }] })),
    ).toThrow(ProviderResponseError);
  });

  it('refuses a proposal with no quote', () => {
    // §10.2: every proposal renders with the quote it was reacting to, so a
    // human can see what the model saw. One without a quote cannot be reviewed.
    expect(() =>
      parseProposals(JSON.stringify({ proposals: [{ kind: 'new', title: 'Do a thing' }] })),
    ).toThrow(ProviderResponseError);
    expect(() =>
      parseProposals(JSON.stringify({ proposals: [{ kind: 'new', quote: '   ' }] })),
    ).toThrow(ProviderResponseError);
  });

  it('names which proposal was wrong', () => {
    // A set of thirty with one bad entry is unreadable without the index.
    // Read from `details`, not `message`: the message is the caller-facing
    // sentence and the specific fault is in the detail, which is where §6.3
    // puts it and where an operator looks.
    let reason = '';
    try {
      parseProposals(
        JSON.stringify({
          proposals: [
            { kind: 'new', quote: QUOTE },
            { kind: 'nonsense', quote: QUOTE },
          ],
        }),
      );
    } catch (err) {
      const detail = (err as { details?: { reason?: string } }).details;
      reason = detail?.reason ?? '';
    }

    expect(reason, 'the failure does not say which proposal').toContain('1');
    expect(reason).toContain('kind');
  });
});

describe('the prompt contains only what §10.2 lists', () => {
  it('sends open tasks, the context document and the transcript — and nothing else', () => {
    // **This is the one place in Laika where data leaves the instance**, so the
    // assertion is about what is absent as much as what is present.
    addTask('An open task', 'todo', 1);
    addTask('A finished task', 'done', 2);
    t.db.update(projects).set({ contextMd: 'THE-CONTEXT-DOCUMENT' }).run();

    const prompt = buildPrompt(t.db, s.projectId, 'LAI', 'THE-TRANSCRIPT');

    expect(prompt).toContain('An open task');
    expect(prompt).toContain('THE-CONTEXT-DOCUMENT');
    expect(prompt).toContain('THE-TRANSCRIPT');
    // A finished task is not an open task, and sending the whole board would be
    // sending more than §10.2 says.
    expect(prompt).not.toContain('A finished task');
  });

  it('sends four fields per task and not the description', () => {
    // §10.2 names key, title, status and assignee. A description is not on that
    // list, and it is the field most likely to carry something sensitive.
    addTask('An open task', 'todo', 1);
    t.db.update(tasks).set({ descriptionMd: 'SECRET-DESCRIPTION' }).run();

    expect(buildPrompt(t.db, s.projectId, 'LAI', 'x')).not.toContain('SECRET-DESCRIPTION');
  });

  it('does not send another project’s tasks', () => {
    const other = newId();
    t.db
      .insert(projects)
      .values({
        id: other,
        orgId: s.orgId,
        name: 'Other',
        slug: 'other',
        prefix: 'OTH',
        createdAt: 1000,
        updatedAt: 1000,
      })
      .run();
    t.db
      .insert(tasks)
      .values({
        id: newId(),
        projectId: other,
        number: 1,
        title: 'ANOTHER-PROJECTS-TASK',
        status: 'todo',
        priority: 'p2',
        createdBy: s.userId,
        createdVia: 'web',
        createdAt: 1000,
        updatedAt: 1000,
      })
      .run();

    expect(buildPrompt(t.db, s.projectId, 'LAI', 'x')).not.toContain('ANOTHER-PROJECTS-TASK');
  });
});

// ------------------------------------------------ applying a set (LAI-451)

/**
 * §10.2's *"Nothing applies without explicit human acceptance"*, made testable.
 *
 * Every test below is that sentence somewhere: only what was accepted, only
 * from this review, only what this human may do, only once, and never half.
 */
describe('applying only what a human accepted (§10.2)', () => {
  const NOW = Date.UTC(2026, 8, 9);

  /** A review row holding `proposals`, written the way the store path writes one. */
  function review(
    proposals: readonly Record<string, unknown>[],
    over: Partial<typeof meetingReviews.$inferInsert> = {},
  ): { id: string; ids: string[] } {
    const stored = proposals.map((p) => ({
      id: newId(),
      kind: 'change',
      task: null,
      title: null,
      description: null,
      changes: null,
      reason: null,
      quote: 'said in the meeting',
      ...p,
    }));
    const id = newId();
    t.db
      .insert(meetingReviews)
      .values({
        id,
        projectId: s.projectId,
        source: 'recorder',
        transcriptHash: 'abc',
        proposalsJson: JSON.stringify(stored),
        status: 'pending',
        reviewedBy: null,
        reviewedAt: null,
        expiresAt: NOW + REVIEW_TTL_MS,
        createdAt: NOW,
        ...over,
      })
      .run();

    return { id, ids: stored.map((p) => p.id) };
  }

  function owner(): ResolvedActor {
    const loaded = loadActor(t.db, s.userId);
    if (loaded === null) throw new Error('no owner');
    return loaded;
  }

  function makeUser(orgRole: 'admin' | 'member'): string {
    const id = newId();
    t.db
      .insert(users)
      .values({
        id,
        email: `${id}@example.test`,
        name: 'Person',
        orgRole,
        createdAt: new Date(NOW),
        updatedAt: new Date(NOW),
      })
      .run();
    return id;
  }

  function actorFor(userId: string): ResolvedActor {
    const loaded = loadActor(t.db, userId);
    if (loaded === null) throw new Error('no such user');
    return loaded;
  }

  function apply(actor: ResolvedActor, id: string, ids: readonly string[]) {
    return applyMeetingReview(t.sqlite, t.db, actor, id, {
      accepted_proposal_ids: ids,
      now: NOW,
    });
  }

  it('applies exactly the accepted proposals and leaves the rest alone', () => {
    // AC1, from both directions: the two happened, the three did not.
    addTask('Rename me', 'todo', 1);
    addTask('Kill me', 'todo', 2);
    addTask('Leave me', 'todo', 3);

    const { id, ids } = review([
      { kind: 'change', task: 'LAI-1', changes: { title: 'Renamed' } },
      { kind: 'dead', task: 'LAI-2' },
      { kind: 'change', task: 'LAI-3', changes: { title: 'MUST NOT HAPPEN' } },
      { kind: 'new', title: 'MUST NOT EXIST' },
      { kind: 'decision', description: 'MUST NOT BE RECORDED' },
    ]);

    const result = apply(owner(), id, [ids[0]!, ids[1]!]);

    expect(result.applied).toHaveLength(2);

    const rows = t.db.select().from(tasks).all();
    // The two that were accepted.
    expect(rows.find((r) => r.number === 1)?.title).toBe('Renamed');
    expect(rows.find((r) => r.number === 2)?.status).toBe('cancelled');
    // The three that were not — by content and by count.
    expect(rows.find((r) => r.number === 3)?.title).toBe('Leave me');
    expect(rows).toHaveLength(3);
    expect(
      t.db.select().from(projects).where(eq(projects.id, s.projectId)).get()?.contextMd,
    ).not.toContain('MUST NOT BE RECORDED');
  });

  it('refuses an id that is not in this review, and one from a different review', () => {
    // AC2. A stable id (D-024) is only worth having if it is checked, and the
    // second case is the one a stale review tab actually produces.
    addTask('A task', 'todo', 1);
    const mine = review([{ kind: 'change', task: 'LAI-1', changes: { title: 'X' } }]);
    const other = review([{ kind: 'change', task: 'LAI-1', changes: { title: 'Y' } }]);

    expect(() => apply(owner(), mine.id, ['not-a-real-id'])).toThrow(/not in this review/);
    expect(() => apply(owner(), mine.id, [other.ids[0]!])).toThrow(/not in this review/);

    // And neither attempt applied anything.
    expect(t.db.select().from(tasks).all()[0]?.title).toBe('A task');
  });

  it('decides each proposal against the applying human, not once for the request', () => {
    // AC3, and the concrete case §3.2 creates: `meeting_proposal.apply` is
    // member-and-up, but a `decision` writes `context_md`, which is lead-only.
    // A member may therefore apply one proposal in a review and not another —
    // which is exactly why the check cannot be per request.
    const memberId = makeUser('member');
    addMember(t.db, owner(), 'laika', memberId, 'member');
    addTask('A task', 'todo', 1);

    const { id, ids } = review([
      { kind: 'change', task: 'LAI-1', changes: { priority: 'p1' } },
      { kind: 'decision', description: 'We are dropping the export screen' },
    ]);

    // The task change: allowed for a member.
    expect(apply(actorFor(memberId), id, [ids[0]!]).applied).toHaveLength(1);

    // The decision: refused for the same member, in the same review.
    expect(() => apply(actorFor(memberId), id, [ids[1]!])).toThrow(ApiError);
    expect(
      t.db.select().from(projects).where(eq(projects.id, s.projectId)).get()?.contextMd,
    ).not.toContain('export screen');

    // And allowed for the owner — so the refusal above is about the role and
    // not about the proposal being unapplicable.
    expect(apply(owner(), id, [ids[1]!]).applied).toHaveLength(1);
    expect(
      t.db.select().from(projects).where(eq(projects.id, s.projectId)).get()?.contextMd,
    ).toContain('export screen');
  });

  it('applying twice does not double', () => {
    // AC4. The case this exists for is a client that posted, lost the
    // response, and retried — so the second call is byte-identical.
    const { id, ids } = review([{ kind: 'new', title: 'A new task' }]);

    const first = apply(owner(), id, ids);
    const second = apply(owner(), id, ids);

    expect(first.applied).toHaveLength(1);
    expect(second.applied).toHaveLength(0);
    expect(second.already_applied).toEqual(ids);

    expect(t.db.select().from(tasks).all()).toHaveLength(1);
    expect(
      t.db
        .select()
        .from(activity)
        .all()
        .filter((r) => r.type === 'meeting.applied'),
    ).toHaveLength(1);
  });

  it('writes meeting.applied naming which proposals, not that a meeting happened', () => {
    // AC5. The payload is the whole point: an audit row saying only "a meeting
    // was applied" is the one §4.8's vocabulary exists to prevent.
    addTask('Kill me', 'todo', 1);
    const { id, ids } = review([
      { kind: 'dead', task: 'LAI-1' },
      { kind: 'new', title: 'Unaccepted' },
    ]);

    apply(owner(), id, [ids[0]!]);

    const row = t.db
      .select()
      .from(activity)
      .all()
      .find((r) => r.type === 'meeting.applied');
    const payload = JSON.parse(row?.payloadJson ?? '{}') as {
      review_id: string;
      applied: { proposal_id: string; kind: string; effect: string }[];
      proposals_total: number;
    };

    expect(payload.review_id).toBe(id);
    expect(payload.proposals_total).toBe(2);
    expect(payload.applied).toHaveLength(1);
    expect(payload.applied[0]).toMatchObject({
      proposal_id: ids[0],
      kind: 'dead',
      effect: 'task.status_changed',
    });
    // The one nobody accepted is not in the audit row either.
    expect(JSON.stringify(payload)).not.toContain(ids[1]!);
  });

  it('a partial failure is not a partial apply', () => {
    // AC6. Proposal three is unapplicable, so one and two must not have landed.
    addTask('Rename me', 'todo', 1);
    addTask('Kill me', 'todo', 2);

    const { id, ids } = review([
      { kind: 'change', task: 'LAI-1', changes: { title: 'Renamed' } },
      { kind: 'dead', task: 'LAI-2' },
      { kind: 'change', task: 'LAI-99', changes: { title: 'no such task' } },
    ]);

    expect(() => apply(owner(), id, ids)).toThrow(/no task LAI-99/);

    const rows = t.db.select().from(tasks).all();
    expect(rows.find((r) => r.number === 1)?.title).toBe('Rename me');
    expect(rows.find((r) => r.number === 2)?.status).toBe('todo');
    expect(
      t.db
        .select()
        .from(activity)
        .all()
        .filter((r) => r.type === 'meeting.applied'),
    ).toEqual([]);

    // And the review is still applyable — the rollback took the `applied_at`
    // stamps with it, so a corrected set is not blocked by the failed attempt.
    const stored = JSON.parse(
      t.db.select().from(meetingReviews).where(eq(meetingReviews.id, id)).get()?.proposalsJson ??
        '[]',
    ) as { applied_at?: number }[];
    expect(stored.every((p) => p.applied_at === undefined)).toBe(true);
  });

  it('an expired review applies nothing, and says so distinctly from not found', () => {
    // AC7. `404` for both would have the review screen say "no such meeting"
    // about a meeting the person attended.
    addTask('A task', 'todo', 1);
    const { id, ids } = review([{ kind: 'dead', task: 'LAI-1' }], {
      expiresAt: NOW - 1,
    });

    let expired: unknown;
    try {
      apply(owner(), id, ids);
    } catch (e) {
      expired = e;
    }
    expect(expired).toBeInstanceOf(ApiError);
    expect((expired as ApiError).code).toBe('conflict');

    let missing: unknown;
    try {
      apply(owner(), newId(), ids);
    } catch (e) {
      missing = e;
    }
    expect((missing as ApiError).code).toBe('not_found');

    expect(t.db.select().from(tasks).all()[0]?.status).toBe('todo');
  });

  it('lapsed by the clock counts as expired even before the cron flips status', () => {
    // §11.6's sweep runs on a schedule, so between lapse and sweep the row
    // still says `pending`. The timestamp is the truth.
    addTask('A task', 'todo', 1);
    const { id, ids } = review([{ kind: 'dead', task: 'LAI-1' }], { expiresAt: NOW - 1 });

    expect(t.db.select().from(meetingReviews).where(eq(meetingReviews.id, id)).get()?.status).toBe(
      'pending',
    );
    expect(() => apply(owner(), id, ids)).toThrow(/expired/);
  });
});

describe('a decision is appended to context_md with its date (§11.4.2)', () => {
  const JAN = Date.UTC(2026, 0, 15);

  it('starts a Decisions list on an empty document', () => {
    expect(appendDecision('', 'We are dropping the export screen', JAN)).toBe(
      '## Decisions\n\n- 2026-01-15 — We are dropping the export screen\n',
    );
  });

  it('keeps one list rather than a heading per meeting', () => {
    // Two meetings a week apart must not produce two `## Decisions` headings —
    // §11.4.2 wants a document that stays readable as it is fed, and a heading
    // per decision is how it stops being one.
    const first = appendDecision('# Laika\n\nA board.', 'We use SQLite', JAN);
    const second = appendDecision(first, 'We drop the export screen', JAN + 7 * 86_400_000);

    expect(second.match(/## Decisions/g)).toHaveLength(1);
    expect(second).toContain('- 2026-01-15 — We use SQLite');
    expect(second).toContain('- 2026-01-22 — We drop the export screen');
    // The prose above it survives.
    expect(second.startsWith('# Laika\n\nA board.')).toBe(true);
  });

  it('the date is the day, not a timestamp or a locale', () => {
    // A document read by whoever opens it, in whatever timezone. `2026-01-15`
    // means the same thing to all of them; `15/01/2026` does not.
    expect(appendDecision('', 'A decision', Date.UTC(2026, 0, 15, 23, 59))).toContain('2026-01-15');
  });

  it('an applied decision goes through the same function', () => {
    // So the shape above is the shape that lands, rather than two spellings of
    // "append with the date" that can drift.
    const owner = loadActor(t.db, s.userId);
    if (owner === null) throw new Error('no owner');

    const id = newId();
    const proposalId = newId();
    t.db
      .insert(meetingReviews)
      .values({
        id,
        projectId: s.projectId,
        source: 'recorder',
        transcriptHash: 'abc',
        proposalsJson: JSON.stringify([
          {
            id: proposalId,
            kind: 'decision',
            task: null,
            title: null,
            description: 'We are dropping the export screen',
            changes: null,
            reason: null,
            quote: 'drop it',
          },
        ]),
        status: 'pending',
        reviewedBy: null,
        reviewedAt: null,
        expiresAt: JAN + REVIEW_TTL_MS,
        createdAt: JAN,
      })
      .run();

    applyMeetingReview(t.sqlite, t.db, owner, id, {
      accepted_proposal_ids: [proposalId],
      now: JAN,
    });

    const context = t.db
      .select()
      .from(projects)
      .where(eq(projects.id, s.projectId))
      .get()?.contextMd;
    expect(context).toBe(appendDecision('', 'We are dropping the export screen', JAN));
  });
});

// ------------------------------------ reading and discarding (LAI-454)

describe('reading a review, and discarding one (§11.4.2)', () => {
  const NOW = Date.UTC(2026, 8, 9);

  const KINDS = ['new', 'change', 'dead', 'decision'] as const;

  function owner(): ResolvedActor {
    const loaded = loadActor(t.db, s.userId);
    if (loaded === null) throw new Error('no owner');
    return loaded;
  }

  function makeUser(orgRole: 'admin' | 'member'): string {
    const id = newId();
    t.db
      .insert(users)
      .values({
        id,
        email: `${id}@example.test`,
        name: 'Person',
        orgRole,
        createdAt: new Date(NOW),
        updatedAt: new Date(NOW),
      })
      .run();
    return id;
  }

  function actorFor(userId: string): ResolvedActor {
    const loaded = loadActor(t.db, userId);
    if (loaded === null) throw new Error('no such user');
    return loaded;
  }

  function review(
    proposals: readonly Record<string, unknown>[],
    over: Partial<typeof meetingReviews.$inferInsert> = {},
  ): string {
    const id = newId();
    t.db
      .insert(meetingReviews)
      .values({
        id,
        projectId: s.projectId,
        source: 'recorder',
        transcriptHash: 'abc',
        proposalsJson: JSON.stringify(
          proposals.map((p) => ({
            id: newId(),
            kind: 'change',
            task: null,
            title: null,
            description: null,
            changes: null,
            reason: null,
            quote: 'said in the meeting',
            ...p,
          })),
        ),
        status: 'pending',
        reviewedBy: null,
        reviewedAt: null,
        expiresAt: NOW + REVIEW_TTL_MS,
        createdAt: NOW,
        ...over,
      })
      .run();
    return id;
  }

  it('all four kinds survive the round trip, asserted by name', () => {
    // By name, not by count — LAI-419's rule. A count of four passes on four
    // copies of `new`, which is the failure that rule exists for.
    const id = review(KINDS.map((kind) => ({ kind, quote: `they said ${kind}` })));

    const detail = getMeetingReview(t.db, owner(), id);
    const kinds = detail.proposals.map((p) => p.kind);

    for (const kind of KINDS) expect(kinds, `${kind} did not survive`).toContain(kind);
    expect(kinds).toHaveLength(4);
  });

  it('every proposal carries its quote', () => {
    // §11.4.2: "each proposal shows its transcript quote". A proposal a human
    // cannot trace to a sentence is one they cannot honestly accept.
    const id = review(KINDS.map((kind) => ({ kind, quote: `they said ${kind}` })));

    for (const p of getMeetingReview(t.db, owner(), id).proposals) {
      expect(p.quote, `${p.kind} lost its quote`).toBe(`they said ${p.kind}`);
    }
  });

  it('the list carries a count, never the proposals or their quotes', () => {
    // The transcript is not stored (§4.12, D-005) — but a `quote` is verbatim
    // transcript content, so a list returning proposals would hand a broad read
    // the quoted parts of every meeting. LAI-454's Notes, on the real premise.
    review([{ kind: 'new', title: 'A task', quote: 'a sentence somebody said aloud' }]);

    const page = listMeetingReviews(t.db, owner(), 'laika', { limit: 20, cursor: null });

    expect(page).toHaveLength(1);
    expect(page[0]?.proposal_count).toBe(1);
    expect(JSON.stringify(page)).not.toContain('a sentence somebody said aloud');
    expect(page[0]).not.toHaveProperty('proposals');
  });

  it('a reader who cannot see the project gets not_found, not forbidden', () => {
    // LAI-454's criterion. Note this differs from `getProject` and
    // `listSprints`, which answer `forbidden` — flagged in the task file.
    review([{ kind: 'new', title: 'A task' }]);
    const outsider = actorFor(makeUser('member'));

    let listed: unknown;
    try {
      listMeetingReviews(t.db, outsider, 'laika', { limit: 20, cursor: null });
    } catch (e) {
      listed = e;
    }
    expect((listed as ApiError).code).toBe('not_found');
  });

  it('a review in a project the reader cannot see reads as not_found', () => {
    const id = review([{ kind: 'new', title: 'A task' }]);
    const outsider = actorFor(makeUser('member'));

    let caught: unknown;
    try {
      getMeetingReview(t.db, outsider, id);
    } catch (e) {
      caught = e;
    }
    // Not `forbidden`: that would confirm the review exists to somebody who may
    // not know the project does.
    expect((caught as ApiError).code).toBe('not_found');
  });

  it('an expired review still reads, and says it is expired', () => {
    // Expiry stops it being applied (§11.6); a human must still see what they
    // missed. The row does not vanish.
    const id = review([{ kind: 'new', title: 'A task' }], {
      status: 'expired',
      expiresAt: NOW - 1,
    });

    const detail = getMeetingReview(t.db, owner(), id);
    expect(detail.status).toBe('expired');
    expect(detail.proposals).toHaveLength(1);
  });

  it('a discarded review cannot then be applied', () => {
    const id = review([{ kind: 'new', title: 'MUST NOT EXIST' }]);
    const proposalId = getMeetingReview(t.db, owner(), id).proposals[0]!.id;

    expect(discardMeetingReview(t.db, owner(), id, NOW).status).toBe('discarded');

    let caught: unknown;
    try {
      applyMeetingReview(t.sqlite, t.db, owner(), id, {
        accepted_proposal_ids: [proposalId],
        now: NOW,
      });
    } catch (e) {
      caught = e;
    }
    expect((caught as ApiError).code).toBe('conflict');
    expect(t.db.select().from(tasks).all()).toHaveLength(0);
  });

  it('an applied review cannot be discarded', () => {
    const id = review([{ kind: 'new', title: 'A task' }]);
    const proposalId = getMeetingReview(t.db, owner(), id).proposals[0]!.id;

    applyMeetingReview(t.sqlite, t.db, owner(), id, {
      accepted_proposal_ids: [proposalId],
      now: NOW,
    });

    let caught: unknown;
    try {
      discardMeetingReview(t.db, owner(), id, NOW);
    } catch (e) {
      caught = e;
    }
    expect((caught as ApiError).code).toBe('conflict');
    expect(t.db.select().from(meetingReviews).where(eq(meetingReviews.id, id)).get()?.status).toBe(
      'applied',
    );
  });

  it('discard is a write, so a viewer cannot do it', () => {
    // `meeting_proposal.apply`, not `project.read`: discarding ends a review
    // nobody else can then act on. A viewer may look and not throw away.
    const id = review([{ kind: 'new', title: 'A task' }]);
    const viewerId = makeUser('member');
    addMember(t.db, owner(), 'laika', viewerId, 'viewer');

    // They can read it...
    expect(getMeetingReview(t.db, actorFor(viewerId), id).proposal_count).toBe(1);

    // ...and not discard it.
    let caught: unknown;
    try {
      discardMeetingReview(t.db, actorFor(viewerId), id, NOW);
    } catch (e) {
      caught = e;
    }
    expect((caught as ApiError).code).toBe('forbidden');
    expect(t.db.select().from(meetingReviews).where(eq(meetingReviews.id, id)).get()?.status).toBe(
      'pending',
    );
  });

  it('discard records who and when, in its own verb', () => {
    const id = review([
      { kind: 'new', title: 'A task' },
      { kind: 'dead', task: 'LAI-1' },
    ]);

    discardMeetingReview(t.db, owner(), id, NOW);

    const row = t.db
      .select()
      .from(activity)
      .all()
      .find((r) => r.type === 'meeting_review.discarded');
    // §4.8's test: a reader answers "when did this happen, and who" from the
    // verb and the row, without inspecting a payload.
    expect(row?.actorId).toBe(s.userId);
    expect(row?.createdAt).toBe(NOW);
    expect(JSON.parse(row?.payloadJson ?? '{}')).toMatchObject({
      review_id: id,
      proposals_total: 2,
    });

    const stored = t.db.select().from(meetingReviews).where(eq(meetingReviews.id, id)).get();
    expect(stored?.reviewedBy).toBe(s.userId);
    expect(stored?.reviewedAt).toBe(NOW);
  });

  it('the list is newest first and pages', () => {
    const older = review([{ kind: 'new', title: 'A' }], { createdAt: NOW - 1000 });
    const newer = review([{ kind: 'new', title: 'B' }], { createdAt: NOW });

    const all = listMeetingReviews(t.db, owner(), 'laika', { limit: 20, cursor: null });
    expect(all.map((r) => r.id)).toEqual([newer, older]);

    // One over the limit, so `buildPage` can tell there is another page.
    expect(listMeetingReviews(t.db, owner(), 'laika', { limit: 1, cursor: null })).toHaveLength(2);
  });

  it('the list filters by status', () => {
    review([{ kind: 'new', title: 'A' }]);
    const discarded = review([{ kind: 'new', title: 'B' }]);
    discardMeetingReview(t.db, owner(), discarded, NOW);

    const only = listMeetingReviews(t.db, owner(), 'laika', {
      limit: 20,
      cursor: null,
      status: 'discarded',
    });

    expect(only.map((r) => r.id)).toEqual([discarded]);
  });
});
