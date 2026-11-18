import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor, withProject } from '../../src/auth/resolve-actor.ts';
import { newId } from '../../src/db/ids.ts';
import {
  activity,
  attachments,
  comments,
  emailInboundAttachments,
  projectMemberships,
  tasks,
  users,
} from '../../src/db/schema.ts';
import { can } from '../../src/policy/can.ts';
import { deleteComment } from '../../src/services/comments.ts';
import {
  INBOUND_ATTACHMENT_ATTEMPTS,
  INBOUND_ATTACHMENT_MAX_BYTES,
  INBOUND_UNEXPECTED_IN_A_ROW,
  runInboundAttachments,
} from '../../src/services/email-inbound-attachments.ts';
import {
  getProjectEmailAddress,
  receiveInboundEmail,
  rotateEmailInboundToken,
  setEmailInboundSettings,
} from '../../src/services/email-inbound.ts';
import { freshDb, seed, type Seed, type TestDb } from '../helpers/db.ts';
import { fakeAttachments, fakeS3, type FakeS3 } from '../helpers/fake-s3.ts';

/**
 * An inbound mail's attachments, from Brevo to the store (§11.6, D-155 item 6,
 * LAI-1315). Brevo and the store are both fakes — **no test calls either**.
 * The rule: a file is stored as the mail's sender uploaded it, on the task or
 * comment the mail made, and a file that cannot be stored never takes the
 * task with it.
 */

const SECRET = 'test-secret-that-is-long-enough-to-pass-validation';
const NOW = Date.UTC(2026, 11, 1, 9);
const API_KEY = 'xkeysib-fixture-never-real-ABCD';
const PDF = new TextEncoder().encode('%PDF-1.7 the trace from the mail');

let t: TestDb;
let s: Seed;
let owner: ResolvedActor;
let s3: FakeS3;
let brevoCalls: string[];
let brevoAnswer: (token: string) => Response;

beforeEach(() => {
  t = freshDb();
  s = seed(t.db, NOW - 60_000);
  owner = loadActor(t.db, s.userId)!;
  s3 = fakeS3();
  brevoCalls = [];
  brevoAnswer = () => new Response(PDF);
});
afterEach(() => {
  t.close();
});

const brevoFetch: typeof fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  expect(new Headers(init?.headers).get('api-key')).toBe(API_KEY);
  const token = decodeURIComponent(url.split('/').pop()!);
  brevoCalls.push(token);
  return Promise.resolve(brevoAnswer(token));
};

function deps(store: 'on' | 'off' = 'on', maxBytes?: number, onFault?: (cause: unknown) => void) {
  return {
    fetchImpl: brevoFetch,
    onFault,
    attachments:
      store === 'off'
        ? { config: null }
        : { config: fakeAttachments(maxBytes), fetchImpl: s3.fetchImpl, now: () => NOW },
  };
}

function file(token: string, size = PDF.length, name = 'trace.pdf') {
  return { Name: name, ContentType: 'application/pdf', ContentLength: size, DownloadToken: token };
}

/** Email to tasks on, with a key; a mail with `files` to the seed's space. */
function mailWith(
  files: unknown[],
  extra: Record<string, unknown> = {},
  apiKey: string | null = API_KEY,
) {
  setEmailInboundSettings(
    t.db,
    owner,
    {
      domain: 'tasks.example.test',
      authserv_id: 'mx.b',
      ...(apiKey === null ? {} : { api_key: apiKey }),
    },
    SECRET,
    '',
    NOW,
  );
  rotateEmailInboundToken(t.db, owner, '', NOW);
  setEmailInboundSettings(t.db, owner, { enabled: true }, SECRET, '', NOW);
  const to = getProjectEmailAddress(t.db, owner, 'laika', NOW).address!;
  return receiveInboundEmail(
    t.sqlite,
    t.db,
    {
      items: [
        {
          MessageId: '<m1@example.test>',
          From: { Address: 'owner@example.test' },
          Recipients: [{ Address: to }],
          Subject: 'The trace',
          ExtractedMarkdownMessage: 'Attached.',
          Attachments: files,
          Headers: { 'Authentication-Results': 'mx.b; dmarc=pass header.from=example.test' },
          ...extra,
        },
      ],
    },
    NOW,
  );
}

