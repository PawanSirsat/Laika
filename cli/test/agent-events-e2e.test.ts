/**
 * The event helper against a **real** Laika server stream (LAI-554; SPEC
 * §4.76, §4.77, §6.4, §11.5). One board on its own port, its own database.
 *
 * Events are made the two ways a person makes them without a checkpoint: a
 * project context write (`project.context_updated`, addressed to every agent
 * granted the project) and selecting an agent on a task nobody holds
 * (`task.agent_selected`, addressed to that agent). What the board recorded
 * is read back from the board — `GET /agents/me/events?state=all` — never
 * from the helper's own account.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';

import { agent, type AgentIo } from '../src/agent.ts';
import {
  BLOCK_CLOSE,
  BLOCK_OPEN,
  type EventDeps,
  type Frame,
  mutate,
  NOTICE_MAX,
  readStore,
  runEventStream,
  storePath,
  TASK_KEY,
} from '../src/agent-events.ts';
import { logPath, writeCredential } from '../src/agent-session.ts';
import { must, type RealBoard, startRealBoard } from './support/real-board.ts';

let board: RealBoard;
let cookie = '';
let projectSlug = '';
let projectId = '';
let revision = 0;
let agents = 0;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function api(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<Response> {
  return fetch(`${board.url}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      origin: board.url,
      ...(token === undefined ? { cookie } : { authorization: `Bearer ${token}` }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function newAgent(): Promise<{ id: string; token: string }> {
  agents += 1;
  const made = await must(
    await api('POST', '/api/v1/agents', {
      display_name: `Receiver ${String(agents)}`,
      harness: 'claude-code',
      device_label: `device-${String(agents)}`,
      grants: [{ project_id: projectId, scope: 'full' }],
    }),
    201,
  );
  return { id: (made.agent as { id: string }).id, token: String(made.secret) };
}

async function contextChange(): Promise<void> {
  await must(
    await api('PATCH', `/api/v1/projects/${projectSlug}/context`, {
      context_md: `Brief ${String(revision + 1)}`,
      base_revision: revision,
    }),
    200,
  );
  revision += 1;
}

async function selectFor(agentId: string): Promise<{ id: string; key: string }> {
  const task = await must(
    await api('POST', `/api/v1/projects/${projectSlug}/tasks`, { title: `For ${agentId}` }),
    201,
  );
  await must(
    await api('PATCH', `/api/v1/tasks/${String(task.id)}`, { selected_agent_id: agentId }),
    200,
  );
  return { id: String(task.id), key: String(task.key) };
}

interface BoardView {
  event_id: string;
  type: string;
  delivery: { state: string; received_at: number | null; presented_at: number | null };
}

async function boardEvents(token: string): Promise<BoardView[]> {
  const page = await must(
    await api('GET', '/api/v1/agents/me/events?state=all', undefined, token),
    200,
  );
  return page.data as BoardView[];
}

/** Aborted in each test's `finally`, so a failed wait never leaves a stream running. */
let teardown = new AbortController();

function machine(): { home: string; deps: EventDeps } {
  teardown = new AbortController();
  const home = mkdtempSync(join(tmpdir(), 'laika-554-home-'));
  return {
    home,
    deps: {
      home,
      fetch: (input, init) => fetch(input, init),
      now: () => Date.now(),
      sleep: (ms) => sleep(Math.min(ms, 200)),
    },
  };
}

/** A stop of its own that the test's teardown also triggers. */
function linked(): AbortController {
  const own = new AbortController();
  teardown.signal.addEventListener('abort', () => own.abort(), { once: true });
  return own;
}

async function until(
  what: string,
  check: () => boolean | Promise<boolean>,
  ms = 15_000,
): Promise<void> {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(50);
  }
}

