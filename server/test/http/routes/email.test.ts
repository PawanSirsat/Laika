import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { classify, EMAIL_TEST_PATH } from '../../../src/http/middleware/rate-limit.ts';
import { LIMITS } from '../../../src/http/rate-limit.ts';
import { emailOutbox, orgs, users } from '../../../src/db/schema.ts';
import { runEmailOutbox } from '../../../src/services/email-outbox.ts';
import {
  type AuthHarness,
  authHarness,
  cookieFrom,
  jsonHeaders,
  seedInvite,
  signUp,
  TEST_ORIGIN,
  TEST_SECRET,
} from '../../helpers/auth.ts';
import { FAKE_SMTP_KEY, fakeMail, type FakeMail, SMTP_SETTINGS } from '../../helpers/fake-mail.ts';

/**
 * The Email card over HTTP (§6.4, D-153, LAI-1312), and the mail invites and
 * reset links queue. The app is handed a recorder as its transport, so **no
 * test here needs a real key or reaches a mail server**.
 */

const PASSWORD = 'correct-horse-battery-staple';

let h: AuthHarness;
let mail: FakeMail;
let cookie: string;
let ownerId: string;

interface ErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> | null };
}

beforeEach(async () => {
  mail = fakeMail();
  h = authHarness({ emailTransport: mail.transport });
  const res = await h.app.request('/api/v1/setup', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({
      org_name: 'Kvell Dynamics',
      owner_name: 'Pawan',
      owner_email: 'pawan@example.test',
      owner_password: PASSWORD,
    }),
  });
  expect(res.status, await res.clone().text()).toBe(201);
  cookie = cookieFrom(res);
  ownerId = h.db.select().from(users).where(eq(users.email, 'pawan@example.test')).get()!.id;
});
afterEach(() => {
  h.close();
});

async function join(email: string, orgRole: 'admin' | 'member' | 'viewer'): Promise<string> {
  const orgId = h.db.select().from(orgs).get()!.id;
  const token = seedInvite(h.db, { orgId, createdBy: ownerId, email, orgRole });
  const res = await signUp(h.app, { email, password: PASSWORD, inviteToken: token });
  expect(res.status, await res.clone().text()).toBe(200);
  return cookieFrom(res);
}

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
  // **The key never leaves the server**, in any answer this file sees.
  expect(text).not.toContain(FAKE_SMTP_KEY);
  return (text === '' ? undefined : JSON.parse(text)) as T;
}

async function errorOf(res: Response): Promise<ErrorBody['error']> {
  return ((await res.json()) as ErrorBody).error;
}

async function configure(): Promise<void> {
  await ok(await call('PUT', '/org/email', SMTP_SETTINGS));
}

async function switchOn(): Promise<void> {
  await configure();
  await ok(await call('PATCH', '/org', { email_enabled: true }));
}

function drain() {
  return runEmailOutbox(h.db, TEST_SECRET, { transport: mail.transport });
}