function queue() {
  return t.db.select().from(emailInboundAttachments).all();
}

/** A reply to the seed's first mail, with `files`, from the owner. */
function replyWith(files: unknown[]) {
  const to = getProjectEmailAddress(t.db, owner, 'laika', NOW).address!;
  return receiveInboundEmail(
    t.sqlite,
    t.db,
    {
      items: [
        {
          MessageId: '<m2@example.test>',
          InReplyTo: '<m1@example.test>',
          From: { Address: 'owner@example.test' },
          Recipients: [{ Address: to }],
          Subject: 'Re: The trace',
          ExtractedMarkdownMessage: 'And the log.',
          Attachments: files,
          Headers: { 'Authentication-Results': 'mx.b; dmarc=pass header.from=example.test' },
        },
      ],
    },
    NOW,
  );
}

describe('stored as the sender uploaded them', () => {
  it('fetches each file once and stores it, ready, on the task — attachment.added as the sender', async () => {
    mailWith([file('dl-1'), file('dl-2', PDF.length, 'second.pdf')]);
    const tick = await runInboundAttachments(t.db, SECRET, deps(), NOW);
    expect(tick).toEqual({ stored: 2, failed: 0, skipped: 0, retried: 0 });
    expect(brevoCalls).toEqual(['dl-1', 'dl-2']);

    const task = t.db.select().from(tasks).get()!;
    const stored = t.db.select().from(attachments).all();
    expect(stored.map((a) => [a.filename, a.state, a.taskId, a.commentId, a.uploadedBy])).toEqual([
      ['trace.pdf', 'ready', task.id, null, s.userId],
      ['second.pdf', 'ready', task.id, null, s.userId],
    ]);
    expect(stored[0]?.inline).toBe(1);
    expect(s3.objects.get(stored[0]!.storageKey)?.body).toEqual(PDF);
    // The queue is done with, and its tokens gone.
    expect(queue().map((q) => [q.state, q.downloadToken, q.attachmentId])).toEqual([
      ['stored', null, stored[0]!.id],
      ['stored', null, stored[1]!.id],
    ]);
    const added = t.db.select().from(activity).where(eq(activity.type, 'attachment.added')).all();
    expect(added.map((a) => [a.actorKind, a.actorId])).toEqual([
      ['user', s.userId],
      ['user', s.userId],
    ]);

    // Nothing left: the next tick fetches nothing.
    expect(await runInboundAttachments(t.db, SECRET, deps(), NOW)).toEqual({
      stored: 0,
      failed: 0,
      skipped: 0,
      retried: 0,
    });
    expect(brevoCalls).toHaveLength(2);
  });

  it('puts a reply’s file on the comment it came with', async () => {
    mailWith([]);
    replyWith([file('dl-3', PDF.length, 'log.pdf')]);
    await runInboundAttachments(t.db, SECRET, deps(), NOW);
    const comment = t.db.select().from(comments).get()!;
    expect(t.db.select().from(attachments).get()).toMatchObject({
      filename: 'log.pdf',
      commentId: comment.id,
      taskId: comment.taskId,
    });
  });
});

