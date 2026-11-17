import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { type OrgRole } from '../../src/db/enums.ts';
import { newId } from '../../src/db/ids.ts';
import { emailOutbox, orgs, users } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import { decryptSecret } from '../../src/secrets.ts';
import {
  clearEmailSettings,
  EMAIL_DEFAULTS,
  EmailKeyUnreadableError,
  getEmailSettings,
  readSmtpConfig,
  sendTestEmail,
  setEmailSettings,
  type SetEmailSettingsInput,
} from '../../src/services/email-settings.ts';
import { getOrg, updateOrg } from '../../src/services/orgs.ts';
import { FAKE_SMTP_KEY, fakeMail, SMTP_SETTINGS } from '../helpers/fake-mail.ts';
import { freshDb, type TestDb } from '../helpers/db.ts';

/**
 * The Email card, the switch and *Send test email* (§6.4, D-153, LAI-1312).
 * Every send here goes to a recorder: no test needs a real key.
 */

const SECRET = 'a-laika-secret-that-is-at-least-32-characters-long';
const OTHER_SECRET = 'a-different-secret-that-is-also-32-characters-long';
const NOW = 1_800_000_000_000;

let t: TestDb;
let ownerId: string;

function makeUser(orgRole: OrgRole, name: string = orgRole): string {
  const id = newId();
  t.db
    .insert(users)
    .values({
      id,
      email: `${name}@example.test`,
      name,
      orgRole,
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    })
    .run();
  return id;
}

function actor(userId: string): ResolvedActor {
  const loaded = loadActor(t.db, userId);
  if (loaded === null) throw new Error('no such user');
  return loaded;
}

function orgRow() {
  return t.db.select().from(orgs).get()!;
}

beforeEach(() => {
  t = freshDb();
  ownerId = makeUser('owner', 'pawan');
  t.db
    .insert(orgs)
    .values({
      id: newId(),
      name: 'Kvell Dynamics',
      ownerUserId: ownerId,
      createdAt: 1,
      updatedAt: 1,
    })
    .run();
});
afterEach(() => {
  t.close();
});

function refusal(fn: () => unknown): ApiError {
  try {
    fn();
  } catch (err) {
    if (err instanceof ApiError) return err;
    throw err;
  }
  throw new Error('expected a refusal');
}

describe('who may', () => {
  it('lets the owner and an admin read and save the card', () => {
    for (const id of [ownerId, makeUser('admin')]) {
      expect(getEmailSettings(t.db, actor(id)).configured).toBe(false);
    }
  });

  it('refuses a member and a viewer: it is §3.1’s Org settings row', () => {
    for (const role of ['member', 'viewer'] as const) {
      const who = actor(makeUser(role));
      expect(refusal(() => getEmailSettings(t.db, who)).code, role).toBe('forbidden');
      expect(refusal(() => setEmailSettings(t.db, who, SMTP_SETTINGS, SECRET)).code).toBe(
        'forbidden',
      );
      expect(refusal(() => clearEmailSettings(t.db, who)).code).toBe('forbidden');
    }
  });
});

describe('before anything is saved', () => {
  it('is off, not configured, and offers Brevo and Kvell’s sender as defaults', () => {
    const view = getEmailSettings(t.db, actor(ownerId), 'https://ksage.kvelld.com/');
    expect(view).toMatchObject({
      enabled: false,
      configured: false,
      host: null,
      key_last4: null,
      public_url: 'https://ksage.kvelld.com',
      last_test: null,
      defaults: EMAIL_DEFAULTS,
    });
    expect(EMAIL_DEFAULTS).toEqual({
      host: 'smtp-relay.brevo.com',
      port: 587,
      from_address: 'ksage@kvelld.com',
      from_name: 'Ksage',
    });
    expect(orgRow().emailEnabled).toBe(0);
  });

  it('says so on OrgView, to everyone', () => {
    const member = actor(makeUser('member'));
    expect(getOrg(t.db, member).email).toEqual({ enabled: false, configured: false });
  });
});

