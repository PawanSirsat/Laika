import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import {
  activity,
  attachments,
  comments,
  emailInboundAttachments,
  tasks,
  users,
} from '../../src/db/schema.ts';
import {
  INBOUND_ATTACHMENT_ATTEMPTS,
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

function deps(store: 'on' | 'off' = 'on', maxBytes?: number) {
  return {
    fetchImpl: brevoFetch,
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
    { domain: 'tasks.example.test', ...(apiKey === null ? {} : { api_key: apiKey }) },
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
    const to = getProjectEmailAddress(t.db, owner, 'laika', NOW).address!;
    receiveInboundEmail(
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
            Attachments: [file('dl-3', PDF.length, 'log.pdf')],
            Headers: { 'Authentication-Results': 'mx.b; dmarc=pass header.from=example.test' },
          },
        ],
      },
      NOW,
    );
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

  it('store_failed: the store refused three times; the half-made row is left to the sweep', async () => {
    mailWith([file('dl-1')]);
    s3.intercept = (req) =>
      req.method === 'PUT' ? new Response('no', { status: 500 }) : undefined;
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