describe('a file that cannot be stored never blocks its task', () => {
  it('store_off: the board has no file store', async () => {
    mailWith([file('dl-1')]);
    expect(await runInboundAttachments(t.db, SECRET, deps('off'), NOW)).toMatchObject({
      skipped: 1,
    });
    expect(queue()[0]).toMatchObject({
      state: 'skipped',
      reason: 'store_off',
      downloadToken: null,
    });
    expect(brevoCalls).toHaveLength(0);
    expect(t.db.select().from(tasks).all()).toHaveLength(1);
  });

  it('no_api_key: nothing can be fetched without one', async () => {
    mailWith([file('dl-1')], {}, null);
    await runInboundAttachments(t.db, SECRET, deps(), NOW);
    expect(queue()[0]).toMatchObject({ state: 'skipped', reason: 'no_api_key' });
    expect(brevoCalls).toHaveLength(0);
  });

  it('no_api_key: one LAIKA_SECRET can no longer read', async () => {
    mailWith([file('dl-1')]);
    await runInboundAttachments(t.db, 'a-different-secret-that-is-long-enough', deps(), NOW);
    expect(queue()[0]).toMatchObject({ state: 'skipped', reason: 'no_api_key' });
  });

  it('too_large: announced over the limit is never fetched; one that arrives over it is not kept', async () => {
    mailWith([file('dl-big', 10_000), file('dl-liar', 5)]);
    brevoAnswer = () => new Response(new Uint8Array(5_000));
    await runInboundAttachments(t.db, SECRET, deps('on', 1_000), NOW);
    expect(queue().map((q) => [q.state, q.reason])).toEqual([
      ['skipped', 'too_large'],
      ['skipped', 'too_large'],
    ]);
    expect(brevoCalls).toEqual(['dl-liar']);
    expect(s3.objects.size).toBe(0);
  });

  it('fetch_failed: tried three times, a tick apart, then given up', async () => {
    mailWith([file('dl-1')]);
    brevoAnswer = () => new Response('BREVO-SECRET-WORDS', { status: 500 });
    for (let i = 1; i < INBOUND_ATTACHMENT_ATTEMPTS; i += 1) {
      expect(await runInboundAttachments(t.db, SECRET, deps(), NOW)).toMatchObject({ retried: 1 });
      expect(queue()[0]).toMatchObject({ state: 'pending', attempts: i });
    }
    expect(await runInboundAttachments(t.db, SECRET, deps(), NOW)).toMatchObject({ failed: 1 });
    expect(queue()[0]).toMatchObject({
      state: 'failed',
      reason: 'fetch_failed',
      attempts: INBOUND_ATTACHMENT_ATTEMPTS,
      downloadToken: null,
    });
    expect(t.db.select().from(tasks).all()).toHaveLength(1);
  });

  it('store_failed: the store refused the file three times; the half-made row is left to the sweep', async () => {
    mailWith([file('dl-1')]);
    // A 4xx is the file's: charged, where a store that is down is not.
    s3.intercept = (req) =>
      req.method === 'PUT' ? new Response('no', { status: 400 }) : undefined;
    for (let i = 0; i < INBOUND_ATTACHMENT_ATTEMPTS; i += 1) {
      await runInboundAttachments(t.db, SECRET, deps(), NOW);
    }
    expect(queue()[0]).toMatchObject({ state: 'failed', reason: 'store_failed' });
    // Each try's `pending` row is what §11.6's sweep removes after 24 hours.
    expect(
      t.db
        .select()
        .from(attachments)
        .all()
        .every((a) => a.state === 'pending'),
    ).toBe(true);
  });

  it('not_needed: a sender deactivated since the mail came has nothing to store it as', async () => {
    mailWith([file('dl-1')]);
    t.db.update(users).set({ isActive: 0 }).where(eq(users.id, s.userId)).run();
    await runInboundAttachments(t.db, SECRET, deps(), NOW);
    expect(queue()[0]).toMatchObject({ state: 'skipped', reason: 'not_needed' });
    expect(brevoCalls).toHaveLength(0);
  });

  it('not_needed: a member removed from the space since the mail has nothing fetched or stored (F4)', async () => {
    const memberId = newId();
    t.db
      .insert(users)
      .values({
        id: memberId,
        email: 'member@example.test',
        name: 'Member',
        orgRole: 'member',
        isActive: 1,
        createdAt: new Date(NOW),
        updatedAt: new Date(NOW),
      })
      .run();
    t.db
      .insert(projectMemberships)
      .values({
        id: newId(),
        projectId: s.projectId,
        userId: memberId,
        role: 'member',
        createdAt: NOW,
      })
      .run();
    mailWith([file('dl-1')], { From: { Address: 'member@example.test' } });
    // Written as the member, who may attach there — until they leave.
    expect(t.db.select().from(tasks).get()?.createdBy).toBe(memberId);
    const member = () => withProject(loadActor(t.db, memberId)!, s.projectId);
    expect(can(member(), 'attachment.create', { projectId: s.projectId })).toBe(true);
    t.db.delete(projectMemberships).where(eq(projectMemberships.userId, memberId)).run();
    expect(can(member(), 'attachment.create', { projectId: s.projectId })).toBe(false);

    await runInboundAttachments(t.db, SECRET, deps(), NOW);
    expect(queue()[0]).toMatchObject({ state: 'skipped', reason: 'not_needed' });
    expect(brevoCalls).toHaveLength(0);
    expect(t.db.select().from(attachments).all()).toHaveLength(0);
  });

  it('not_needed: a reply whose comment was deleted is not moved onto the task (F5)', async () => {
    mailWith([]);
    replyWith([file('dl-3', PDF.length, 'log.pdf')]);
    const comment = t.db.select().from(comments).get()!;
    deleteComment(t.db, owner, comment.id, NOW);

    await runInboundAttachments(t.db, SECRET, deps(), NOW);
    expect(queue()[0]).toMatchObject({ state: 'skipped', reason: 'not_needed' });
    expect(brevoCalls).toHaveLength(0);
    expect(t.db.select().from(attachments).all()).toHaveLength(0);
  });

  it('switch_off: Email to tasks turned off since the mail came fetches nothing (F3)', async () => {
    mailWith([file('dl-1'), file('dl-2')]);
    setEmailInboundSettings(t.db, owner, { enabled: false }, SECRET, '', NOW);
    expect(await runInboundAttachments(t.db, SECRET, deps(), NOW)).toMatchObject({ skipped: 2 });
    expect(queue().map((q) => [q.state, q.reason, q.downloadToken])).toEqual([
      ['skipped', 'switch_off', null],
      ['skipped', 'switch_off', null],
    ]);
    expect(brevoCalls).toHaveLength(0);
  });

  it('too_large past the inbound ceiling, whatever the board allows: held in memory (F2)', async () => {
    const board = INBOUND_ATTACHMENT_MAX_BYTES * 2;
    mailWith([file('dl-big', INBOUND_ATTACHMENT_MAX_BYTES + 1), file('dl-liar', 5)]);
    let pulls = 0;
    brevoAnswer = () =>
      new Response(
        new ReadableStream<Uint8Array>(
          {
            pull(controller) {
              pulls += 1;
              controller.enqueue(new Uint8Array(1));
            },
          },
          { highWaterMark: 0 },
        ),
        { headers: { 'content-length': String(INBOUND_ATTACHMENT_MAX_BYTES + 1) } },
      );
    await runInboundAttachments(t.db, SECRET, deps('on', board), NOW);
    expect(queue().map((q) => [q.state, q.reason])).toEqual([
      ['skipped', 'too_large'],
      ['skipped', 'too_large'],
    ]);
    // The announced one is never asked for; the one that lied is refused unread.
    expect(brevoCalls).toEqual(['dl-liar']);
    expect(pulls).toBe(0);
  });
});

