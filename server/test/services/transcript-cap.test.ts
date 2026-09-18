import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/client.ts';
import { runMigrations } from '../../src/db/migrate.ts';
import { eq } from 'drizzle-orm';
import { meetingReviews, orgs, projects } from '../../src/db/schema.ts';
import { newId } from '../../src/db/ids.ts';
import {
  CAP_WINDOW_MS,
  MONTHLY_SUBMISSION_CAP,
  submissionsInWindow,
} from '../../src/services/webhooks.ts';
import {
  REVIEW_TTL_MS,
  storeTranscriptReview,
  type StoreTranscriptInput,
} from '../../src/services/meeting-reviews.ts';
import {
  ProviderResponseError,
  ProviderUnavailableError,
  type ProviderClient,
} from '../../src/services/provider.ts';
import { expireMeetingReviews } from '../../src/jobs/jobs.ts';
import { freshDb, seed, type Seed, type TestDb } from '../helpers/db.ts';

/**
 * §10.2's monthly spend cap, counted from the database (D-052, LAI-467).
 *
 * LAI-450 wrote the defect down rather than leaving it to be discovered: the cap
 * lived in the process, so **a restart forgave the count**. For a bound whose
 * whole job is stopping a runaway integration from spending money, that is the
 * wrong direction to be wrong in — and a crash-loop resets it for free.
 */

let t: TestDb;
let s: Seed;

const NOW = Date.UTC(2026, 8, 10);

beforeEach(() => {
  t = freshDb();
  s = seed(t.db);
});
afterEach(() => {
  t.close();
});

/** A stored review, which is what a paid submission leaves behind. */
function review(createdAt: number): string {
  const id = newId();
  t.db
    .insert(meetingReviews)
    .values({
      id,
      projectId: s.projectId,
      source: 'recorder',
      transcriptHash: `${id}-hash`,
      proposalsJson: '[]',
      status: 'pending',
      reviewedBy: null,
      reviewedAt: null,
      expiresAt: createdAt + 7 * 24 * 60 * 60 * 1000,
      createdAt,
    })
    .run();
  return id;
}

