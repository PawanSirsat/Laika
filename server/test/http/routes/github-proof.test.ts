import { createHash, createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { activity, githubCommits, orgs, projects, tasks } from '../../../src/db/schema.ts';
import { decryptSecret } from '../../../src/secrets.ts';
import { ciLine } from '../../../src/services/github-proof.ts';
import {
  type AuthHarness,
  authHarness,
  cookieFrom,
  jsonHeaders,
  TEST_SECRET,
} from '../../helpers/auth.ts';

/**
 * The GitHub webhook made usable (LAI-753) and GitHub confirming an agent's
 * proof (LAI-766, D-083), over HTTP.
 *
 * **Every delivery here is signed** with the secret the API handed out —
 * HMAC-SHA256 over the exact bytes, as GitHub signs — so these tests pass
 * through the same verification a real delivery does, and the secret they
 * use is one only `POST /org/github-webhook` could have produced.
 */

const PASSWORD = 'correct-horse-battery-staple';
const REPO = 'kvell/laika';
const PUBLIC_URL = 'https://laika.example.test';

let h: AuthHarness;
let cookie: string;
let token: string;
let webhookSecret: string;

/** A distinct, valid 40-hex sha for a name. */
function shaOf(name: string): string {
  return createHash('sha1').update(name).digest('hex');
}

function sign(body: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`;
}

async function deliver(
  event: string,
  payload: unknown,
  secret: string | null = webhookSecret,
): Promise<Response> {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-github-event': event,
    'x-github-delivery': `d-${String(Math.random())}`,
  };
  if (secret !== null) headers['x-hub-signature-256'] = sign(body, secret);
  return h.app.request('/webhooks/github', { method: 'POST', headers, body });
}

/** A delivery that must be accepted. */
async function delivered(event: string, payload: unknown): Promise<Record<string, unknown>> {
  const res = await deliver(event, payload);
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

async function asSession(path: string, init: RequestInit = {}): Promise<Response> {
  return h.app.request(path, {
    ...init,
    headers: jsonHeaders({ Cookie: cookie, ...((init.headers as Record<string, string>) ?? {}) }),
  });
}

async function asToken(path: string, init: RequestInit = {}): Promise<Response> {
  return h.app.request(path, {
    ...init,
    headers: jsonHeaders({
      Authorization: `Bearer ${token}`,
      ...((init.headers as Record<string, string>) ?? {}),
    }),
  });
}

async function must(res: Promise<Response>, expected = 200): Promise<Response> {
  const answered = await res;
  expect(answered.status, await answered.clone().text()).toBe(expected);
  return answered;
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

const BASE = Date.parse('2026-10-17T09:00:00Z');
const at = (minutes: number): string => new Date(BASE + minutes * 60_000).toISOString();

function push(
  branch: string,
  shas: readonly string[],
  opts: { repo?: string; defaultBranch?: string } = {},
): Record<string, unknown> {
  return {
    ref: `refs/heads/${branch}`,
    before: '0'.repeat(40),
    after: shas.at(-1) ?? '0'.repeat(40),
    forced: false,
    repository: { full_name: opts.repo ?? REPO, default_branch: opts.defaultBranch ?? 'main' },
    commits: shas.map((id, i) => ({
      id,
      timestamp: at(i),
      message: `commit ${String(i)}`,
      author: { name: 'Somebody', email: 'somebody@example.test', username: 'somebody' },
    })),
  };
}

function pullRequest(
  action: string,
  opts: {
    number?: number;
    head: string;
    ref?: string;
    merged?: boolean;
    repo?: string;
    updated?: number;
  },
): Record<string, unknown> {
  const repo = opts.repo ?? REPO;
  const number = opts.number ?? 42;
  return {
    action,
    number,
    pull_request: {
      number,
      html_url: `https://github.com/${repo}/pull/${String(number)}`,
      head: { ref: opts.ref ?? 'feature/proof', sha: opts.head },
      merged: opts.merged ?? false,
      updated_at: at(opts.updated ?? 0),
    },
    repository: { full_name: repo },
  };
}

