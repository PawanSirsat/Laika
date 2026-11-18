import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../src/errors.ts';
import type * as TasksModule from '../../../src/services/tasks.ts';
import { isLimited } from '../../../src/http/middleware/rate-limit.ts';
import { LIMITS } from '../../../src/http/rate-limit.ts';
import {
  comments,
  emailInbound,
  emailInboundAttachments,
  orgs,
  tasks,
  users,
} from '../../../src/db/schema.ts';
import { pruneEmailInbound } from '../../../src/services/email-inbound.ts';
import {
  type AuthHarness,
  authHarness,
  cookieFrom,
  jsonHeaders,
  seedInvite,
  signUp,
  TEST_ORIGIN,
} from '../../helpers/auth.ts';

/**
 * Email to tasks (§6.4, §10.3, D-155, LAI-1315), through the real app.
 *
 * The rule a reviewer presses hardest: **the webhook writes as the person the
 * From header names**. So most of this file is the mail that must *not* be
 * written — forged, looping, unauthenticated, from a stranger, to an address
 * that is not a space's — each dropped with its reason, and none of them
 * leaving the mail's text in a record, a log line or an answer.
 */

const PASSWORD = 'correct-horse-battery-staple';
const DOMAIN = 'tasks.example.test';
const SUBJECT = 'Login page answers 500 after the deploy';
const TEXT = 'Since 09:10 every sign-in fails. Steps: open /login, sign in.';
/**
 * **A fixture, not a capture**: what a receiving server named `mx.brevo.test`
 * would stamp. Brevo's real header has not been seen yet (LAI-1315 review,
 * M1) — which is why the switch needs the server named, by an owner, from a
 * real delivery, before it turns on.
 */
const RECEIVER = 'mx.brevo.test';
const REAL_AR = `${RECEIVER}; dkim=pass header.d=example.test; dmarc=pass header.from=example.test`;

/*
 * Two titles that make the write misbehave (F3): one refused for a reason no
 * check names, one a fault. Every other create is the real one.
 */
vi.mock('../../../src/services/tasks.ts', async (importOriginal) => {
  const real = await importOriginal<typeof TasksModule>();
  return {
    ...real,
    createTask: (...args: Parameters<typeof real.createTask>) => {
      if (args[4].title === 'REFUSE ME') throw new ApiError('conflict', 'An odd refusal');
      if (args[4].title === 'BREAK ME') throw new TypeError('a fault, not a decision');
      return real.createTask(...args);
    },
  };
});

let h: AuthHarness;
let cookie: string;
let ownerId: string;

beforeEach(async () => {
  h = authHarness({});
  const res = await h.app.request('/api/v1/setup', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({
      org_name: 'Kvell Dynamics',
      owner_name: 'Ada',
      owner_email: 'ada@example.test',
      owner_password: PASSWORD,
    }),
  });
  expect(res.status, await res.clone().text()).toBe(201);
  cookie = cookieFrom(res);
  ownerId = h.db.select().from(users).where(eq(users.email, 'ada@example.test')).get()!.id;
  await ok(
    await call('POST', '/projects', {
      name: 'Murphy',
      slug: 'murphy',
      prefix: 'MUR',
      visibility: 'private',
    }),
    201,
  );
  await ok(await call('POST', '/projects', { name: 'Halo', slug: 'halo', prefix: 'HAL' }), 201);
});
afterEach(() => {
  h.close();
});

