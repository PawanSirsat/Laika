import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { newId } from '../../src/db/ids.ts';
import { emailOutbox, orgs, users } from '../../src/db/schema.ts';
import { decryptSecret } from '../../src/secrets.ts';
import {
  EMAIL_HORIZON_MS,
  EMAIL_MAX_ATTEMPTS,
  EMAIL_RETENTION_MS,
  EMAIL_STALE_SENDING_MS,
  invitesEmailed,
  pruneEmailOutbox,
  queueEmail,
  type QueueEmailInput,
  queueInviteEmail,
  queueResetEmail,
  runEmailOutbox,
  sendDueEmail,
  supersedeEmail,
} from '../../src/services/email-outbox.ts';
import { clearEmailSettings, setEmailSettings } from '../../src/services/email-settings.ts';
import { updateOrg } from '../../src/services/orgs.ts';
import { fakeMail, type FakeMail, SMTP_SETTINGS } from '../helpers/fake-mail.ts';
import { freshDb, type TestDb } from '../helpers/db.ts';

/**
 * The outbox (§4.93, D-153, LAI-1312): KSage's delivery design. Every send is
 * a recorder's; the clock is the test's.
 */

const SECRET = 'a-laika-secret-that-is-at-least-32-characters-long';
const NOW = 1_800_000_000_000;
const MINUTE = 60_000;

let t: TestDb;
let owner: ResolvedActor;
let mail: FakeMail;

beforeEach(() => {
  t = freshDb();
  const id = newId();
  t.db
    .insert(users)
    .values({
      id,
      email: 'pawan@example.test',
      name: 'Pawan',
      orgRole: 'owner',
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    })
    .run();
  t.db
    .insert(orgs)
    .values({ id: newId(), name: 'Kvell Dynamics', ownerUserId: id, createdAt: 1, updatedAt: 1 })
    .run();
  owner = loadActor(t.db, id)!;
  mail = fakeMail();
});
afterEach(() => {
  t.close();
});

/** Settings saved and the switch turned on: the state the owner reaches later. */
function emailOn(): void {
  setEmailSettings(t.db, owner, SMTP_SETTINGS, SECRET);
  updateOrg(t.db, owner, { email_enabled: true }, SECRET);
}

function message(overrides: Partial<QueueEmailInput> = {}): QueueEmailInput {
  return {
    kind: 'invite',
    idempotencyKey: `invite:${newId()}`,
    to: 'ada@example.test',
    recipientUserId: null,
    createdBy: owner.userId,
    rendered: {
      subject: 'Hello',
      text: 'the link: https://x/invite?token=T0K',
      html: '<p>T0K</p>',
    },
    ...overrides,
  };
}

function rows() {
  return t.db.select().from(emailOutbox).all();
}

function run(at: number) {
  return sendDueEmail(t.db, SECRET, { transport: mail.transport, now: () => at });
}

describe('with the switch off — how it ships', () => {
  it('writes a suppressed email_off row, with no body, and the transport is never called', async () => {
    setEmailSettings(t.db, owner, SMTP_SETTINGS, SECRET);

    const dispatch = queueEmail(t.db, message(), SECRET, NOW);
    expect(dispatch).toEqual({ queued: false, reason: 'email_off' });
    expect(rows()).toEqual([
      expect.objectContaining({
        state: 'suppressed',
        suppressedReason: 'email_off',
        bodyEnc: null,
      }),
    ]);

    expect(await run(NOW + MINUTE)).toMatchObject({ sent: 0 });
    expect(mail.sent).toHaveLength(0);
  });

  it('says email_off before anything else, configured or not', () => {
    expect(queueEmail(t.db, message({ to: null }), SECRET, NOW).reason).toBe('email_off');
  });
});

