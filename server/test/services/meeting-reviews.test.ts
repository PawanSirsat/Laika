import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { meetingReviews, projects, tasks } from '../../src/db/schema.ts';
import { newId } from '../../src/db/ids.ts';
import { ProviderResponseError, type ProviderClient } from '../../src/services/provider.ts';
import {
  buildPrompt,
  parseProposals,
  storeTranscriptReview,
} from '../../src/services/meeting-reviews.ts';
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