function checkRun(
  head: string,
  name: string,
  conclusion: string | null,
  minute = 10,
  repo = REPO,
): Record<string, unknown> {
  return {
    action: conclusion === null ? 'created' : 'completed',
    check_run: {
      head_sha: head,
      name,
      status: conclusion === null ? 'in_progress' : 'completed',
      conclusion,
      started_at: at(minute - 1),
      completed_at: conclusion === null ? null : at(minute),
    },
    repository: { full_name: repo },
  };
}

interface Item {
  state: string;
  state_source: string | null;
}
interface Round {
  number: number;
  commits: (Item & { sha: string })[];
  branch: (Item & { name: string }) | null;
  pull_request: (Item & { url: string; merged: boolean | null }) | null;
  tests: (Item & { command: string })[];
  ci: {
    head_sha: string;
    total: number;
    passed: number;
    failed: number;
    pending: number;
    failed_names: string[];
  } | null;
}

async function newTask(): Promise<{ id: string; number: number }> {
  return json(
    await must(
      asSession('/api/v1/projects/laika/tasks', {
        method: 'POST',
        body: JSON.stringify({ title: 'Work' }),
      }),
      201,
    ),
  );
}

/** Claimed and finished by the agent's token, with this proof. */
async function finish(proof: Record<string, unknown>, task?: { id: string }): Promise<string> {
  const t = task ?? (await newTask());
  await must(asToken(`/api/v1/tasks/${t.id}/claim`, { method: 'POST' }));
  await must(
    asToken(`/api/v1/tasks/${t.id}/finish`, {
      method: 'POST',
      body: JSON.stringify({ summary: 'Did it', ...proof }),
    }),
  );
  return t.id;
}

async function latest(taskId: string): Promise<Round> {
  const body = await json<{ rounds: Round[] }>(
    await must(asSession(`/api/v1/tasks/${taskId}/rounds`)),
  );
  return body.rounds[0]!;
}

const TESTS = [
  { command: 'pnpm test', exit_code: 0 },
  { command: 'pnpm lint', exit_code: 0 },
];

beforeEach(async () => {
  h = authHarness({ publicUrl: PUBLIC_URL });
  const setup = await h.app.request('/api/v1/setup', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({
      org_name: 'Laika',
      owner_name: 'Ada',
      owner_email: 'ada@example.test',
      owner_password: PASSWORD,
      project_name: 'Laika',
      project_prefix: 'LAI',
    }),
  });
  expect(setup.status, await setup.clone().text()).toBe(201);
  cookie = cookieFrom(setup);
  h.db.update(projects).set({ repo: REPO }).run();

  const minted = await must(
    asSession('/api/v1/tokens', {
      method: 'POST',
      body: JSON.stringify({ name: 'Codex', scope: 'full' }),
    }),
    201,
  );
  token = (await json<{ secret: string }>(minted)).secret;

  const set = await must(asSession('/api/v1/org/github-webhook', { method: 'POST' }), 201);
  webhookSecret = (await json<{ secret: string }>(set)).secret;
});

afterEach(() => {
  h.close();
});

// ------------------------------------------------------------- LAI-753: secret