describe('with the switch on', () => {
  beforeEach(emailOn);

  it('queues with the body encrypted, sends it, and clears the body once sent', async () => {
    const input = message();
    expect(queueEmail(t.db, input, SECRET, NOW)).toEqual({ queued: true, reason: null });

    const queued = rows()[0]!;
    expect(queued).toMatchObject({ state: 'queued', nextAttemptAt: NOW });
    expect(queued.bodyEnc).not.toContain('T0K');
    expect(JSON.parse(decryptSecret(queued.bodyEnc!, SECRET, 'email_body'))).toEqual({
      text: input.rendered.text,
      html: input.rendered.html,
    });

    expect(await run(NOW + 1)).toMatchObject({ sent: 1 });
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]?.message).toEqual({
      to: 'ada@example.test',
      subject: 'Hello',
      text: input.rendered.text,
      html: input.rendered.html,
      idempotencyKey: input.idempotencyKey,
    });
    expect(rows()[0]).toMatchObject({ state: 'sent', bodyEnc: null, sentAt: NOW + 1, attempts: 1 });
  });

  it('is idempotent: the same key again writes nothing and mails once', async () => {
    const input = message();
    queueEmail(t.db, input, SECRET, NOW);
    expect(queueEmail(t.db, input, SECRET, NOW + 5)).toEqual({ queued: true, reason: null });
    expect(rows()).toHaveLength(1);
    await run(NOW + 10);
    await run(NOW + 20);
    expect(mail.sent).toHaveLength(1);
  });

  it('says no_address for a message with nobody to send to', () => {
    expect(queueEmail(t.db, message({ to: null }), SECRET, NOW)).toEqual({
      queued: false,
      reason: 'no_address',
    });
  });

  it('says no_public_url for a link that could not be made absolute', () => {
    expect(queueEmail(t.db, message({ linkable: false }), SECRET, NOW).reason).toBe(
      'no_public_url',
    );
  });

  it('marks a 5xx failed at once, with its code, and never tries again', async () => {
    mail.script.push({
      kind: 'refused',
      permanent: true,
      code: '550',
      detail: 'mailbox unavailable',
    });
    queueEmail(t.db, message(), SECRET, NOW);
    expect(await run(NOW + 1)).toMatchObject({ failed: 1 });
    expect(rows()[0]).toMatchObject({
      state: 'failed',
      bodyEnc: null,
      lastError: '550: mailbox unavailable',
    });
    await run(NOW + 2 * 60 * MINUTE);
    expect(mail.sent).toHaveLength(1);
  });

  it('retries a 4xx after a minute, and then sends', async () => {
    mail.script.push({ kind: 'refused', permanent: false, code: '421', detail: 'try later' });
    queueEmail(t.db, message(), SECRET, NOW);

    expect(await run(NOW + 1)).toMatchObject({ retried: 1 });
    expect(rows()[0]).toMatchObject({
      state: 'queued',
      attempts: 1,
      nextAttemptAt: NOW + 1 + MINUTE,
      lastError: '421: try later',
    });
    expect(rows()[0]?.bodyEnc).not.toBeNull();

    // Not due yet: nothing is sent.
    expect(await run(NOW + 30_000)).toMatchObject({ sent: 0, retried: 0 });
    expect(mail.sent).toHaveLength(1);

    expect(await run(NOW + 1 + MINUTE)).toMatchObject({ sent: 1 });
    expect(rows()[0]).toMatchObject({ state: 'sent', attempts: 2, bodyEnc: null });
  });

  it('retries what never connected, and fails after five attempts', async () => {
    for (let i = 0; i < EMAIL_MAX_ATTEMPTS; i += 1) {
      mail.script.push({ kind: 'unreachable', code: 'ECONNREFUSED', detail: 'refused' });
    }
    queueEmail(t.db, message(), SECRET, NOW);
    let at = NOW;
    for (let i = 0; i < EMAIL_MAX_ATTEMPTS; i += 1) {
      at = rows()[0]!.nextAttemptAt ?? at;
      await run(at);
    }
    expect(mail.sent).toHaveLength(EMAIL_MAX_ATTEMPTS);
    expect(rows()[0]).toMatchObject({
      state: 'failed',
      attempts: EMAIL_MAX_ATTEMPTS,
      bodyEnc: null,
    });
  });

  it('never retries a timeout once the session was underway: unconfirmed, final', async () => {
    mail.script.push({ kind: 'indeterminate', code: 'ETIMEDOUT', detail: 'Timeout' });
    queueEmail(t.db, message(), SECRET, NOW);
    expect(await run(NOW + 1)).toMatchObject({ unconfirmed: 1 });
    expect(rows()[0]).toMatchObject({
      state: 'unconfirmed',
      bodyEnc: null,
      lastError: 'ETIMEDOUT: Timeout',
    });
    await run(NOW + 2 * 60 * MINUTE);
    expect(mail.sent).toHaveLength(1);
  });

  it('gives up on a row left sending for ten minutes — unconfirmed, never handed on', async () => {
    queueEmail(t.db, message(), SECRET, NOW);
    t.db.update(emailOutbox).set({ state: 'sending', claimedAt: NOW }).run();

    expect(await run(NOW + EMAIL_STALE_SENDING_MS - 1)).toMatchObject({ unconfirmed: 0 });
    expect(await run(NOW + EMAIL_STALE_SENDING_MS)).toMatchObject({ unconfirmed: 1 });
    expect(rows()[0]).toMatchObject({ state: 'unconfirmed', bodyEnc: null });
    expect(mail.sent).toHaveLength(0);
  });

  it('suppresses a message past its horizon as too_old, unsent', async () => {
    queueEmail(t.db, message(), SECRET, NOW);
    expect(rows()[0]?.sendBefore).toBe(NOW + EMAIL_HORIZON_MS);
    expect(await run(NOW + EMAIL_HORIZON_MS)).toMatchObject({ suppressed: 1 });
    expect(rows()[0]).toMatchObject({
      state: 'suppressed',
      suppressedReason: 'too_old',
      bodyEnc: null,
    });
    expect(mail.sent).toHaveLength(0);
  });

  it('takes the link’s own expiry as the horizon when it is sooner', () => {
    queueEmail(t.db, message({ expiresAt: NOW + 60 * MINUTE }), SECRET, NOW);
    expect(rows()[0]?.sendBefore).toBe(NOW + 60 * MINUTE);
  });

  it('suppresses as email_off at send time when the switch went off after queueing', async () => {
    queueEmail(t.db, message(), SECRET, NOW);
    updateOrg(t.db, owner, { email_enabled: false }, SECRET);
    expect(await run(NOW + 1)).toMatchObject({ suppressed: 1 });
    expect(rows()[0]).toMatchObject({
      state: 'suppressed',
      suppressedReason: 'email_off',
      bodyEnc: null,
    });
    expect(mail.sent).toHaveLength(0);
  });

  it('suppresses as email_not_configured at send time when the settings were cleared', async () => {
    queueEmail(t.db, message(), SECRET, NOW);
    // Clearing also turns the switch off, so put it back on by hand: the
    // second check is the one under test.
    clearEmailSettings(t.db, owner);
    t.db.update(orgs).set({ emailEnabled: 1 }).run();
    expect(await run(NOW + 1)).toMatchObject({ suppressed: 1 });
    expect(rows()[0]?.suppressedReason).toBe('email_not_configured');
  });

  it('stops at the next message when the switch goes off mid-run', async () => {
    queueEmail(t.db, message(), SECRET, NOW);
    queueEmail(t.db, message(), SECRET, NOW + 1);
    // The first send turns email off, as an admin would while a run is going.
    const flipping = {
      send: () => {
        t.db.update(orgs).set({ emailEnabled: 0 }).run();
        return Promise.resolve({ kind: 'sent' as const });
      },
    };
    const result = await sendDueEmail(t.db, SECRET, { transport: flipping, now: () => NOW + 2 });
    expect(result).toMatchObject({ sent: 1, suppressed: 1 });
    expect(
      rows()
        .map((r) => [r.state, r.suppressedReason])
        .sort(),
    ).toEqual([
      ['sent', null],
      ['suppressed', 'email_off'],
    ]);
  });

  it('supersedes only what is still queued, by key', () => {
    const waiting = message();
    const other = message();
    queueEmail(t.db, waiting, SECRET, NOW);
    queueEmail(t.db, other, SECRET, NOW);
    expect(supersedeEmail(t.db, [waiting.idempotencyKey, 'invite:none'], NOW + 1)).toBe(1);
    const byKey = Object.fromEntries(rows().map((r) => [r.idempotencyKey, r]));
    expect(byKey[waiting.idempotencyKey]).toMatchObject({
      state: 'suppressed',
      suppressedReason: 'superseded',
      bodyEnc: null,
    });
    expect(byKey[other.idempotencyKey]?.state).toBe('queued');
    expect(supersedeEmail(t.db, [], NOW)).toBe(0);
  });

  it('joins a run already going rather than starting a second', async () => {
    queueEmail(t.db, message(), SECRET, NOW);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    const slow = {
      send: async () => {
        await gate;
        return { kind: 'sent' as const };
      },
    };
    const first = runEmailOutbox(t.db, SECRET, { transport: slow, now: () => NOW + 1 });
    const second = runEmailOutbox(t.db, SECRET, { transport: mail.transport, now: () => NOW + 2 });
    expect(second).toBe(first);
    release();
    expect(await first).toMatchObject({ sent: 1 });
    expect(mail.sent).toHaveLength(0);
  });
});