before(async () => {
  board = await startRealBoard();
  const setup = await fetch(`${board.url}/api/v1/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: board.url },
    body: JSON.stringify({
      org_name: 'Events',
      owner_name: 'Ada',
      owner_email: 'ada@example.test',
      owner_password: 'correct-horse-battery-staple',
      project_name: 'laika',
    }),
  });
  cookie = setup.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  const created = await must(setup, 201);
  projectId = String(created.project_id);
  const projects = await must(await api('GET', '/api/v1/projects'), 200);
  projectSlug = (projects.data as { id: string; slug: string }[]).find(
    (p) => p.id === projectId,
  )!.slug;
});

after(async () => {
  await board.stop();
});

void describe('the stream', () => {
  void test('a reconnect that replays what was seen produces no duplicate', async () => {
    const receiver = await newAgent();
    const { home, deps } = machine();
    const credential = { url: board.url, token: receiver.token };
    try {
      const frames: Frame[] = [];
      let stop = linked();
      const first = runEventStream(deps, 'claude-code', credential, {
        signal: stop.signal,
        onFrame: (f) => frames.push(f),
      });
      await until('ready', () => frames.some((f) => f.event === 'ready'));
      await contextChange();
      await until('the context event, received', () =>
        readStore(home, 'claude-code').records.some(
          (r) => r.type === 'project.context_updated' && r.state === 'received',
        ),
      );
      stop.abort();
      assert.equal(await first, 'stopped');

      // While away: a selection. Then rewind the cursor so the reconnect
      // replays every row, the context event included.
      const task = await selectFor(receiver.id);
      mutate(home, 'claude-code', (s) => {
        s.stream_cursor = 1;
      });
      frames.length = 0;
      stop = linked();
      const second = runEventStream(deps, 'claude-code', credential, {
        signal: stop.signal,
        onFrame: (f) => frames.push(f),
      });
      await until('the selection, received', () =>
        readStore(home, 'claude-code').records.some(
          (r) => r.type === 'task.agent_selected' && r.state === 'received',
        ),
      );
      await until('the replayed context frame', () =>
        frames.some((f) => f.event === 'project.context_updated'),
      );
      stop.abort();
      assert.equal(await second, 'stopped');

      const store = readStore(home, 'claude-code');
      assert.deepEqual(
        store.records.map((r) => r.type).sort(),
        ['project.context_updated', 'task.agent_selected'],
        'two events, each once, though the context frame arrived twice',
      );
      assert.equal(new Set(store.seen).size, store.seen.length);
      assert.equal(store.records.find((r) => r.type === 'task.agent_selected')!.task_key, task.key);
      // The board agrees: both received, neither presented.
      const view = await boardEvents(receiver.token);
      assert.deepEqual(view.map((e) => [e.type, e.delivery.state]).sort(), [
        ['project.context_updated', 'received'],
        ['task.agent_selected', 'received'],
      ]);
    } finally {
      teardown.abort();
      rmSync(home, { recursive: true, force: true });
    }
  });

  void test('a gap — a cursor the board does not know — is recovered from the durable record', async () => {
    const receiver = await newAgent();
    const { home, deps } = machine();
    const credential = { url: board.url, token: receiver.token };
    try {
      // Made while no helper ran, then a cursor from "another database".
      await selectFor(receiver.id);
      mutate(home, 'claude-code', (s) => {
        s.stream_cursor = 9_000_000;
      });
      const frames: Frame[] = [];
      const stop = linked();
      const run = runEventStream(deps, 'claude-code', credential, {
        signal: stop.signal,
        onFrame: (f) => frames.push(f),
      });
      await until('the missed selection, received', () =>
        readStore(home, 'claude-code').records.some(
          (r) => r.type === 'task.agent_selected' && r.state === 'received',
        ),
      );
      assert.ok(
        frames.some((f) => f.event === 'gap'),
        'the board said gap',
      );
      assert.ok(
        !frames.some((f) => f.event === 'task.agent_selected'),
        'it did not arrive on the stream: only the poll could have brought it',
      );
      stop.abort();
      await run;
    } finally {
      teardown.abort();
      rmSync(home, { recursive: true, force: true });
    }
  });

  void test('a revoked token closes the stream for good', async () => {
    const receiver = await newAgent();
    const { home, deps } = machine();
    const credential = { url: board.url, token: receiver.token };
    try {
      const frames: Frame[] = [];
      const run = runEventStream(deps, 'claude-code', credential, {
        signal: teardown.signal,
        onFrame: (f) => frames.push(f),
      });
      await until('ready', () => frames.some((f) => f.event === 'ready'));
      await must(await api('POST', `/api/v1/agents/${receiver.id}/revoke`), 200);
      // A row on the log makes the stream re-check the credential now.
      await contextChange();
      const outcome = await Promise.race([run, sleep(15_000).then(() => 'timeout' as const)]);
      assert.equal(outcome, 'refused');
      assert.equal(typeof readStore(home, 'claude-code').refused_at, 'number');
      const streams = (): number =>
        board.requests.filter((r) => r.path.startsWith('/api/v1/events')).length;
      const before = streams();
      await sleep(1500);
      assert.equal(streams(), before, 'no reconnect after a refusal');
      assert.ok(
        !readFileSync(storePath(home, 'claude-code'), 'utf8').includes(receiver.token),
        'the token is not in the store',
      );
    } finally {
      teardown.abort();
      rmSync(home, { recursive: true, force: true });
    }
  });
});

void describe('the hook', () => {
  void test('presents a bounded notice once, and the board records presented only after it printed', async () => {
    const receiver = await newAgent();
    const { home } = machine();
    try {
      writeCredential(home, 'claude-code', { url: board.url, token: receiver.token });
      const task = await selectFor(receiver.id);
      await contextChange();
      const run = async (): Promise<string[]> => {
        const out: string[] = [];
        const io: AgentIo = {
          out: (line) => out.push(line),
          err: () => undefined,
          home,
          // A harness pid that names nothing: no session is bound to whatever
          // process runs this test, and no watcher is started.
          env: { LAIKA_AGENT_HARNESS_PID: 'none' },
          stdin: () =>
            JSON.stringify({ session_id: 'hook-554', hook_event_name: 'UserPromptSubmit' }),
          isTTY: false,
        };
        assert.equal(await agent(['hook', 'prompt', 'claude-code'], io), 0);
        return out;
      };

      const first = await run();
      assert.equal(first.length, 1, 'one JSON line');
      const context = (
        JSON.parse(first[0]!) as { hookSpecificOutput: { additionalContext: string } }
      ).hookSpecificOutput.additionalContext;
      const block = context.slice(context.indexOf(BLOCK_OPEN));
      assert.ok(block.endsWith(BLOCK_CLOSE));
      assert.ok(block.length <= NOTICE_MAX, String(block.length));
      assert.ok(TASK_KEY.test(task.key));
      assert.match(
        block,
        new RegExp(`^${task.key}: agent selection changed; run laika agent inbox$`, 'm'),
      );
      assert.match(block, /^Project context changed: r\d+; call get_project_context to read it$/m);

      const view = await boardEvents(receiver.token);
      assert.deepEqual(
        view.map((e) => e.delivery.state),
        ['presented', 'presented'],
      );
      for (const e of view) {
        assert.ok(e.delivery.presented_at! >= e.delivery.received_at!);
      }

      // Nothing new: the next boundary shows nothing.
      assert.deepEqual(await run(), []);
      const log = readFileSync(logPath(home), 'utf8');
      assert.ok(!log.includes(receiver.token), 'the token is not in the log');
    } finally {
      teardown.abort();
      rmSync(home, { recursive: true, force: true });
    }
  });
});