describe('saving the settings', () => {
  it('stores the key as ciphertext and shows only its last four characters', () => {
    const view = setEmailSettings(t.db, actor(ownerId), SMTP_SETTINGS, SECRET, '', NOW);

    expect(view).toMatchObject({
      configured: true,
      host: 'smtp-relay.brevo.com',
      port: 587,
      username: SMTP_SETTINGS.username,
      from_address: 'ksage@kvelld.com',
      from_name: 'Ksage',
      key_last4: 'KEY9',
    });
    expect(JSON.stringify(view)).not.toContain(FAKE_SMTP_KEY);

    const row = orgRow();
    expect(row.smtpJsonEnc).toMatch(/^v1\./);
    expect(row.smtpJsonEnc).not.toContain(FAKE_SMTP_KEY);
    expect(row.smtpSettings).not.toContain(FAKE_SMTP_KEY);
    expect(JSON.parse(decryptSecret(row.smtpJsonEnc!, SECRET, 'smtp_json'))).toEqual({
      password: FAKE_SMTP_KEY,
    });
  });

  it('keeps the stored key when a save leaves it out', () => {
    setEmailSettings(t.db, actor(ownerId), SMTP_SETTINGS, SECRET);
    const { password: _drop, ...rest } = SMTP_SETTINGS;
    const view = setEmailSettings(t.db, actor(ownerId), { ...rest, from_name: 'Kvell' }, SECRET);
    expect(view).toMatchObject({ configured: true, key_last4: 'KEY9', from_name: 'Kvell' });
    expect(readSmtpConfig(t.db, SECRET)?.password).toBe(FAKE_SMTP_KEY);
  });

  it('refuses a new host, port or login without the key: the stored key goes only where it was given', () => {
    setEmailSettings(t.db, actor(ownerId), SMTP_SETTINGS, SECRET);
    const { password: _drop, ...rest } = SMTP_SETTINGS;
    for (const change of [{ host: 'smtp.attacker.example' }, { port: 25 }, { username: 'x' }]) {
      const err = refusal(() =>
        setEmailSettings(t.db, actor(ownerId), { ...rest, ...change }, SECRET),
      );
      expect(err.code, JSON.stringify(change)).toBe('unprocessable');
      expect(err.details).toEqual({ field: 'password', reason: 'key_required' });
    }
    expect(readSmtpConfig(t.db, SECRET)?.host).toBe('smtp-relay.brevo.com');
  });

  it('refuses a token, signed in only — even the owner’s', () => {
    const owner = actor(ownerId);
    const viaToken: ResolvedActor = {
      ...owner,
      token: { id: 'tok_full', scope: 'full', projectIds: null },
    };
    for (const call of [
      () => getEmailSettings(t.db, viaToken),
      () => setEmailSettings(t.db, viaToken, SMTP_SETTINGS, SECRET),
      () => clearEmailSettings(t.db, viaToken),
      () => updateOrg(t.db, viaToken, { email_enabled: false }, SECRET),
    ]) {
      expect(refusal(call).details).toEqual({
        action: 'org.email.configure',
        reason: 'session_required',
      });
    }
  });

  it('saves without a key, and is then not configured', () => {
    const { password: _drop, ...rest } = SMTP_SETTINGS;
    const view = setEmailSettings(t.db, actor(ownerId), rest, SECRET);
    expect(view).toMatchObject({
      configured: false,
      host: 'smtp-relay.brevo.com',
      key_last4: null,
    });
    expect(readSmtpConfig(t.db, SECRET)).toBeNull();
  });

  it('refuses what would not work, naming the field', () => {
    const owner = actor(ownerId);
    const cases: [Partial<SetEmailSettingsInput>, string][] = [
      [{ host: 'smtp relay' }, 'host'],
      [{ host: '-x.example' }, 'host'],
      [{ port: 70000 }, 'port'],
      [{ from_address: 'not-an-address' }, 'from_address'],
      [{ from_name: 'Ksage\r\nBcc: x@y.z' }, 'from_name'],
      [{ username: 'u\nRCPT TO:<x@y.z>' }, 'username'],
    ];
    for (const [change, field] of cases) {
      const err = refusal(() =>
        setEmailSettings(t.db, owner, { ...SMTP_SETTINGS, ...change }, SECRET),
      );
      expect(err.code, field).toBe('unprocessable');
      expect(err.details, field).toMatchObject({ field });
    }
    expect(orgRow().smtpSettings).toBeNull();
  });

  it('cannot store a key on a server with no secret', () => {
    expect(refusal(() => setEmailSettings(t.db, actor(ownerId), SMTP_SETTINGS, '')).code).toBe(
      'internal',
    );
  });

  it('clearing forgets the key and the settings and turns the switch off', () => {
    setEmailSettings(t.db, actor(ownerId), SMTP_SETTINGS, SECRET);
    updateOrg(t.db, actor(ownerId), { email_enabled: true }, SECRET);
    expect(orgRow().emailEnabled).toBe(1);

    clearEmailSettings(t.db, actor(ownerId));
    expect(orgRow()).toMatchObject({ smtpSettings: null, smtpJsonEnc: null, emailEnabled: 0 });
    expect(getOrg(t.db, actor(ownerId)).email).toEqual({ enabled: false, configured: false });
  });
});