describe('the count survives a restart', () => {
  it('is read from the file, so a new process sees the same number', () => {
    // **A genuine restart, not a cleared variable.** Clearing the variable tests
    // the variable. This closes the connection the submissions were made through
    // and opens the same file again — which is what a deploy, a crash-loop or
    // `docker compose restart` actually does, and it is the only version of this
    // test that could have failed against the old in-memory counter.
    const dir = mkdtempSync(join(tmpdir(), 'laika-cap-restart-'));
    const path = join(dir, 'laika.db');

    try {
      const first = openDb({ path });
      runMigrations(first.db);
      const seeded = seed(first.db);

      for (let i = 0; i < 7; i++) {
        const id = newId();
        first.db
          .insert(meetingReviews)
          .values({
            id,
            projectId: seeded.projectId,
            source: 'recorder',
            transcriptHash: `${id}-hash`,
            proposalsJson: '[]',
            status: 'pending',
            reviewedBy: null,
            reviewedAt: null,
            expiresAt: NOW + 1000,
            createdAt: NOW - i * 1000,
          })
          .run();
      }
      expect(submissionsInWindow(first.db, NOW)).toBe(7);

      // ---- the restart -----------------------------------------------------
      first.sqlite.close();

      const second = openDb({ path });
      try {
        // No migrations, no seeding, nothing carried across in a variable: the
        // number comes back out of the file.
        expect(
          submissionsInWindow(second.db, NOW),
          "the month's spend was forgiven by a restart",
        ).toBe(7);
      } finally {
        second.sqlite.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the window is a rolling 30 days, and the boundary is stated', () => {
  it('counts a submission inside the window and not one on its far edge', () => {
    // §10.2 says "monthly" and that does not say which. This pins it: rolling
    // 30 days, **exclusive at the far end** — a review created exactly
    // `CAP_WINDOW_MS` ago has left. A caller at the edge gets a different answer
    // from each reading, so the test names the one this implements.
    review(NOW - CAP_WINDOW_MS + 1); // inside by a millisecond
    review(NOW - CAP_WINDOW_MS); // exactly on the edge — out
    review(NOW - CAP_WINDOW_MS - 1); // older still — out

    expect(submissionsInWindow(t.db, NOW)).toBe(1);
  });

  it('lets the window roll: yesterday-full is today-empty', () => {
    for (let i = 0; i < 5; i++) review(NOW - CAP_WINDOW_MS + 1000 + i);

    expect(submissionsInWindow(t.db, NOW)).toBe(5);
    // Thirty days later the same rows are all outside it.
    expect(submissionsInWindow(t.db, NOW + CAP_WINDOW_MS)).toBe(0);
  });

  it('counts only what is stored, so an empty instance has spent nothing', () => {
    expect(submissionsInWindow(t.db, NOW)).toBe(0);
  });
});

describe('the cap bounds the count', () => {
  it('is not reached at the cap and is reached one past it', () => {
    for (let i = 0; i < MONTHLY_SUBMISSION_CAP; i++) review(NOW - i);

    // The route refuses on `>= CAP`, because the submission being served is not
    // yet a row. So at exactly the cap the next one is refused.
    expect(submissionsInWindow(t.db, NOW)).toBe(MONTHLY_SUBMISSION_CAP);
    expect(submissionsInWindow(t.db, NOW) >= MONTHLY_SUBMISSION_CAP).toBe(true);

    // And one fewer is still servable.
    t.db.delete(meetingReviews).where(eq(meetingReviews.createdAt, NOW)).run();
    expect(submissionsInWindow(t.db, NOW) >= MONTHLY_SUBMISSION_CAP).toBe(false);
  });

  it('does not count rows from outside the window towards it', () => {
    for (let i = 0; i < MONTHLY_SUBMISSION_CAP; i++) review(NOW - CAP_WINDOW_MS - 1 - i);

    expect(submissionsInWindow(t.db, NOW)).toBe(0);
  });
});

describe('what the derived count deliberately does not see', () => {
  it('counts stored reviews, so an org with none has spent nothing regardless of projects', () => {
    // Stated as a test rather than only a comment: the count is over
    // `meeting_reviews`, not over projects, orgs or anything else that grows.
    t.db
      .insert(projects)
      .values({
        id: newId(),
        orgId: t.db.select({ id: orgs.id }).from(orgs).get()?.id ?? '',
        name: 'Another',
        slug: 'another',
        prefix: 'ANO',
        createdAt: NOW,
        updatedAt: NOW,
      })
      .run();

    expect(submissionsInWindow(t.db, NOW)).toBe(0);
  });
});

// -------------------------------- a paid call leaves a row (D-057, LAI-171)

describe('a submission the provider was paid for leaves a row', () => {
  const PROJECT_SLUG = 'laika';

  function input(): StoreTranscriptInput {
    return { projectSlug: PROJECT_SLUG, transcript: 'we talked', source: 'recorder' };
  }

  const answering = (text: string): ProviderClient => ({ complete: () => Promise.resolve(text) });
  const throwing = (err: Error): ProviderClient => ({ complete: () => Promise.reject(err) });

  const rows = () => t.db.select().from(meetingReviews).all();

  it('writes a failed row when the answer will not parse, and still counts', async () => {
    // The gap LAI-467 left and this closes: the provider is called before the
    // insert, so an unusable answer cost money and left nothing for
    // `submissionsInWindow` to count.
    await expect(
      storeTranscriptReview(t.db, answering('not json at all'), input(), NOW),
    ).rejects.toBeInstanceOf(ProviderResponseError);

    expect(rows()).toHaveLength(1);
    expect(rows()[0]?.status).toBe('failed');
    expect(rows()[0]?.proposalsJson).toBe('[]');
    expect(submissionsInWindow(t.db, NOW), 'the spend was not counted').toBe(1);
  });

  it('is distinguishable from a meeting that legitimately proposed nothing', async () => {
    // **The whole argument of D-057.** `{"proposals": []}` is a real answer, so
    // the emptiness cannot be the signal — a reviewer must be able to tell "the
    // model had nothing to propose" from "the model misbehaved".
    await storeTranscriptReview(t.db, answering('{"proposals":[]}'), input(), NOW);
    await expect(
      storeTranscriptReview(t.db, answering('garbage'), input(), NOW + 1),
    ).rejects.toBeInstanceOf(ProviderResponseError);

    const byStatus = rows()
      .map((r) => r.status)
      .sort();
    expect(byStatus).toEqual(['failed', 'pending']);

    // And they are identical on every other axis, which is why status has to be
    // the distinguisher.
    for (const row of rows()) expect(row.proposalsJson).toBe('[]');
  });

  it('writes one when the provider answered with an error, or timed out', async () => {
    // `reached` is true for both: the provider saw the request and may have
    // billed it.
    await expect(
      storeTranscriptReview(
        t.db,
        throwing(new ProviderUnavailableError('provider answered 500', true)),
        input(),
        NOW,
      ),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(rows()).toHaveLength(1);

    await expect(
      storeTranscriptReview(
        t.db,
        throwing(new ProviderUnavailableError('timed out', true)),
        input(),
        NOW + 1,
      ),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);

    expect(rows()).toHaveLength(2);
    expect(rows().every((r) => r.status === 'failed')).toBe(true);
    expect(submissionsInWindow(t.db, NOW + 1)).toBe(2);
  });

  it('writes none when the request never reached the provider', async () => {
    // A refused connection or a DNS failure spent nothing. **Counting these
    // would let a network outage burn the month's budget** — and D-057's title
    // is the rule: a call *that was paid for* leaves a row.
    await expect(
      storeTranscriptReview(
        t.db,
        throwing(new ProviderUnavailableError('could not connect', false)),
        input(),
        NOW,
      ),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);

    expect(rows(), 'a call that never connected was counted as spend').toEqual([]);
    expect(submissionsInWindow(t.db, NOW)).toBe(0);
  });

  it('writes none for a project that does not exist — the provider is never called', async () => {
    // AC4: a rejected request does not count, because it never reached the
    // provider. Asserted with a client that throws if it is called at all.
    const mustNotRun: ProviderClient = {
      complete: () => Promise.reject(new Error('the provider was called for an unknown project')),
    };

    await expect(
      storeTranscriptReview(t.db, mustNotRun, { ...input(), projectSlug: 'nope' }, NOW),
    ).rejects.toThrow(/No project with slug/);

    expect(rows()).toEqual([]);
  });

  it('a failed row is not reviewable and the expiry sweep cannot reach it', async () => {
    // D-057: the sweep moves `pending -> expired`, so a `failed` row is
    // untouched — existing code being right rather than a rule added for this.
    await expect(
      storeTranscriptReview(t.db, answering('garbage'), input(), NOW),
    ).rejects.toBeInstanceOf(ProviderResponseError);

    expireMeetingReviews(t.db, NOW + REVIEW_TTL_MS + 1);

    expect(rows()[0]?.status, 'the sweep expired a failed row').toBe('failed');
  });
});