describe('invite and reset mail', () => {
  beforeEach(emailOn);

  it('mails an invite’s link to its address, keyed by the invite', async () => {
    const dispatch = queueInviteEmail(
      t.db,
      {
        inviteId: 'INV1',
        email: 'ada@example.test',
        expiresAt: NOW + 7 * 24 * 60 * MINUTE,
        acceptUrl: 'https://ksage.kvelld.com/invite?token=abc',
        inviter: { userId: owner.userId, name: 'Pawan' },
      },
      SECRET,
      NOW,
    );
    expect(dispatch).toEqual({ queued: true, reason: null });
    expect(rows()[0]).toMatchObject({
      kind: 'invite',
      idempotencyKey: 'invite:INV1',
      subject: 'Pawan invited you to Kvell Dynamics on Ksage',
    });

    expect(invitesEmailed(t.db, ['INV1'])).toEqual(new Set());
    await run(NOW + 1);
    expect(mail.sent[0]?.message.text).toContain('https://ksage.kvelld.com/invite?token=abc');
    expect(invitesEmailed(t.db, ['INV1', 'OTHER'])).toEqual(new Set(['INV1']));
  });

  it('records a link invite as no_address, and a missing public URL as no_public_url', () => {
    const base = {
      expiresAt: NOW + MINUTE,
      acceptUrl: 'https://x/invite?token=a',
      inviter: { userId: owner.userId, name: 'Pawan' },
    };
    expect(
      queueInviteEmail(t.db, { ...base, inviteId: 'A', email: null }, SECRET, NOW).reason,
    ).toBe('no_address');
    expect(
      queueInviteEmail(
        t.db,
        { ...base, inviteId: 'B', email: 'b@example.test', acceptUrl: null },
        SECRET,
        NOW,
      ).reason,
    ).toBe('no_public_url');
  });

  it('mails a reset link to the person it is for, keyed by the link', async () => {
    const dispatch = queueResetEmail(
      t.db,
      {
        resetId: 'RST1',
        user: { id: owner.userId, name: 'Pawan', email: 'pawan@example.test' },
        expiresAt: NOW + 24 * 60 * MINUTE,
        resetUrl: 'https://ksage.kvelld.com/reset-password?token=xyz',
        issuer: { userId: owner.userId, name: 'Pawan' },
      },
      SECRET,
      NOW,
    );
    expect(dispatch.queued).toBe(true);
    expect(rows()[0]).toMatchObject({
      kind: 'password_reset',
      idempotencyKey: 'password_reset:RST1',
      recipientUserId: owner.userId,
      sendBefore: NOW + 24 * 60 * MINUTE,
    });
    await run(NOW + 1);
    expect(mail.sent[0]?.message.to).toBe('pawan@example.test');
  });
});

describe('retention', () => {
  it('deletes final rows after 90 days and never a queued one', () => {
    emailOn();
    queueEmail(t.db, message(), SECRET, NOW);
    updateOrg(t.db, owner, { email_enabled: false }, SECRET);
    queueEmail(t.db, message(), SECRET, NOW);
    expect(
      rows()
        .map((r) => r.state)
        .sort(),
    ).toEqual(['queued', 'suppressed']);

    expect(pruneEmailOutbox(t.db, NOW + EMAIL_RETENTION_MS)).toBe(0);
    expect(pruneEmailOutbox(t.db, NOW + EMAIL_RETENTION_MS + 1)).toBe(1);
    expect(rows().map((r) => r.state)).toEqual(['queued']);
  });
});