describe('the switch', () => {
  it('refuses to turn on with nothing configured: 422 email_not_configured', () => {
    const err = refusal(() => updateOrg(t.db, actor(ownerId), { email_enabled: true }, SECRET));
    expect(err.code).toBe('unprocessable');
    expect(err.details).toMatchObject({ reason: 'email_not_configured', field: 'email_enabled' });
    expect(orgRow().emailEnabled).toBe(0);
  });

  it('turns on once configured, off again at will, and OrgView says so', () => {
    setEmailSettings(t.db, actor(ownerId), SMTP_SETTINGS, SECRET);
    expect(updateOrg(t.db, actor(ownerId), { email_enabled: true }, SECRET).email).toEqual({
      enabled: true,
      configured: true,
    });
    expect(updateOrg(t.db, actor(ownerId), { email_enabled: false }, SECRET).email).toEqual({
      enabled: false,
      configured: true,
    });
  });

  it('is refused to a member, as every org setting is', () => {
    const member = actor(makeUser('member'));
    expect(refusal(() => updateOrg(t.db, member, { email_enabled: false }, SECRET)).code).toBe(
      'forbidden',
    );
  });
});

describe('the stored key', () => {
  it('will not read under another LAIKA_SECRET, and says that rather than "not configured"', () => {
    setEmailSettings(t.db, actor(ownerId), SMTP_SETTINGS, SECRET);
    expect(() => readSmtpConfig(t.db, OTHER_SECRET)).toThrow(EmailKeyUnreadableError);
    expect(readSmtpConfig(t.db, SECRET)).toMatchObject({
      host: 'smtp-relay.brevo.com',
      port: 587,
      fromAddress: 'ksage@kvelld.com',
      fromName: 'Ksage',
    });
  });
});