function call(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = { Cookie: cookie },
): Promise<Response> {
  return Promise.resolve(
    h.app.request(`/api/v1${path}`, {
      method,
      headers: jsonHeaders(headers),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}

async function ok<T>(res: Response, status = 200): Promise<T> {
  const text = await res.text();
  expect(res.status, text).toBe(status);
  return (text === '' ? undefined : JSON.parse(text)) as T;
}

async function errorOf(res: Response): Promise<{ code: string; details: unknown }> {
  return ((await res.json()) as { error: { code: string; details: unknown } }).error;
}

async function join(email: string, orgRole: 'admin' | 'member' = 'member'): Promise<string> {
  const orgId = h.db.select().from(orgs).get()!.id;
  const token = seedInvite(h.db, { orgId, createdBy: ownerId, email, orgRole });
  const res = await signUp(h.app, { email, password: PASSWORD, inviteToken: token });
  expect(res.status, await res.clone().text()).toBe(200);
  return cookieFrom(res);
}

function userId(email: string): string {
  return h.db.select().from(users).where(eq(users.email, email)).get()!.id;
}

/** The domain, a token and the switch: what turning it on is. Returns the bearer token. */
async function switchOn(): Promise<string> {
  await ok(await call('PUT', '/org/email-inbound', { domain: DOMAIN, authserv_id: RECEIVER }));
  const { token } = await ok<{ token: string }>(
    await call('POST', '/org/email-inbound/token'),
    201,
  );
  await ok(await call('PUT', '/org/email-inbound', { enabled: true }));
  return token;
}

async function addressOf(slug: string, as = cookie): Promise<string> {
  const view = await ok<{ address: string }>(
    await call('GET', `/projects/${slug}/email-address`, undefined, { Cookie: as }),
  );
  return view.address;
}

interface Mail {
  from?: string;
  to?: string;
  subject?: string;
  text?: string;
  messageId?: string;
  inReplyTo?: string;
  headers?: Record<string, unknown>;
  spam?: number;
  attachments?: unknown[];
}

/** One Brevo inbound item. */
function brevo(mail: Mail): Record<string, unknown> {
  return {
    Uuid: ['u'],
    MessageId: mail.messageId ?? `<${String(Math.random()).slice(2)}@mail.example.test>`,
    InReplyTo: mail.inReplyTo ?? null,
    From: { Name: 'Someone', Address: mail.from ?? 'ada@example.test' },
    To: [{ Name: null, Address: mail.to }],
    Recipients: [{ Name: null, Address: mail.to }],
    Cc: [],
    Subject: mail.subject ?? SUBJECT,
    RawTextBody: mail.text ?? TEXT,
    ExtractedMarkdownMessage: mail.text ?? TEXT,
    Spam: { Score: mail.spam ?? 0.1 },
    Attachments: mail.attachments ?? [],
    Headers: { 'Authentication-Results': REAL_AR, ...mail.headers },
  };
}

function deliver(token: string, items: unknown[], raw?: string): Promise<Response> {
  return Promise.resolve(
    h.app.request('/webhooks/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: raw ?? JSON.stringify({ items }),
    }),
  );
}

async function delivered(
  token: string,
  items: unknown[],
): Promise<{ outcome: string; reason: string | null }[]> {
  const res = await deliver(token, items);
  const body = await ok<{ results: { outcome: string; reason: string | null }[] }>(res);
  // **No mail text in the answer**, whatever happened to it.
  expect(JSON.stringify(body)).not.toContain('Login page');
  return body.results;
}

function inboundRows() {
  return h.db.select().from(emailInbound).all();
}

describe('the card and the address: who may', () => {
  it('is the owner’s, signed in: never a token, never a member', async () => {
    const minted = await ok<{ secret: string }>(
      await call('POST', '/tokens', { name: 'An agent', scope: 'full' }),
      201,
    );
    const bearer = { Authorization: `Bearer ${minted.secret}` };
    for (const [method, path, body] of [
      ['GET', '/org/email-inbound', undefined],
      ['PUT', '/org/email-inbound', { domain: 'attacker.example' }],
      ['POST', '/org/email-inbound/token', undefined],
    ] as const) {
      const res = await call(method, path, body, bearer);
      expect(res.status, `${method} ${path}`).toBe(403);
      expect((await errorOf(res)).details, `${method} ${path}`).toEqual({
        action: 'org.email.configure',
        reason: 'session_required',
      });
    }
    const member = await join('bo@example.test');
    expect((await call('GET', '/org/email-inbound', undefined, { Cookie: member })).status).toBe(
      403,
    );
    expect(
      (await call('POST', '/org/email-inbound/token', undefined, { Cookie: member })).status,
    ).toBe(403);
  });

  it('ships off, with authentication required, and cannot turn on without a domain and a token', async () => {
    const view = await ok<Record<string, unknown>>(await call('GET', '/org/email-inbound'));
    expect(view).toMatchObject({
      enabled: false,
      domain: null,
      require_authenticated: true,
      token_last4: null,
      webhook_url: `${TEST_ORIGIN}/webhooks/email`,
      own_address: 'ksage@kvelld.com',
      can_store_secrets: true,
      example_domain: 'tasks.kvelld.com',
    });

    const refused = await call('PUT', '/org/email-inbound', { enabled: true });
    expect(refused.status).toBe(422);
    expect((await errorOf(refused)).details).toMatchObject({ reason: 'inbound_not_configured' });

    await ok(await call('PUT', '/org/email-inbound', { domain: DOMAIN }));
    expect((await call('PUT', '/org/email-inbound', { enabled: true })).status).toBe(422);

    const { token, settings } = await ok<{ token: string; settings: { token_last4: string } }>(
      await call('POST', '/org/email-inbound/token'),
      201,
    );
    expect(settings.token_last4).toBe(token.slice(-4));
    // Shown once: the card never has it again.
    const again = await call('GET', '/org/email-inbound');
    expect(await again.text()).not.toContain(token);

    // Authentication required, and no server named: nothing would be believed (M1).
    const unnamed = await call('PUT', '/org/email-inbound', { enabled: true });
    expect(unnamed.status).toBe(422);
    expect((await errorOf(unnamed)).details).toMatchObject({
      field: 'authserv_id',
      reason: 'authserv_required',
    });
    await ok(await call('PUT', '/org/email-inbound', { enabled: true, authserv_id: RECEIVER }));
    // Nor can the server be un-named while it is on.
    expect((await call('PUT', '/org/email-inbound', { authserv_id: null })).status).toBe(422);
    // Clearing the domain turns the switch off with it.
    const cleared = await ok<{ enabled: boolean; domain: null }>(
      await call('PUT', '/org/email-inbound', { domain: null }),
    );
    expect(cleared).toMatchObject({ enabled: false, domain: null });
  });

  it('refuses a domain, server name or key of the wrong shape, naming the field', async () => {
    for (const [body, field] of [
      [{ domain: 'not a host' }, 'domain'],
      [{ domain: 'http://tasks.example.test' }, 'domain'],
      [{ authserv_id: 'mx brevo' }, 'authserv_id'],
      [{ api_key: 'has a space' }, 'api_key'],
    ] as const) {
      const res = await call('PUT', '/org/email-inbound', body);
      expect(res.status, JSON.stringify(body)).toBe(422);
      expect((await errorOf(res)).details).toMatchObject({ field });
    }
  });

  it('keeps the Brevo key write-only: its last four, never the key', async () => {
    const key = 'xkeysib-0123456789abcdef-WXYZ';
    const view = await call('PUT', '/org/email-inbound', { api_key: key });
    const text = await view.text();
    expect(text).not.toContain(key);
    expect(JSON.parse(text)).toMatchObject({ api_key_last4: 'WXYZ' });
    const cleared = await ok<{ api_key_last4: null }>(
      await call('PUT', '/org/email-inbound', { api_key: null }),
    );
    expect(cleared.api_key_last4).toBeNull();
  });

  it('turning it on, and authentication off, are an owner’s alone — not an admin’s (M2)', async () => {
    await ok(await call('PUT', '/org/email-inbound', { domain: DOMAIN, authserv_id: RECEIVER }));
    await ok(await call('POST', '/org/email-inbound/token'), 201);
    const admin = { Cookie: await join('bo@example.test', 'admin') };
    const asAdmin = await ok<{ can_switch_on: boolean; can_allow_unauthenticated: boolean }>(
      await call('GET', '/org/email-inbound', undefined, admin),
    );
    expect(asAdmin).toMatchObject({ can_switch_on: false, can_allow_unauthenticated: false });
    for (const body of [{ enabled: true }, { require_authenticated: false }]) {
      const res = await call('PUT', '/org/email-inbound', body, admin);
      expect(res.status, JSON.stringify(body)).toBe(403);
      expect((await errorOf(res)).details).toMatchObject({ reason: 'owner_only' });
    }
    // The owner turns it on; the admin may still turn it off, and change the rest.
    await ok(await call('PUT', '/org/email-inbound', { enabled: true }));
    await ok(await call('PUT', '/org/email-inbound', { enabled: false }, admin));
    await ok(await call('PUT', '/org/email-inbound', { require_authenticated: true }, admin));
    const asOwner = await ok<{ can_switch_on: boolean; can_allow_unauthenticated: boolean }>(
      await call('PUT', '/org/email-inbound', { require_authenticated: false }),
    );
    expect(asOwner).toMatchObject({ can_switch_on: true, can_allow_unauthenticated: true });
  });

  it('says on everyone’s OrgView whether it is on, and the domain', async () => {
    await switchOn();
    const member = await join('bo@example.test');
    const org = await ok<{ email_inbound: unknown }>(
      await call('GET', '/org', undefined, { Cookie: member }),
    );
    expect(org.email_inbound).toEqual({ enabled: true, domain: DOMAIN });
  });

  it('shows a space’s address to whoever may create a task there; only a lead may replace it', async () => {
    await switchOn();
    const address = await addressOf('murphy');
    expect(address).toMatch(/^murphy-[a-z2-7]{12}@tasks\.example\.test$/);
    // The same address on every read: made once.
    expect(await addressOf('murphy')).toBe(address);

    const bo = await join('bo@example.test');
    // Not in the private space: it is not there for them.
    expect(
      (await call('GET', '/projects/murphy/email-address', undefined, { Cookie: bo })).status,
    ).toBe(404);
    await ok(
      await call('POST', '/projects/murphy/members', {
        user_id: userId('bo@example.test'),
        role: 'viewer',
      }),
      201,
    );
    expect(
      (await call('GET', '/projects/murphy/email-address', undefined, { Cookie: bo })).status,
    ).toBe(403);
    await ok(
      await call('PATCH', `/projects/murphy/members/${userId('bo@example.test')}`, {
        role: 'member',
      }),
    );
    const asMember = await ok<{ address: string; can_rotate: boolean }>(
      await call('GET', '/projects/murphy/email-address', undefined, { Cookie: bo }),
    );
    expect(asMember).toEqual({ address, enabled: true, can_rotate: false });
    expect(
      (await call('POST', '/projects/murphy/email-address/rotate', undefined, { Cookie: bo }))
        .status,
    ).toBe(403);

    const rotated = await ok<{ address: string; can_rotate: boolean }>(
      await call('POST', '/projects/murphy/email-address/rotate'),
    );
    expect(rotated.can_rotate).toBe(true);
    expect(rotated.address).not.toBe(address);
  });
});

describe('POST /webhooks/email: the bearer token', () => {
  it('refuses every delivery until a token exists', async () => {
    const res = await deliver('anything', []);
    expect(res.status).toBe(401);
  });

  it('refuses a wrong token of any length — and parses nothing before it holds', async () => {
    const token = await switchOn();
    for (const wrong of ['', 'x', `${token}x`, token.slice(0, -1), 'A'.repeat(500)]) {
      const res = await deliver(wrong, [], '{not json');
      expect(res.status, `length ${String(wrong.length)}`).toBe(401);
    }
    const noHeader = await h.app.request('/webhooks/email', { method: 'POST', body: '{}' });
    expect(noHeader.status).toBe(401);
    expect(h.log.find('webhook.received')).toMatchObject({ source: 'email', verified: false });

    // The right token: now the body is read, and a bad one is the caller's fault.
    expect((await deliver(token, [], '{not json')).status).toBe(422);
    expect((await deliver(token, [], '{"mails":[]}')).status).toBe(422);
    expect((await deliver(token, [])).status).toBe(200);
  });

  it('stops taking the old token the moment a new one is made', async () => {
    const old = await switchOn();
    await ok(await call('POST', '/org/email-inbound/token'), 201);
    expect((await deliver(old, [])).status).toBe(401);
  });
});

describe('a mail from a member becomes a task, written as them', () => {
  it('makes the task — the subject its title, the text its description, via webhook', async () => {
    const token = await switchOn();
    const to = await addressOf('murphy');
    const results = await delivered(token, [brevo({ to, messageId: '<first@mail.example.test>' })]);
    expect(results).toEqual([{ outcome: 'task_created', reason: null }]);

    const task = h.db.select().from(tasks).get()!;
    expect(task).toMatchObject({
      title: SUBJECT,
      descriptionMd: TEXT,
      createdBy: ownerId,
      createdVia: 'webhook',
    });
    const [row] = inboundRows();
    expect(row).toMatchObject({
      outcome: 'task_created',
      reason: null,
      fromAddress: 'ada@example.test',
      userId: ownerId,
      taskId: task.id,
      messageId: 'first@mail.example.test',
      auth: 'mx.brevo.test dkim=pass dmarc=pass',
    });
    // **The record never holds the mail's text.**
    expect(JSON.stringify(row)).not.toContain('Login page');
    expect(JSON.stringify(row)).not.toContain('sign-in fails');
    for (const record of h.log.records) {
      expect(JSON.stringify(record)).not.toContain('Login page');
    }
  });

  it('makes one task for a mail delivered twice', async () => {
    const token = await switchOn();
    const to = await addressOf('murphy');
    const mail = brevo({ to, messageId: '<twice@mail.example.test>' });
    await delivered(token, [mail]);
    expect(await delivered(token, [mail])).toEqual([{ outcome: 'duplicate', reason: null }]);
    expect(h.db.select().from(tasks).all()).toHaveLength(1);
    expect(inboundRows()).toHaveLength(1);
  });

  it('makes a task in each space the envelope delivered it to', async () => {
    const token = await switchOn();
    const murphy = await addressOf('murphy');
    const halo = await addressOf('halo');
    const results = await delivered(token, [
      { ...brevo({ to: murphy }), Recipients: [{ Address: murphy }, { Address: halo }] },
    ]);
    expect(results.map((r) => r.outcome)).toEqual(['task_created', 'task_created']);
    expect(
      new Set(
        h.db
          .select()
          .from(tasks)
          .all()
          .map((t) => t.projectId),
      ).size,
    ).toBe(2);
  });

  it('takes a reply in the thread, or one naming the task’s key, as a comment by its sender', async () => {
    const token = await switchOn();
    const to = await addressOf('murphy');
    await delivered(token, [brevo({ to, messageId: '<root@mail.example.test>' })]);
    const task = h.db.select().from(tasks).get()!;

    const bo = await join('bo@example.test');
    void bo;
    await ok(
      await call('POST', '/projects/murphy/members', {
        user_id: userId('bo@example.test'),
        role: 'member',
      }),
      201,
    );
    const reply = await delivered(token, [
      brevo({
        to,
        from: 'bo@example.test',
        subject: `Re: ${SUBJECT}`,
        text: 'Rolled back; fixed.',
        inReplyTo: '<root@mail.example.test>',
      }),
    ]);
    expect(reply).toEqual([{ outcome: 'comment_added', reason: null }]);
    const comment = h.db.select().from(comments).get()!;
    expect(comment).toMatchObject({
      taskId: task.id,
      authorId: userId('bo@example.test'),
      bodyMd: 'Rolled back; fixed.',
      createdVia: 'webhook',
    });
    expect(h.db.select().from(tasks).all()).toHaveLength(1);

    // A reply to that reply threads too: its record carries the task.
    const lastId = inboundRows().find((r) => r.outcome === 'comment_added')!.messageId;
    expect(
      await delivered(token, [brevo({ to, text: 'And verified.', inReplyTo: `<${lastId}>` })]),
    ).toEqual([{ outcome: 'comment_added', reason: null }]);

    // No thread, but the key in brackets.
    expect(
      await delivered(token, [
        brevo({ to, subject: 'Re: [MUR-1] the login', text: 'Same again.' }),
      ]),
    ).toEqual([{ outcome: 'comment_added', reason: null }]);
    expect(h.db.select().from(comments).all()).toHaveLength(3);
  });

  it('never comments across spaces: another space’s key, or thread, makes a new task here', async () => {
    const token = await switchOn();
    await delivered(token, [brevo({ to: await addressOf('halo'), messageId: '<h@x.test>' })]);
    const halo = await addressOf('murphy');
    const results = await delivered(token, [
      brevo({ to: halo, subject: 'Re: [HAL-1] x', inReplyTo: '<h@x.test>' }),
    ]);
    expect(results).toEqual([{ outcome: 'task_created', reason: null }]);
    expect(h.db.select().from(comments).all()).toHaveLength(0);
  });

  it('queues each announced attachment for the store, and none for a dropped mail', async () => {
    const token = await switchOn();
    const to = await addressOf('murphy');
    const file = {
      Name: 'trace.txt',
      ContentType: 'text/plain',
      ContentLength: 120,
      DownloadToken: 'dl-1',
    };
    await delivered(token, [
      brevo({ to, attachments: [file, { ...file, DownloadToken: 'dl-2' }] }),
    ]);
    await delivered(token, [brevo({ to, from: 'stranger@example.test', attachments: [file] })]);
    const queued = h.db.select().from(emailInboundAttachments).all();
    expect(queued.map((q) => [q.downloadToken, q.state])).toEqual([
      ['dl-1', 'pending'],
      ['dl-2', 'pending'],
    ]);
    expect(inboundRows().map((r) => r.attachmentCount)).toEqual([2, 1]);
  });
});

describe('dropped, never written, never answered: one reason each', () => {
  async function dropped(mail: Mail, expected: string, setup?: () => Promise<void>): Promise<void> {
    const token = await switchOn();
    await setup?.();
    const to = mail.to ?? (await addressOf('murphy'));
    const results = await delivered(token, [brevo({ ...mail, to })]);
    expect(results).toEqual([{ outcome: 'dropped', reason: expected }]);
    expect(h.db.select().from(tasks).all(), expected).toHaveLength(0);
    expect(h.db.select().from(comments).all(), expected).toHaveLength(0);
  }

  it('switch_off: off is off, and the record still says what the server saw', async () => {
    const token = await switchOn();
    const to = await addressOf('murphy');
    await ok(await call('PUT', '/org/email-inbound', { enabled: false }));
    expect(await delivered(token, [brevo({ to })])).toEqual([
      { outcome: 'dropped', reason: 'switch_off' },
    ]);
    expect(inboundRows()[0]?.auth).toBe('mx.brevo.test dkim=pass dmarc=pass');
    expect(h.db.select().from(tasks).all()).toHaveLength(0);
  });

  it('unknown_address: a token no space has', async () => {
    await dropped({ to: `murphy-abcdefghijkl@${DOMAIN}` }, 'unknown_address');
  });

  it('unknown_address: an address replaced by New address stops at once', async () => {
    const token = await switchOn();
    const old = await addressOf('murphy');
    await ok(await call('POST', '/projects/murphy/email-address/rotate'));
    expect(await delivered(token, [brevo({ to: old })])).toEqual([
      { outcome: 'dropped', reason: 'unknown_address' },
    ]);
  });

  it('own_sender: the board’s own From, or anything at its inbound domain — no loop', async () => {
    await dropped(
      {
        from: 'ksage@kvelld.com',
        headers: { 'Authentication-Results': 'mx.brevo.test; dmarc=pass header.from=kvelld.com' },
      },
      'own_sender',
    );
  });

  it('own_sender: a mail from the inbound domain itself', async () => {
    await dropped({ from: `murphy-x@${DOMAIN}` }, 'own_sender');
  });

  it('auto_reply: an out-of-office, a bounce, list mail', async () => {
    await dropped({ headers: { 'Auto-Submitted': 'auto-replied' } }, 'auto_reply');
  });

  it('spam: Brevo scored it at five or more', async () => {
    await dropped({ spam: 7.5 }, 'spam');
  });

  it('unauthenticated: a forged From — the receiving server vouched for another domain', async () => {
    await dropped(
      {
        from: 'ada@example.test',
        headers: {
          'Authentication-Results': 'mx.brevo.test; dmarc=pass header.from=attacker.test',
        },
      },
      'unauthenticated',
    );
  });

  it('unauthenticated: a forged Authentication-Results below the server’s own', async () => {
    await dropped(
      {
        headers: {
          'Authentication-Results': [
            'mx.brevo.test; dmarc=fail header.from=example.test',
            'mx.brevo.test; dmarc=pass header.from=example.test',
          ],
        },
      },
      'unauthenticated',
    );
  });

  it('unauthenticated: a forged header above the server’s own, naming another server', async () => {
    await dropped(
      {
        headers: {
          'Authentication-Results': [
            'mx.attacker.test; dmarc=pass header.from=example.test',
            `${RECEIVER}; dmarc=fail header.from=example.test`,
          ],
        },
      },
      'unauthenticated',
    );
  });

  it('unauthenticated: two keys for the header, whose order is lost — fails closed', async () => {
    await dropped(
      { headers: { 'Authentication-Results': REAL_AR, 'authentication-results': REAL_AR } },
      'unauthenticated',
    );
  });

  it('unauthenticated: no verdict at all', async () => {
    await dropped({ headers: { 'Authentication-Results': [] } }, 'unauthenticated');
  });

  it('unauthenticated: another server’s pass counts for nothing', async () => {
    await dropped(
      {
        headers: {
          'Authentication-Results': 'mx.attacker.test; dmarc=pass header.from=example.test',
        },
      },
      'unauthenticated',
    );
  });

  it('unknown_sender: nobody here has the address', async () => {
    await dropped({ from: 'stranger@example.test' }, 'unknown_sender');
  });

  it('not_allowed: a person the space’s own rules refuse', async () => {
    await dropped({ from: 'bo@example.test' }, 'not_allowed', async () => {
      await join('bo@example.test');
    });
  });

  it('empty: no subject and no text', async () => {
    await dropped({ subject: '', text: '' }, 'empty');
  });

  it('writes the unauthenticated mail once an owner turns the requirement off — their choice', async () => {
    const token = await switchOn();
    const to = await addressOf('murphy');
    await ok(await call('PUT', '/org/email-inbound', { require_authenticated: false }));
    expect(
      await delivered(token, [brevo({ to, headers: { 'Authentication-Results': [] } })]),
    ).toEqual([{ outcome: 'task_created', reason: null }]);
  });

  it('lists the newest on the card, never with the subject', async () => {
    const token = await switchOn();
    const to = await addressOf('murphy');
    await delivered(token, [brevo({ to }), brevo({ to, from: 'stranger@example.test' })]);
    const res = await call('GET', '/org/email-inbound');
    const text = await res.text();
    expect(text).not.toContain('Login page');
    const view = JSON.parse(text) as {
      recent: Record<string, unknown>[];
      authserv_seen: string[];
    };
    // The servers recent mail named: what an owner names the believed one from (M1).
    expect(view.authserv_seen).toEqual([RECEIVER]);
    expect(view.recent[0]).toMatchObject({ authserv_ids: [RECEIVER] });
    expect(view.recent.map((r) => [r.outcome, r.reason, r.task_key])).toEqual(
      expect.arrayContaining([
        ['task_created', null, 'MUR-1'],
        ['dropped', 'unknown_sender', null],
      ]),
    );
  });
});

describe('Brevo’s shapes, and one mail’s fault (F1, F3)', () => {
  it('reads plain-address recipients and a top-level SpamScore, and finds a Bcc’d space on the envelope', async () => {
    const token = await switchOn();
    const to = await addressOf('murphy');
    const bcc = {
      ...brevo({ to: 'someone@elsewhere.test' }),
      Recipients: [to],
      Spam: undefined,
      SpamScore: 0.2,
    };
    expect(await delivered(token, [bcc])).toEqual([{ outcome: 'task_created', reason: null }]);
    const spam = { ...brevo({ to }), Spam: undefined, SpamScore: 9 };
    expect(await delivered(token, [spam])).toEqual([{ outcome: 'dropped', reason: 'spam' }]);
  });

  it('one mail’s fault stops none after it; 503 asks Brevo again, and the redelivery lands it once', async () => {
    const token = await switchOn();
    const to = await addressOf('murphy');
    const items = [
      brevo({ to, messageId: '<one@x.test>' }),
      brevo({ to, messageId: '<two@x.test>', subject: 'BREAK ME' }),
      brevo({ to, messageId: '<three@x.test>', subject: 'After the fault' }),
    ];
    const first = await deliver(token, items);
    expect(first.status).toBe(503);
    expect(((await first.json()) as { results: unknown[] }).results).toEqual([
      { outcome: 'task_created', reason: null },
      { outcome: 'failed', reason: null },
      { outcome: 'task_created', reason: null },
    ]);
    expect(h.log.find('email.inbound_failed')).toMatchObject({
      level: 'error',
      error: 'TypeError',
    });
    // Nothing of the failed mail was recorded, so the retry finds it new.
    expect(
      inboundRows()
        .map((r) => r.messageId)
        .sort(),
    ).toEqual(['one@x.test', 'three@x.test']);
    const again = await deliver(token, items);
    expect(again.status).toBe(503);
    expect(((await again.json()) as { results: unknown[] }).results).toEqual([
      { outcome: 'duplicate', reason: null },
      { outcome: 'failed', reason: null },
      { outcome: 'duplicate', reason: null },
    ]);
    expect(h.db.select().from(tasks).all()).toHaveLength(2);
  });

  it('a refusal no check named is recorded `refused` and logged at warn', async () => {
    const token = await switchOn();
    const to = await addressOf('murphy');
    expect(await delivered(token, [brevo({ to, subject: 'REFUSE ME' })])).toEqual([
      { outcome: 'dropped', reason: 'refused' },
    ]);
    expect(
      h.log.records.find((r) => r.event === 'email.inbound' && r.reason === 'refused'),
    ).toMatchObject({ level: 'warn' });
  });
});

describe('limits and retention', () => {
  it('counts itself after the token: junk fills its own bucket, never Brevo’s (F2)', async () => {
    const token = await switchOn();
    // The middleware leaves the path alone; the route decides, once it knows.
    expect(isLimited('/webhooks/email')).toBe(false);
    for (let i = 0; i < LIMITS.inboundEmailRefused.burst; i += 1) {
      expect((await deliver(`junk-${String(i)}`, [])).status).toBe(401);
    }
    expect((await deliver('junk-again', [])).status).toBe(429);
    // Brevo, with the token, is still let in.
    expect((await deliver(token, [])).status).toBe(200);
  });

  it('takes a delivery up to 4 MiB on this route, and only this one', async () => {
    const token = await switchOn();
    const to = await addressOf('murphy');
    const big = brevo({ to, text: 'x'.repeat(40_000) });
    const padded = { ...big, RawHtmlBody: 'y'.repeat(2 * 1024 * 1024) };
    expect((await deliver(token, [padded])).status).toBe(200);
    const huge = { ...big, RawHtmlBody: 'y'.repeat(5 * 1024 * 1024) };
    expect((await deliver(token, [huge])).status).toBe(413);
    // Another route keeps the 1 MiB every route has (F6).
    const elsewhere = await call('PUT', '/org/email-inbound', {
      domain: DOMAIN,
      api_key: 'k'.repeat(2 * 1024 * 1024),
    });
    expect(elsewhere.status).toBe(413);
  });

  it('prunes records 90 days old', async () => {
    const token = await switchOn();
    await delivered(token, [brevo({ to: await addressOf('murphy') })]);
    const at = inboundRows()[0]!.receivedAt;
    expect(pruneEmailInbound(h.db, at + 89 * 86_400_000)).toBe(0);
    expect(pruneEmailInbound(h.db, at + 91 * 86_400_000)).toBe(1);
    expect(inboundRows()).toHaveLength(0);
  });
});