describe('a store that is down fails nothing', () => {
  it('ends the tick at the first refusal, fetches nothing behind it, and charges nobody; all stored once it is back', async () => {
    mailWith([file('dl-1'), file('dl-2', PDF.length, 'b.pdf'), file('dl-3', PDF.length, 'c.pdf')]);
    let down = true;
    s3.intercept = (req) =>
      down && req.method === 'PUT' ? new Response('no', { status: 503 }) : undefined;
    for (let tick = 1; tick <= 3; tick += 1) {
      expect(await runInboundAttachments(t.db, SECRET, deps(), NOW)).toEqual({
        stored: 0,
        failed: 0,
        skipped: 0,
        retried: 0,
      });
      // Only the head is asked for, once a tick; nobody behind it is fetched.
      expect(brevoCalls).toEqual(Array(tick).fill('dl-1'));
      expect(queue().map((q) => [q.state, q.attempts])).toEqual([
        ['pending', 0],
        ['pending', 0],
        ['pending', 0],
      ]);
    }

    down = false;
    expect(await runInboundAttachments(t.db, SECRET, deps(), NOW)).toMatchObject({ stored: 3 });
    expect(queue().map((q) => [q.state, q.attempts])).toEqual([
      ['stored', 0],
      ['stored', 0],
      ['stored', 0],
    ]);
  });

  it('a 4xx is the file’s, not the store’s: charged, and the next file is stored in the same tick', async () => {
    mailWith([file('dl-big', PDF.length, 'big.pdf'), file('dl-2', PDF.length, 'fine.pdf')]);
    s3.intercept = (req) =>
      req.method === 'PUT' && req.headers.get('content-disposition')?.includes('big.pdf') === true
        ? new Response('too big for the proxy', { status: 413 })
        : undefined;
    expect(await runInboundAttachments(t.db, SECRET, deps(), NOW)).toEqual({
      stored: 1,
      failed: 0,
      skipped: 0,
      retried: 1,
    });
    expect(queue().map((q) => [q.filename, q.state, q.attempts])).toEqual([
      ['big.pdf', 'pending', 1],
      ['fine.pdf', 'stored', 0],
    ]);
  });
});

