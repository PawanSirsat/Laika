/**
 * `laika attach` against a real board and a fake file store (D-162,
 * LAI-1351).
 *
 * The board is the real server on its own port and data directory
 * (`support/real-board.ts`); the store is an HTTP fake on another port
 * (`support/fake-store.ts`), so the presigned `PUT`, the board's `HEAD` and
 * its ranged read all cross real sockets. What is asserted is what reached
 * each of them, read back from the board — not the command's own account.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';

import { attach } from '../src/attach.ts';
import { type FakeStore, startFakeStore } from './support/fake-store.ts';
import { must, type RealBoard, seed, type Seeded, startRealBoard } from './support/real-board.ts';
import { xlsx } from './support/zip.ts';

const ENTRY = fileURLToPath(new URL('../src/index.ts', import.meta.url));

void describe('the command is there', () => {
  void test('laika attach --help answers with its usage, not "unknown command"', () => {
    // The green-by-vacancy guard: without the command this exits 1 and prints
    // the top-level usage, so a deleted or unwired attach fails here first.
    const out = execFileSync(process.execPath, [ENTRY, 'attach', '--help'], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', HOME: tmpdir() },
    });
    assert.match(out, /^Usage: laika attach <TASK-KEY> <file…>/);
    assert.match(out, /Exit: 0 every file attached, 1 nothing was linked, 64 usage\./);
  });
});

let store: FakeStore;
let board: RealBoard;
let seeded: Seeded;
let home: string;
let dir: string;

/** The one PNG every test can show: 1×1, so it is an image the board will call inline. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==',
  'base64',
);

async function newTask(title: string): Promise<{ id: string; key: string }> {
  const task = await must(
    await fetch(`${board.url}/api/v1/projects/alpha/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: board.url, cookie: seeded.cookie },
      body: JSON.stringify({ title }),
    }),
    201,
  );
  return { id: String(task.id), key: String(task.key) };
}

async function asOwner(path: string): Promise<Record<string, unknown>> {
  return must(await fetch(`${board.url}${path}`, { headers: { cookie: seeded.cookie } }), 200);
}

interface Ran {
  code: number;
  out: string[];
  err: string[];
}

async function run(
  argv: readonly string[],
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
): Promise<Ran> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await attach(argv, {
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    home,
    env: {},
    fetch: fetchImpl,
  });
  return { code, out, err };
}

function file(name: string, body: string | Buffer): string {
  const path = join(dir, name);
  writeFileSync(path, body);
  return path;
}

const attachmentCreates = (): number =>
  board.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/attachments')).length;
const storePuts = (): number => store.requests.filter((r) => r.method === 'PUT').length;

before(async () => {
  store = await startFakeStore();
  board = await startRealBoard({ ...store.env, LAIKA_ATTACHMENT_MAX_BYTES: '1048576' });
  seeded = await seed(board.url);
  home = mkdtempSync(join(tmpdir(), 'laika-1351-home-'));
  dir = mkdtempSync(join(tmpdir(), 'laika-1351-files-'));
  mkdirSync(join(home, '.laika', 'agents'), { recursive: true });
  const credential = join(home, '.laika', 'agents', 'claude-code.json');
  writeFileSync(credential, JSON.stringify({ url: board.url, token: seeded.agentToken }));
  chmodSync(credential, 0o600);
});

after(async () => {
  await board.stop();
  await store.stop();
  rmSync(home, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
});

void describe('three files, one comment', () => {
  void test('uploads each with exactly its presigned headers, links all three in one comment, captioned', async () => {
    const task = await newTask('Show the result');
    const files = [
      file('after-light.png', PNG),
      file('accounts-masked.csv', 'email,password\nada@example.test,********\n'),
      file('run-report.txt', 'Tests 42 passed\nall green\n'),
    ];
    const puts = storePuts();

    const ran = await run([
      task.key,
      ...files,
      '--caption',
      'After, light theme [laptop]',
      '--caption',
      'Accounts created — passwords masked',
      '--comment',
      'Here is what changed.',
      '--json',
    ]);

    assert.equal(ran.code, 0, ran.err.join('\n'));
    const answer = JSON.parse(ran.out.join('\n')) as {
      ok: boolean;
      task: string;
      comment_id: string;
      via: string;
      attachments: {
        id: string;
        caption: string;
        filename: string;
        size_bytes: number;
        url: string;
      }[];
    };
    assert.equal(answer.ok, true);
    assert.equal(answer.task, task.key);
    assert.equal(answer.via, "claude-code's credential");
    assert.deepEqual(
      answer.attachments.map((a) => a.caption),
      ['After, light theme [laptop]', 'Accounts created — passwords masked', 'run-report.txt'],
    );

    // The store got the bytes, one PUT each, with the headers the board signed
    // — and never the board's token: a presigned URL carries its own signature.
    assert.equal(storePuts() - puts, 3);
    for (const put of store.requests.filter((r) => r.method === 'PUT').slice(puts)) {
      assert.equal(
        put.headers.authorization,
        undefined,
        `${put.path} was sent an Authorization header`,
      );
    }
    for (const a of answer.attachments) {
      const stored = [...store.objects.values()].find(
        (o) => o.headers['content-disposition']?.includes(a.filename) === true,
      );
      assert.ok(stored !== undefined, `${a.filename} never reached the store`);
      assert.equal(stored.body.length, a.size_bytes);
      assert.ok(typeof stored.headers['content-type'] === 'string');
    }

    // On the task: all three, and one comment that links them with their captions.
    const listed = (await asOwner(`/api/v1/tasks/${task.id}/attachments`)).data as {
      id: string;
      task_id: string;
      comment_id: string | null;
    }[];
    assert.deepEqual(listed.map((a) => a.id).sort(), answer.attachments.map((a) => a.id).sort());
    assert.ok(listed.every((a) => a.task_id === task.id && a.comment_id === answer.comment_id));

    const comments = (await asOwner(`/api/v1/tasks/${task.id}/comments`)).data as {
      id: string;
      body_md: string;
    }[];
    assert.equal(comments.length, 1);
    const body = comments[0]?.body_md ?? '';
    assert.match(body, /^Here is what changed\.\n\n\*\*Attached\*\*\n\n/);
    const [png, csv, txt] = answer.attachments;
    assert.ok(
      body.includes(
        `- ![After, light theme \\[laptop\\]](/api/v1/attachments/${png?.id ?? ''}/content)`,
      ),
      body,
    );
    assert.ok(
      body.includes(
        `- [Accounts created — passwords masked](/api/v1/attachments/${csv?.id ?? ''}/content)`,
      ),
      body,
    );
    assert.ok(
      body.includes(`- [run-report.txt](/api/v1/attachments/${txt?.id ?? ''}/content)`),
      body,
    );
  });
});

void describe('a secret is refused here, before anything is sent', () => {
  void test('a password CSV names the file, the kind and the line, and reaches neither board nor store', async () => {
    const task = await newTask('Refused CSV');
    const creates = attachmentCreates();
    const puts = storePuts();
    const csv = file('accounts.csv', 'email,password\nada@example.test,Welcome-2026!\n');

    const ran = await run([task.key, file('fine.txt', 'ok\n'), csv]);

    assert.equal(ran.code, 1);
    const said = ran.err.join('\n');
    assert.match(
      said,
      /accounts\.csv: holds a credentials column with values in it \(line 2\)\. Mask it/,
    );
    assert.match(said, /nothing was attached\./);
    assert.ok(!said.includes('Welcome-2026'), 'the refusal quoted the secret');
    assert.equal(attachmentCreates(), creates);
    assert.equal(storePuts(), puts);
  });

  void test('an xlsx with a token in a cell is refused by sheet and row', async () => {
    const token = ['gh', 'p_', 'Zz9'.repeat(12)].join('');
    const sheet = file(
      'services.xlsx',
      xlsx([
        ['service', 'token'],
        ['ci', token],
      ]),
    );
    const creates = attachmentCreates();

    const ran = await run(['LAI-1', sheet, '--json']);

    assert.equal(ran.code, 1);
    const answer = JSON.parse(ran.out.join('\n')) as {
      ok: boolean;
      linked: boolean;
      errors: string[];
    };
    assert.deepEqual([answer.ok, answer.linked], [false, false]);
    assert.match(
      answer.errors[0] ?? '',
      /services\.xlsx: holds a (GitHub token|credentials column with values in it) \(sheet 1, row 2\)/,
    );
    assert.ok(!JSON.stringify(answer).includes(token));
    assert.equal(attachmentCreates(), creates);
  });
});

void describe('all or none', () => {
  void test('a store that fails the second upload leaves nothing on the task, and every upload made deleted', async () => {
    const task = await newTask('Half an upload');
    store.failPut = 2;
    let ran: Ran;
    try {
      ran = await run([task.key, file('one.png', PNG), file('two.png', PNG), '--json']);
    } finally {
      store.failPut = null;
    }
    assert.equal(ran.code, 1);
    assert.match(ran.err.join('\n'), /two\.png: the file store answered 500/);
    assert.ok(!ran.err.join('\n').includes('STORE-SECRET-WORDS'), 'the store’s body was shown');
    const answer = JSON.parse(ran.out.join('\n')) as {
      linked: boolean;
      cleaned_up: string[];
      cleanup_failed: string[];
    };
    assert.equal(answer.linked, false);
    assert.deepEqual(answer.cleanup_failed, []);
    // Both uploads were made — the second asked for, its PUT refused — and the
    // board answered each one's DELETE with 204, as its own log says.
    assert.equal(answer.cleaned_up.length, 2);
    for (const id of answer.cleaned_up) {
      const deleted = board.requests.filter(
        (r) => r.method === 'DELETE' && r.path === `/api/v1/attachments/${id}`,
      );
      assert.deepEqual(
        deleted.map((r) => r.status),
        [204],
        `the DELETE of ${id} did not succeed once`,
      );
    }
    const listed = (await asOwner(`/api/v1/tasks/${task.id}/attachments`)).data as unknown[];
    assert.deepEqual(listed, []);
    const comments = (await asOwner(`/api/v1/tasks/${task.id}/comments`)).data as unknown[];
    assert.deepEqual(comments, []);
  });

  void test('a read-back that fails twice is linked, unverified — exit 0 with a warning, nothing undone', async () => {
    const task = await newTask('Read-back down');
    const path = `/api/v1/tasks/${task.id}/attachments`;
    let reads = 0;
    const readsFail: typeof fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if ((init?.method ?? 'GET') === 'GET' && url.endsWith(path)) {
        reads += 1;
        return Promise.resolve(new Response('{}', { status: 503 }));
      }
      return fetch(input, init);
    };
    const deletes = board.requests.filter((r) => r.method === 'DELETE').length;

    const ran = await run([task.key, file('five.png', PNG), '--json'], readsFail);

    assert.equal(ran.code, 0, ran.err.join('\n'));
    assert.equal(reads, 2, 'the read-back was not tried twice');
    const answer = JSON.parse(ran.out.join('\n')) as { ok: boolean; verified: boolean };
    assert.deepEqual([answer.ok, answer.verified], [true, false]);
    assert.match(
      ran.err.join('\n'),
      /warning — the comment was posted, but the task's files could not be read back/,
    );
    assert.equal(
      board.requests.filter((r) => r.method === 'DELETE').length,
      deletes,
      'a successful attach was undone',
    );
    assert.equal(((await asOwner(path)).data as unknown[]).length, 1);
  });

  void test('an upload it cannot delete is named loudly, by id, with the sweep as the backstop', async () => {
    const task = await newTask('Cleanup refused');
    store.failPut = 2;
    // The board answers every DELETE with a refusal, as a board mid-restart would.
    const noDeletes: typeof fetch = (input, init) =>
      init?.method === 'DELETE'
        ? Promise.resolve(new Response('{}', { status: 503 }))
        : fetch(input, init);
    let ran: Ran;
    try {
      ran = await run(
        [task.key, file('three.png', PNG), file('four.png', PNG), '--json'],
        noDeletes,
      );
    } finally {
      store.failPut = null;
    }
    assert.equal(ran.code, 1);
    const answer = JSON.parse(ran.out.join('\n')) as {
      linked: boolean;
      cleaned_up: string[];
      cleanup_failed: string[];
    };
    assert.equal(answer.linked, false);
    // Both uploads were made — the second asked for, its PUT refused — and neither could go.
    assert.equal(answer.cleanup_failed.length, 2);
    assert.deepEqual(answer.cleaned_up, []);
    const said = ran.err.join('\n');
    assert.ok(
      said.includes(
        `COULD NOT DELETE 2 uploads already made (${answer.cleanup_failed.join(', ')})`,
      ),
      said,
    );
    assert.match(said, /the board's sweep removes them within 24 hours/);
    // Still on no task: the comment that would link it was never written.
    assert.deepEqual((await asOwner(`/api/v1/tasks/${task.id}/attachments`)).data, []);
  });

  void test('a file over the board’s limit is refused before any upload', async () => {
    const task = await newTask('Too big');
    const creates = attachmentCreates();
    const ran = await run([task.key, file('big.bin', Buffer.alloc(1048577, 1))]);
    assert.equal(ran.code, 1);
    assert.match(ran.err.join('\n'), /big\.bin: 1048577 bytes, over this board's limit of 1048576/);
    assert.equal(attachmentCreates(), creates);
  });
});

void describe('an unlisted finding holding the files', () => {
  void test('--unlisted logs a NEW finding with the files linked to it', async () => {
    const ran = await run([
      '--unlisted',
      'PawanSirsat/Laika',
      '--project',
      'alpha',
      file('flaky.txt', 'retry 3 of 3 failed\n'),
      '--caption',
      'The flaky run',
      '--comment',
      'A flaky test outside any task.',
      '--json',
    ]);
    assert.equal(ran.code, 0, ran.err.join('\n'));
    const answer = JSON.parse(ran.out.join('\n')) as {
      unlisted_id: string;
      attachments: { id: string }[];
    };
    const pile = (await asOwner('/api/v1/unlisted')).data as { id: string; note: string }[];
    const logged = pile.find((u) => u.id === answer.unlisted_id);
    assert.ok(logged !== undefined, 'the finding is not in the pile');
    assert.ok(
      logged.note.includes(
        `[The flaky run](/api/v1/attachments/${answer.attachments[0]?.id ?? ''}/content)`,
      ),
      logged.note,
    );
  });
});

void describe('usage', () => {
  void test('refuses what it cannot do, with 64', async () => {
    for (const argv of [
      [],
      ['LAI-1'],
      ['LAI-1', 'a', '--caption', 'x', '--caption', 'y'],
      ['--unlisted', 'repo', 'a.txt'],
      ['LAI-1', 'a.txt', '--project', 'alpha'],
      ['LAI-1', ...Array.from({ length: 21 }, (_, i) => `f${String(i)}`)],
    ]) {
      assert.equal((await run(argv)).code, 64, argv.join(' '));
    }
  });
});