describe('the card', () => {
  it('reads as off and not configured, with the defaults to pre-fill', async () => {
    const view = await ok<Record<string, unknown>>(await call('GET', '/org/email'));
    expect(view).toMatchObject({
      enabled: false,
      configured: false,
      host: null,
      public_url: TEST_ORIGIN,
      defaults: {
        host: 'smtp-relay.brevo.com',
        port: 587,
        from_address: 'ksage@kvelld.com',
        from_name: 'Ksage',
      },
    });
  });

  it('saves the settings, shows the key’s last four only, and GET /org says configured', async () => {
    const saved = await ok<Record<string, unknown>>(await call('PUT', '/org/email', SMTP_SETTINGS));
    expect(saved).toMatchObject({ configured: true, enabled: false, key_last4: 'KEY9' });

    const org = await ok<{ email: unknown }>(await call('GET', '/org'));
    expect(org.email).toEqual({ enabled: false, configured: true });
  });

  it('refuses an unknown field and a port out of range at the boundary', async () => {
    let res = await call('PUT', '/org/email', { ...SMTP_SETTINGS, tls: false });
    expect(res.status).toBe(422);
    res = await call('PUT', '/org/email', { ...SMTP_SETTINGS, port: 0 });
    expect(res.status).toBe(422);
  });

  it('clears, and the switch goes off with it', async () => {
    await switchOn();
    expect((await call('DELETE', '/org/email')).status).toBe(204);
    const view = await ok<Record<string, unknown>>(await call('GET', '/org/email'));
    expect(view).toMatchObject({ enabled: false, configured: false, key_last4: null });
  });

  it('is refused to a member, every verb', async () => {
    const member = await join('ada@example.test', 'member');
    for (const [method, path, body] of [
      ['GET', '/org/email', undefined],
      ['PUT', '/org/email', SMTP_SETTINGS],
      ['DELETE', '/org/email', undefined],
      ['POST', '/org/email/test', undefined],
    ] as const) {
      const res = await call(method, path, body, { Cookie: member });
      expect(res.status, `${method} ${path}`).toBe(403);
      expect((await errorOf(res)).code).toBe('forbidden');
    }
    expect(mail.sent).toHaveLength(0);
  });
});

describe('the switch', () => {
  it('cannot turn on before the key is saved: 422 email_not_configured', async () => {
    const res = await call('PATCH', '/org', { email_enabled: true });
    expect(res.status).toBe(422);
    expect((await errorOf(res)).details).toMatchObject({ reason: 'email_not_configured' });
  });

  it('turns on once configured, and every reader of /org sees it', async () => {
    await switchOn();
    const member = await join('ada@example.test', 'member');
    const org = await ok<{ email: unknown }>(
      await call('GET', '/org', undefined, { Cookie: member }),
    );
    expect(org.email).toEqual({ enabled: true, configured: true });
  });
});

describe('Send test email', () => {
  it('sends to the admin who pressed it while the switch is off', async () => {
    await configure();
    const result = await ok<Record<string, unknown>>(await call('POST', '/org/email/test'));
    expect(result).toMatchObject({ ok: true, to: 'pawan@example.test', code: null });
    expect(mail.sent.map((s) => s.message.to)).toEqual(['pawan@example.test']);
  });

  it('answers 200 with the SMTP code when the server refuses', async () => {
    await configure();
    mail.script.push({
      kind: 'refused',
      permanent: true,
      code: '535',
      detail: 'Authentication failed',
    });
    const result = await ok<Record<string, unknown>>(await call('POST', '/org/email/test'));
    expect(result).toMatchObject({ ok: false, code: '535', message: 'Authentication failed' });

    const view = await ok<{ last_test: unknown }>(await call('GET', '/org/email'));
    expect(view.last_test).toMatchObject({ ok: false, code: '535' });
  });

  it('is 422 with nothing configured, and sends nothing', async () => {
    const res = await call('POST', '/org/email/test');
    expect(res.status).toBe(422);
    expect((await errorOf(res)).details).toMatchObject({ reason: 'email_not_configured' });
    expect(mail.sent).toHaveLength(0);
  });

  it('spends a small bucket of its own, never the session’s', async () => {
    expect(classify(EMAIL_TEST_PATH, { userId: 'u1', tokenId: null }, 'POST')).toEqual({
      key: 'email-test:u1',
      policy: LIMITS.hr,
    });
    await configure();
    const answers: number[] = [];
    for (let i = 0; i <= LIMITS.hr.perMinute; i += 1) {
      answers.push((await call('POST', '/org/email/test')).status);
    }
    expect(answers.slice(0, LIMITS.hr.perMinute).every((s) => s === 200)).toBe(true);
    expect(answers.at(-1)).toBe(429);
    expect(mail.sent).toHaveLength(LIMITS.hr.perMinute);
  });
});