describe('a compressed body (gzip)', () => {
  it('is stored whole, though its Content-Length is the compressed size', async () => {
    const csv = new TextEncoder().encode('id,name\n1,Ada\n'.repeat(5_000));
    mailWith([file('dl-csv', csv.length, 'people.csv')]);
    // What Node's fetch hands back for a gzip answer: the body inflated, the
    // headers as sent (brevo-inbound.test.ts shows it against a real server).
    brevoAnswer = () =>
      new Response(csv, { headers: { 'content-encoding': 'gzip', 'content-length': '312' } });
    expect(await runInboundAttachments(t.db, SECRET, deps(), NOW)).toMatchObject({ stored: 1 });
    const stored = t.db.select().from(attachments).get()!;
    expect(s3.objects.get(stored.storageKey)?.body).toEqual(csv);
  });

  it('a gzip bomb stops at the inbound ceiling, whatever the board allows', async () => {
    mailWith([file('dl-bomb', 5, 'small.zip')]);
    const MiB = 1024 * 1024;
    let pulled = 0;
    brevoAnswer = () =>
      new Response(
        new ReadableStream<Uint8Array>(
          {
            pull(controller) {
              pulled += MiB;
              controller.enqueue(new Uint8Array(MiB));
            },
          },
          { highWaterMark: 0 },
        ),
        { headers: { 'content-encoding': 'gzip', 'content-length': '41000' } },
      );
    await runInboundAttachments(t.db, SECRET, deps('on', INBOUND_ATTACHMENT_MAX_BYTES * 2), NOW);
    expect(queue()[0]).toMatchObject({ state: 'skipped', reason: 'too_large' });
    expect(pulled).toBe(INBOUND_ATTACHMENT_MAX_BYTES + MiB);
    expect(s3.objects.size).toBe(0);
  });
});