describe('the webhook secret (LAI-753)', () => {
  it('is made by Laika, answered once, and stored only as ciphertext', async () => {
    const res = await must(asSession('/api/v1/org/github-webhook', { method: 'POST' }), 201);
    const body = await json<{ secret: string; configured: boolean; payload_url: string }>(res);

    expect(body.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(body.configured).toBe(true);
    // The real mount: §10 puts webhooks outside `/api/v1`.
    expect(body.payload_url).toBe(`${PUBLIC_URL}/webhooks/github`);

    const enc = h.db.select({ enc: orgs.githubWebhookSecretEnc }).from(orgs).get()?.enc ?? '';
    expect(enc).not.toContain(body.secret);
    expect(decryptSecret(enc, TEST_SECRET, 'github_webhook_secret')).toBe(body.secret);

    // **Never returned after saving**: the org view says configured, not what.
    const org = await must(asSession('/api/v1/org'));
    const text = await org.clone().text();
    expect(text).not.toContain(body.secret);
    expect((await json<{ github_webhook: unknown }>(org)).github_webhook).toEqual({
      configured: true,
      payload_url: `${PUBLIC_URL}/webhooks/github`,
    });
  });

  it('rotating refuses the old secret at once and accepts the new one', async () => {
    const old = webhookSecret;
    const res = await must(asSession('/api/v1/org/github-webhook', { method: 'POST' }), 201);
    const fresh = (await json<{ secret: string }>(res)).secret;
    expect(fresh).not.toBe(old);

    expect((await deliver('push', push('main', [shaOf('a')]), old)).status).toBe(401);
    expect((await deliver('push', push('main', [shaOf('a')]), fresh)).status).toBe(200);
  });

  it('clearing it refuses every delivery, as a missing secret does', async () => {
    await must(asSession('/api/v1/org/github-webhook', { method: 'DELETE' }), 204);

    const res = await deliver('push', push('main', [shaOf('a')]));
    expect(res.status).toBe(401);
    expect(h.log.find('webhook.received')).toMatchObject({
      verified: false,
      reason: 'no webhook secret is configured',
    });
    const org = await json<{ github_webhook: { configured: boolean } }>(
      await must(asSession('/api/v1/org')),
    );
    expect(org.github_webhook.configured).toBe(false);
  });

  it('refuses an agent token, saying a session is required', async () => {
    // Whoever holds the secret can sign deliveries that confirm proof — so an
    // agent must not be able to mint one for itself (D-083).
    for (const method of ['POST', 'DELETE']) {
      const res = await asToken('/api/v1/org/github-webhook', { method });
      expect(res.status, method).toBe(403);
      expect((await json<{ error: { details: unknown } }>(res)).error.details).toMatchObject({
        reason: 'session_required',
      });
    }
    // And the token's view of the org carries no webhook block at all.
    const org = await json<Record<string, unknown>>(await must(asToken('/api/v1/org')));
    expect('github_webhook' in org).toBe(false);
  });

  it('refuses a bad signature with 401 and records nothing', async () => {
    const res = await deliver('push', push('feature/x', [shaOf('forged')]), 'not-the-secret');
    expect(res.status).toBe(401);
    expect(h.db.select().from(githubCommits).all()).toEqual([]);
  });
});

// ------------------------------------------------------------- LAI-753: push

describe('a push stores what a reader needs (LAI-753)', () => {
  it('records repo, branch, count and shas against the task, and no author', async () => {
    const task = await newTask();
    const shas = [shaOf('one'), shaOf('two'), shaOf('three')];

    await delivered('push', push(`lai-${String(task.number)}-work`, shas));

    const row = h.db.select().from(activity).where(eq(activity.type, 'webhook.commit')).get();
    expect(row?.taskId).toBe(task.id);
    const payload = JSON.parse(row?.payloadJson ?? 'null') as Record<string, unknown>;
    expect(payload).toEqual({
      repo: REPO,
      branch: `lai-${String(task.number)}-work`,
      default_branch: false,
      count: 3,
      shas,
      forced: false,
    });
    // D-050: no commit author is mapped, or even kept.
    expect(row?.payloadJson).not.toContain('somebody');
  });

  it('stores a push to the default branch against the project', async () => {
    const out = await delivered('push', push('main', [shaOf('m1'), shaOf('m2')]));
    expect(out.handled).toBe(true);

    const row = h.db.select().from(activity).where(eq(activity.type, 'webhook.commit')).get();
    expect(row, 'a push to main stored nothing').toBeDefined();
    expect(row?.taskId).toBeNull();
    expect(row?.projectId).toBe(h.db.select().from(projects).get()?.id);
    expect(JSON.parse(row?.payloadJson ?? 'null')).toMatchObject({
      branch: 'main',
      default_branch: true,
      count: 2,
    });
  });

  it('writes no activity for a repository no project tracks, and still remembers the commits', async () => {
    await delivered('push', push('main', [shaOf('elsewhere')], { repo: 'someone/else' }));

    expect(h.db.select().from(activity).where(eq(activity.type, 'webhook.commit')).all()).toEqual(
      [],
    );
    expect(
      h.db
        .select()
        .from(githubCommits)
        .all()
        .map((r) => r.sha),
    ).toEqual([shaOf('elsewhere')]);
  });
});

// ------------------------------------------------------- LAI-766: confirming

describe('GitHub confirms the commits and the branch (D-083)', () => {
  it('a push before the finish confirms them when the finish arrives, by a 7-character prefix', async () => {
    const sha = shaOf('before');
    await delivered('push', push('feature/proof', [sha]));

    const taskId = await finish({
      commits: [{ sha: sha.slice(0, 7), message: 'Fix it' }],
      branch: 'feature/proof',
    });

    const round = await latest(taskId);
    expect(round.commits[0]).toMatchObject({ state: 'confirmed', state_source: 'github' });
    expect(round.branch).toMatchObject({ state: 'confirmed', state_source: 'github' });
  });

  it('a push after the finish confirms them when it arrives', async () => {
    const sha = shaOf('after');
    const taskId = await finish({ commits: [{ sha }], branch: 'feature/later' });
    expect((await latest(taskId)).commits[0]?.state).toBe('claimed');

    const out = await delivered('push', push('feature/later', [sha]));

    expect(out.rounds).toBe(1);
    const round = await latest(taskId);
    expect(round.commits[0]?.state).toBe('confirmed');
    expect(round.branch?.state).toBe('confirmed');
  });

  it('leaves an ambiguous prefix claimed rather than guessing', async () => {
    const one = `abcdef0${'1'.repeat(33)}`;
    const two = `abcdef0${'2'.repeat(33)}`;
    await delivered('push', push('feature/a', [one, two]));

    const taskId = await finish({ commits: [{ sha: 'abcdef0' }, { sha: one.slice(0, 8) }] });

    const round = await latest(taskId);
    expect(round.commits.map((c) => c.state)).toEqual(['claimed', 'confirmed']);
  });

  it('never matches a commit seen in a repository the project does not use', async () => {
    const sha = shaOf('foreign');
    await delivered('push', push('main', [sha], { repo: 'someone/else' }));

    const taskId = await finish({ commits: [{ sha }] });

    expect((await latest(taskId)).commits[0]?.state).toBe('claimed');
  });

  it('matches only in the repository the pull request names, when the proof has one', async () => {
    // The project names no repository, so without the pull request any repo
    // would do; the evidence naming `kvell/laika` is what rules the fork out.
    h.db.update(projects).set({ repo: null }).run();
    const sha = shaOf('fork');
    await delivered('push', push('feature/x', [sha], { repo: 'kvell/laika-fork' }));

    const taskId = await finish({
      commits: [{ sha }],
      pull_request: `https://github.com/${REPO}/pull/9`,
    });

    expect((await latest(taskId)).commits[0]?.state).toBe('claimed');

    await delivered('push', push('feature/x', [sha]));
    expect((await latest(taskId)).commits[0]?.state).toBe('confirmed');
  });
});

describe('GitHub confirms the pull request (D-083)', () => {
  it('confirms the exact pull request whatever the URL’s case or suffix, and shows merged', async () => {
    const head = shaOf('pr-head');
    const taskId = await finish({
      pull_request: 'https://github.com/Kvell/Laika/pull/42/files',
    });
    let round = await latest(taskId);
    expect(round.pull_request).toMatchObject({ state: 'claimed', merged: null });

    // Another pull request's delivery changes nothing.
    await delivered('pull_request', pullRequest('opened', { number: 43, head }));
    expect((await latest(taskId)).pull_request?.state).toBe('claimed');

    await delivered('pull_request', pullRequest('synchronize', { head, updated: 1 }));
    round = await latest(taskId);
    expect(round.pull_request).toMatchObject({ state: 'confirmed', merged: false });

    await delivered('pull_request', pullRequest('closed', { head, merged: true, updated: 2 }));
    expect((await latest(taskId)).pull_request?.merged).toBe(true);
  });

  it('confirms the head commit a pull request names', async () => {
    const head = shaOf('pr-commit');
    await delivered('pull_request', pullRequest('opened', { head }));

    const taskId = await finish({ commits: [{ sha: head }] });

    expect((await latest(taskId)).commits[0]?.state).toBe('confirmed');
  });

  it('a merged pull request moves its task to review and never to done (D-082)', async () => {
    const task = await newTask();
    await must(asToken(`/api/v1/tasks/${task.id}/claim`, { method: 'POST' }));
    const branch = `lai-${String(task.number)}-work`;

    await delivered(
      'pull_request',
      pullRequest('closed', { head: shaOf('merge'), ref: branch, merged: true }),
    );

    const row = h.db.select().from(tasks).where(eq(tasks.id, task.id)).get();
    expect(row?.status).toBe('review');
  });

  it('a merge after the agent finished answers 200, and the task stays in review', async () => {
    // The review gate's ordinary order: the agent finishes, a person merges.
    const task = await newTask();
    await finish({}, task);

    const res = await deliver(
      'pull_request',
      pullRequest('closed', {
        head: shaOf('late-merge'),
        ref: `lai-${String(task.number)}-work`,
        merged: true,
      }),
    );

    expect(res.status, await res.clone().text()).toBe(200);
    expect(h.db.select().from(tasks).where(eq(tasks.id, task.id)).get()?.status).toBe('review');
  });
});

describe('CI confirms or fails the tests (D-083)', () => {
  it('all checks passed confirms every test item, and says so in one line', async () => {
    const head = shaOf('green');
    const taskId = await finish({ commits: [{ sha: head }], tests: TESTS });

    for (const name of ['gate', 'lint', 'build']) {
      await delivered('check_run', checkRun(head, name, 'success'));
    }

    const round = await latest(taskId);
    expect(round.tests.map((t) => t.state)).toEqual(['confirmed', 'confirmed']);
    expect(round.ci).toMatchObject({ head_sha: head, total: 3, passed: 3, failed: 0 });
    expect(ciLine(round.ci!)).toBe('CI: 3 of 3 checks passed');
  });

  it('a failing check fails the test items and names what failed', async () => {
    const head = shaOf('red');
    const taskId = await finish({ commits: [{ sha: head }], tests: TESTS });

    await delivered('check_run', checkRun(head, 'gate', 'success'));
    await delivered('check_run', checkRun(head, 'lint', 'failure'));

    const round = await latest(taskId);
    expect(round.tests.map((t) => t.state)).toEqual(['failed', 'failed']);
    expect(round.ci?.failed_names).toEqual(['lint']);
    expect(ciLine(round.ci!)).toBe('CI: lint failed');
  });

  it('a check still running keeps the tests claimed', async () => {
    const head = shaOf('pending');
    const taskId = await finish({ commits: [{ sha: head }], tests: TESTS });

    await delivered('check_run', checkRun(head, 'gate', 'success'));
    await delivered('check_run', checkRun(head, 'build', null));

    const round = await latest(taskId);
    expect(round.tests.map((t) => t.state)).toEqual(['claimed', 'claimed']);
    expect(ciLine(round.ci!)).toBe('CI: 1 of 2 checks passed, 1 pending');
  });

  it('CI that finished before the finish counts when the finish arrives', async () => {
    const head = shaOf('early');
    await delivered('push', push('feature/early', [head]));
    await delivered('check_run', checkRun(head, 'gate', 'timed_out'));

    const taskId = await finish({ commits: [{ sha: head }], tests: TESTS });

    expect((await latest(taskId)).tests[0]?.state).toBe('failed');
  });

  it('reads CI for the pull request’s head, not an older listed commit', async () => {
    const old = shaOf('old');
    const head = shaOf('new-head');
    const taskId = await finish({
      commits: [{ sha: old }],
      pull_request: `https://github.com/${REPO}/pull/42`,
      tests: TESTS,
    });
    await delivered('check_run', checkRun(old, 'gate', 'failure'));
    await delivered('pull_request', pullRequest('synchronize', { head }));
    await delivered('check_run', checkRun(head, 'gate', 'success'));

    const round = await latest(taskId);
    expect(round.ci?.head_sha).toBe(head);
    expect(round.tests[0]?.state).toBe('confirmed');
  });

  it('counts workflow runs when there are no check runs, never the kinds summed', async () => {
    const head = shaOf('workflows');
    const taskId = await finish({ commits: [{ sha: head }], tests: TESTS });

    await delivered('check_suite', {
      action: 'completed',
      check_suite: {
        head_sha: head,
        status: 'completed',
        conclusion: 'success',
        updated_at: at(5),
        app: { slug: 'github-actions' },
      },
      repository: { full_name: REPO },
    });
    for (const name of ['CI / Deploy', 'Lint']) {
      await delivered('workflow_run', {
        action: 'completed',
        workflow_run: {
          head_sha: head,
          name,
          status: 'completed',
          conclusion: 'success',
          updated_at: at(5),
        },
        repository: { full_name: REPO },
      });
    }

    const round = await latest(taskId);
    expect(round.ci).toMatchObject({ total: 2, passed: 2 });
    expect(round.tests[0]?.state).toBe('confirmed');
  });

  it('newest event wins: a re-run that passes replaces the failure, a late older one does not', async () => {
    const head = shaOf('rerun');
    const taskId = await finish({ commits: [{ sha: head }], tests: TESTS });

    await delivered('check_run', checkRun(head, 'gate', 'failure', 10));
    expect((await latest(taskId)).tests[0]?.state).toBe('failed');

    await delivered('check_run', checkRun(head, 'gate', 'success', 20));
    expect((await latest(taskId)).tests[0]?.state).toBe('confirmed');

    // The first run's delivery, redelivered by hand an hour later.
    await delivered('check_run', checkRun(head, 'gate', 'failure', 10));
    expect((await latest(taskId)).tests[0]?.state).toBe('confirmed');
  });

  it('ignores CI from a repository the project does not use', async () => {
    const head = shaOf('other-ci');
    const taskId = await finish({ commits: [{ sha: head }], tests: TESTS });

    await delivered('check_run', checkRun(head, 'gate', 'failure', 10, 'someone/else'));

    const round = await latest(taskId);
    expect(round.ci).toBeNull();
    expect(round.tests[0]?.state).toBe('claimed');
  });

  it('refuses a check delivery with a bad signature and changes nothing', async () => {
    const head = shaOf('forged-ci');
    const taskId = await finish({ commits: [{ sha: head }], tests: TESTS });

    const res = await deliver('check_run', checkRun(head, 'gate', 'success'), 'forged');

    expect(res.status).toBe(401);
    expect((await latest(taskId)).tests[0]?.state).toBe('claimed');
  });
});

describe('the CI line', () => {
  it('says how many passed, what failed, and what is pending', () => {
    const base = { head_sha: shaOf('x'), failed_names: [] as string[] };
    expect(ciLine({ ...base, total: 1, passed: 1, failed: 0, pending: 0 })).toBe(
      'CI: 1 of 1 check passed',
    );
    expect(
      ciLine({
        ...base,
        total: 5,
        passed: 1,
        failed: 4,
        pending: 0,
        failed_names: ['a', 'b', 'c', 'd'],
      }),
    ).toBe('CI: 4 of 5 checks failed');
    expect(
      ciLine({
        ...base,
        total: 3,
        passed: 1,
        failed: 2,
        pending: 0,
        failed_names: ['lint', 'test'],
      }),
    ).toBe('CI: lint, test failed');
  });
});
