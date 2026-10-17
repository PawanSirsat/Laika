import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { githubChecks, githubCommits, githubPullRequests } from '../../src/db/schema.ts';
import {
  checkOutcome,
  foldRepo,
  GITHUB_RECORD_TTL_MS,
  githubTime,
  pruneGithubRecords,
  pullRequestKey,
  recordCheck,
  recordCommits,
  recordPullRequest,
} from '../../src/services/github-proof.ts';
import { freshDb, type TestDb } from '../helpers/db.ts';

/**
 * The pieces of D-083 that need no webhook to test (LAI-766): how a pull
 * request URL becomes a key, how GitHub's words become an outcome, and how
 * the 30-day record keeps itself. The delivery-driven behaviour is
 * `test/http/routes/github-proof.test.ts`.
 */

const SHA = 'a'.repeat(40);

describe('pullRequestKey', () => {
  it('reduces an agent’s URL and GitHub’s html_url to the same key', () => {
    const key = 'github.com/kvell/laika#42';
    expect(pullRequestKey('https://github.com/kvell/laika/pull/42')).toBe(key);
    expect(pullRequestKey('https://GitHub.com/Kvell/Laika/pull/42/files')).toBe(key);
    expect(pullRequestKey('https://www.github.com/kvell/laika/pull/42#discussion')).toBe(key);
    expect(pullRequestKey('  https://github.com/kvell/laika/pull/042?w=1 ')).toBe(key);
  });

  it('keeps the host, so another GitHub instance is another pull request', () => {
    expect(pullRequestKey('https://ghe.example.com/kvell/laika/pull/42')).toBe(
      'ghe.example.com/kvell/laika#42',
    );
  });

  it('is null for anything that is not a pull request URL', () => {
    expect(pullRequestKey('https://github.com/kvell/laika/issues/42')).toBeNull();
    expect(pullRequestKey('https://github.com/kvell/laika')).toBeNull();
    expect(pullRequestKey('javascript:alert(1)')).toBeNull();
    expect(pullRequestKey('not a url')).toBeNull();
  });
});

describe('checkOutcome', () => {
  it('only a completed run has an answer', () => {
    expect(checkOutcome('queued', null)).toBe('pending');
    expect(checkOutcome('in_progress', null)).toBe('pending');
    expect(checkOutcome(null, 'success')).toBe('pending');
  });

  it('folds GitHub’s conclusions to passed, failed or pending', () => {
    for (const passed of ['success', 'neutral', 'skipped']) {
      expect(checkOutcome('completed', passed), passed).toBe('passed');
    }
    for (const failed of ['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure']) {
      expect(checkOutcome('completed', failed), failed).toBe('failed');
    }
    // GitHub giving up on a run that never reported is no answer either way.
    expect(checkOutcome('completed', 'stale')).toBe('pending');
  });
});

describe('the small readers', () => {
  it('foldRepo lowercases and normalises as §9.1 does', () => {
    expect(foldRepo('Kvell/Laika')).toBe('kvell/laika');
    expect(foldRepo('https://github.com/Kvell/Laika.git')).toBe('kvell/laika');
    expect(foldRepo('')).toBeNull();
  });

  it('githubTime reads an ISO stamp and nothing else', () => {
    expect(githubTime('2026-10-17T09:00:00Z')).toBe(Date.parse('2026-10-17T09:00:00Z'));
    expect(githubTime('yesterday')).toBeNull();
    expect(githubTime(12)).toBeNull();
    expect(githubTime(null)).toBeNull();
  });
});

describe('the 30-day record', () => {
  let t: TestDb;
  beforeEach(() => {
    t = freshDb();
  });
  afterEach(() => {
    t.close();
  });

  it('keeps the first branch and timestamp a commit was seen with, and ignores the zero sha', () => {
    recordCommits(t.db, 'kvell/laika', 'lai-1-work', [{ sha: SHA, committedAt: 5 }], 100);
    const kept = recordCommits(
      t.db,
      'kvell/laika',
      'main',
      [
        { sha: SHA.toUpperCase(), committedAt: 9 },
        { sha: '0'.repeat(40), committedAt: null },
        { sha: 'abc', committedAt: null },
      ],
      200,
    );

    expect(kept).toEqual([SHA]);
    expect(t.db.select().from(githubCommits).all()).toEqual([
      { repo: 'kvell/laika', sha: SHA, branch: 'lai-1-work', committedAt: 5, seenAt: 200 },
    ]);
  });

  it('forgets what no delivery named for 30 days, and keeps what one did', () => {
    const now = 100 * GITHUB_RECORD_TTL_MS;
    const old = now - GITHUB_RECORD_TTL_MS - 1;
    const recent = now - GITHUB_RECORD_TTL_MS + 1;

    recordCommits(t.db, 'kvell/laika', 'x', [{ sha: SHA, committedAt: null }], old);
    recordCommits(t.db, 'kvell/laika', 'x', [{ sha: 'b'.repeat(40), committedAt: null }], recent);
    recordPullRequest(
      t.db,
      {
        key: 'github.com/kvell/laika#1',
        repo: 'kvell/laika',
        number: 1,
        url: 'https://github.com/kvell/laika/pull/1',
        headSha: SHA,
        headRef: 'x',
        merged: false,
        eventAt: old,
      },
      old,
    );
    recordCheck(
      t.db,
      {
        repo: 'kvell/laika',
        headSha: SHA,
        kind: 'check_run',
        name: 'gate',
        outcome: 'passed',
        conclusion: 'success',
        eventAt: recent,
      },
      recent,
    );

    pruneGithubRecords(t.db, now);

    expect(t.db.select().from(githubCommits).all().map((r) => r.sha)).toEqual(['b'.repeat(40)]);
    expect(t.db.select().from(githubPullRequests).all()).toEqual([]);
    expect(t.db.select().from(githubChecks).all().map((r) => r.name)).toEqual(['gate']);
  });
});