interface CreatedInvite {
  invite: { id: string; email: string | null; email_sent: boolean };
  accept_url: string;
  email: { queued: boolean; reason: string | null };
}

describe('invites', () => {
  it('say email_off while the switch is off, and the copy link is unchanged', async () => {
    await configure();
    const created = await ok<CreatedInvite>(
      await call('POST', '/invites', { email: 'ada@example.test', org_role: 'member' }),
      201,
    );
    expect(created.email).toEqual({ queued: false, reason: 'email_off' });
    expect(created.accept_url).toMatch(new RegExp(`^${TEST_ORIGIN}/invite\\?token=`));
    await drain();
    expect(mail.sent).toHaveLength(0);
  });

  it('queue the link when it is on, and the list says sent once it went', async () => {
    await switchOn();
    const created = await ok<CreatedInvite>(
      await call('POST', '/invites', { email: 'ada@example.test', org_role: 'member' }),
      201,
    );
    expect(created.email).toEqual({ queued: true, reason: null });
    expect(created.invite.email_sent).toBe(false);

    await drain();
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]?.message.to).toBe('ada@example.test');
    expect(mail.sent[0]?.message.text).toContain(created.accept_url);

    const list = await ok<{ data: { id: string; email_sent: boolean }[] }>(
      await call('GET', '/invites'),
    );
    expect(list.data.find((i) => i.id === created.invite.id)?.email_sent).toBe(true);
  });

  it('a link invite has nobody to mail: no_address', async () => {
    await switchOn();
    const created = await ok<CreatedInvite>(
      await call('POST', '/invites', { email: null, org_role: 'member' }),
      201,
    );
    expect(created.email).toEqual({ queued: false, reason: 'no_address' });
  });

  it('a re-issue mails the new link under the new invite', async () => {
    await switchOn();
    const first = await ok<CreatedInvite>(
      await call('POST', '/invites', { email: 'ada@example.test', org_role: 'member' }),
      201,
    );
    const again = await ok<CreatedInvite>(
      await call('POST', `/invites/${first.invite.id}/reissue`),
      201,
    );
    expect(again.email).toEqual({ queued: true, reason: null });
    await drain();
    expect(mail.sent.map((s) => s.message.idempotencyKey).sort()).toEqual(
      [`invite:${first.invite.id}`, `invite:${again.invite.id}`].sort(),
    );
    expect(mail.sent.some((s) => s.message.text.includes(again.accept_url))).toBe(true);
  });
});

describe('reset links', () => {
  it('say email_off while the switch is off', async () => {
    await join('ada@example.test', 'member');
    const ada = h.db.select().from(users).where(eq(users.email, 'ada@example.test')).get()!;
    const link = await ok<{ url: string; email: unknown }>(
      await call('POST', `/users/${ada.id}/reset-link`),
      201,
    );
    expect(link.email).toEqual({ queued: false, reason: 'email_off' });
    expect(link.url).toMatch(new RegExp(`^${TEST_ORIGIN}/reset-password\\?token=`));
  });

  it('queue the link to the person when it is on', async () => {
    await switchOn();
    await join('ada@example.test', 'member');
    const ada = h.db.select().from(users).where(eq(users.email, 'ada@example.test')).get()!;
    const link = await ok<{ url: string; email: unknown }>(
      await call('POST', `/users/${ada.id}/reset-link`),
      201,
    );
    expect(link.email).toEqual({ queued: true, reason: null });
    await drain();
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]?.message).toMatchObject({
      to: 'ada@example.test',
      subject: 'Set a new password for Ksage',
    });
    expect(mail.sent[0]?.message.text).toContain(link.url);
    expect(h.db.select().from(emailOutbox).get()).toMatchObject({
      kind: 'password_reset',
      state: 'sent',
      bodyEnc: null,
      recipientUserId: ada.id,
      createdBy: ownerId,
    });
  });
});