describe('one file never stops the others (M1)', () => {
  it('stores a name cut nowhere near a pair, with a disposition that decodes back to it', async () => {
    // 202 code points, 402 UTF-16 units: a cut at 255 units splits a pair.
    const name = `ab${'\u{1F600}'.repeat(200)}`;
    mailWith([file('dl-1', PDF.length, name)]);
    expect(await runInboundAttachments(t.db, SECRET, deps(), NOW)).toMatchObject({ stored: 1 });
    const stored = t.db.select().from(attachments).get()!;
    expect(stored.filename).toBe(name);
    const disposition = s3.objects.get(stored.storageKey)!.contentDisposition;
    expect(/^[\x20-\x7e]+$/.test(disposition)).toBe(true);
    expect(decodeURIComponent(/filename\*=UTF-8''(\S+)$/.exec(disposition)![1]!)).toBe(name);
  });

  it('a file that throws what nobody expected is tried three times and dropped; the next is stored', async () => {
    mailWith([file('dl-boom', PDF.length, 'boom.pdf'), file('dl-2', PDF.length, 'fine.pdf')]);
    t.sqlite.exec(`
      CREATE TRIGGER boom BEFORE INSERT ON attachments WHEN NEW.filename = 'boom.pdf'
      BEGIN SELECT RAISE(ABORT, 'a fault nobody expected'); END
    `);
    const faults: unknown[] = [];
    const onFault = (cause: unknown) => faults.push(cause);

    expect(await runInboundAttachments(t.db, SECRET, deps('on', undefined, onFault), NOW)).toEqual({
      stored: 1,
      failed: 0,
      skipped: 0,
      retried: 1,
    });
    expect(
      t.db
        .select()
        .from(attachments)
        .all()
        .map((a) => a.filename),
    ).toEqual(['fine.pdf']);
    for (let i = 1; i < INBOUND_ATTACHMENT_ATTEMPTS; i += 1) {
      await runInboundAttachments(t.db, SECRET, deps('on', undefined, onFault), NOW);
    }
    expect(queue().map((q) => [q.filename, q.state, q.reason, q.attempts])).toEqual([
      ['boom.pdf', 'failed', 'store_failed', INBOUND_ATTACHMENT_ATTEMPTS],
      ['fine.pdf', 'stored', null, 0],
    ]);
    expect(brevoCalls.filter((c) => c === 'dl-boom')).toHaveLength(INBOUND_ATTACHMENT_ATTEMPTS);
    expect(faults).toHaveLength(INBOUND_ATTACHMENT_ATTEMPTS);
    expect(faults.map((f) => (f as Error).message)).toEqual(
      Array(INBOUND_ATTACHMENT_ATTEMPTS).fill('a fault nobody expected'),
    );
  });

  it('the same fault twice in a row is the board’s: the tick stops before charging the rest', async () => {
    mailWith([
      file('dl-1', PDF.length, 'boom-1.pdf'),
      file('dl-2', PDF.length, 'boom-2.pdf'),
      file('dl-3', PDF.length, 'fine.pdf'),
    ]);
    t.sqlite.exec(`
      CREATE TRIGGER boom BEFORE INSERT ON attachments WHEN NEW.filename LIKE 'boom-%'
      BEGIN SELECT RAISE(ABORT, 'the disk is full'); END
    `);
    const faults: unknown[] = [];
    expect(
      await runInboundAttachments(
        t.db,
        SECRET,
        deps('on', undefined, (cause) => faults.push(cause)),
        NOW,
      ),
    ).toEqual({ stored: 0, failed: 0, skipped: 0, retried: 2 });
    expect(faults).toHaveLength(INBOUND_UNEXPECTED_IN_A_ROW);
    expect(brevoCalls).toEqual(['dl-1', 'dl-2']);
    expect(queue().map((q) => [q.filename, q.state, q.attempts])).toEqual([
      ['boom-1.pdf', 'pending', 1],
      ['boom-2.pdf', 'pending', 1],
      ['fine.pdf', 'pending', 0],
    ]);
  });
});

describe('ticks', () => {
  it('joins a tick still running rather than fetching the same file twice', async () => {
    mailWith([file('dl-1')]);
    const [a, b] = await Promise.all([
      runInboundAttachments(t.db, SECRET, deps(), NOW),
      runInboundAttachments(t.db, SECRET, deps(), NOW),
    ]);
    expect(a).toBe(b);
    expect(brevoCalls).toEqual(['dl-1']);
  });
});