describe('Send test email', () => {
  it('sends while the switch is off — the one send that does — to whoever pressed it', async () => {
    setEmailSettings(t.db, actor(ownerId), SMTP_SETTINGS, SECRET);
    const mail = fakeMail();

    const view = await sendTestEmail(t.db, actor(ownerId), SECRET, mail.transport, () => NOW);

    expect(view).toEqual({
      ok: true,
      to: 'pawan@example.test',
      code: null,
      message: null,
      at: NOW,
    });
    expect(orgRow().emailEnabled).toBe(0);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]?.message).toMatchObject({
      to: 'pawan@example.test',
      subject: 'Ksage test email',
    });
    expect(mail.sent[0]?.config).toMatchObject({
      host: 'smtp-relay.brevo.com',
      port: 587,
      password: FAKE_SMTP_KEY,
    });
  });

  it('leaves a final outbox row with no body, which the card reads back', async () => {
    setEmailSettings(t.db, actor(ownerId), SMTP_SETTINGS, SECRET);
    await sendTestEmail(t.db, actor(ownerId), SECRET, fakeMail().transport, () => NOW);

    const rows = t.db.select().from(emailOutbox).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'test', state: 'sent', bodyEnc: null, sentAt: NOW });
    expect(getEmailSettings(t.db, actor(ownerId), '', NOW).last_test).toEqual({
      at: NOW,
      ok: true,
      to: 'pawan@example.test',
      code: null,
    });
  });

  it('reports a 535 as not ok, with the code — and records it as failed', async () => {
    setEmailSettings(t.db, actor(ownerId), SMTP_SETTINGS, SECRET);
    const mail = fakeMail([
      { kind: 'refused', permanent: true, code: '535', detail: '5.7.8 Authentication failed' },
    ]);

    const view = await sendTestEmail(t.db, actor(ownerId), SECRET, mail.transport, () => NOW);

    expect(view).toMatchObject({ ok: false, code: '535', message: '5.7.8 Authentication failed' });
    expect(t.db.select().from(emailOutbox).get()).toMatchObject({
      state: 'failed',
      lastError: '535: 5.7.8 Authentication failed',
    });
    expect(getEmailSettings(t.db, actor(ownerId), '', NOW).last_test).toMatchObject({
      ok: false,
      code: '535',
    });
  });

  it('reports a timeout with its code, recorded unconfirmed', async () => {
    setEmailSettings(t.db, actor(ownerId), SMTP_SETTINGS, SECRET);
    const mail = fakeMail([{ kind: 'indeterminate', code: 'ETIMEDOUT', detail: 'Timeout' }]);
    const view = await sendTestEmail(t.db, actor(ownerId), SECRET, mail.transport, () => NOW);
    expect(view).toMatchObject({ ok: false, code: 'ETIMEDOUT' });
    expect(t.db.select().from(emailOutbox).get()?.state).toBe('unconfirmed');
  });

  it('is 422 email_not_configured with no key, and sends nothing', async () => {
    const mail = fakeMail();
    await expect(sendTestEmail(t.db, actor(ownerId), SECRET, mail.transport)).rejects.toMatchObject(
      {
        code: 'unprocessable',
        details: { reason: 'email_not_configured' },
      },
    );
    expect(mail.sent).toHaveLength(0);
  });

  it('is 422 email_key_unreadable when LAIKA_SECRET changed, and sends nothing', async () => {
    setEmailSettings(t.db, actor(ownerId), SMTP_SETTINGS, SECRET);
    const mail = fakeMail();
    await expect(
      sendTestEmail(t.db, actor(ownerId), OTHER_SECRET, mail.transport),
    ).rejects.toMatchObject({ code: 'unprocessable', details: { reason: 'email_key_unreadable' } });
    expect(mail.sent).toHaveLength(0);
  });

  it('is refused to a member before anything is read', async () => {
    setEmailSettings(t.db, actor(ownerId), SMTP_SETTINGS, SECRET);
    const mail = fakeMail();
    const member = actor(makeUser('member'));
    await expect(sendTestEmail(t.db, member, SECRET, mail.transport)).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect(mail.sent).toHaveLength(0);
  });
});

describe('the seven-day counts', () => {
  it('counts the outbox by state, and only the last seven days', async () => {
    setEmailSettings(t.db, actor(ownerId), SMTP_SETTINGS, SECRET);
    await sendTestEmail(t.db, actor(ownerId), SECRET, fakeMail().transport, () => NOW);
    await sendTestEmail(
      t.db,
      actor(ownerId),
      SECRET,
      fakeMail().transport,
      () => NOW - 8 * 24 * 60 * 60 * 1000,
    );
    expect(t.db.select().from(emailOutbox).all()).toHaveLength(2);

    expect(getEmailSettings(t.db, actor(ownerId), '', NOW).last_7_days).toEqual({
      queued: 0,
      sending: 0,
      sent: 1,
      failed: 0,
      unconfirmed: 0,
      suppressed: 0,
    });
  });
});
