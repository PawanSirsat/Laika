import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActor, type ResolvedActor } from '../../src/auth/resolve-actor.ts';
import { emailInbound, tasks, users } from '../../src/db/schema.ts';
import { ApiError } from '../../src/errors.ts';
import {
  getEmailInboundSettings,
  getProjectEmailAddress,
  INBOUND_ITEMS_MAX,
  orgEmailInboundView,
  pruneEmailInbound,
  receiveInboundEmail,
  rotateEmailInboundToken,
  rotateProjectEmailAddress,
  setEmailInboundSettings,
  verifyInboundToken,
} from '../../src/services/email-inbound.ts';
import { freshDb, seed, type Seed, type TestDb } from '../helpers/db.ts';

/**
 * The inbound-email service on its own (D-155, LAI-1315): the bearer
 * comparison, the delivery's shape, the settings' normalising, the address
 * token, a deactivated sender, retention. The flow through the real app is
 * `test/http/routes/email-inbound.test.ts`.
 */

const SECRET = 'test-secret-that-is-long-enough-to-pass-validation';
const NOW = Date.UTC(2026, 10, 18, 9);
const DOMAIN = 'tasks.example.test';

let t: TestDb;
let s: Seed;
let owner: ResolvedActor;

beforeEach(() => {
  t = freshDb();
  s = seed(t.db, NOW - 60_000);
  owner = loadActor(t.db, s.userId)!;
});
afterEach(() => {
  t.close();
});

function refusal(fn: () => unknown): { code: string; details: unknown } {
  try {
    fn();
  } catch (err) {
    if (err instanceof ApiError) return { code: err.code, details: err.details };
    throw err;
  }
  throw new Error('expected a refusal');
}

function switchOn(): string {
  setEmailInboundSettings(t.db, owner, { domain: DOMAIN, authserv_id: 'mx.b' }, SECRET, '', NOW);
  const { token } = rotateEmailInboundToken(t.db, owner, '', NOW);
  setEmailInboundSettings(t.db, owner, { enabled: true }, SECRET, '', NOW);
  return token;
}

function mail(to: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    MessageId: `<${String(Math.random()).slice(2)}@example.test>`,
    From: { Address: 'owner@example.test' },
    Recipients: [{ Address: to }],
    Subject: 'A task by mail',
    ExtractedMarkdownMessage: 'Its text.',
    Headers: { 'Authentication-Results': 'mx.b; dmarc=pass header.from=example.test' },
    ...extra,
  };
}

describe('the bearer token', () => {
  it('accepts nothing until a token is made', () => {
    expect(verifyInboundToken(t.db, 'Bearer anything')).toBe(false);
    expect(verifyInboundToken(t.db, undefined)).toBe(false);
  });

  it('accepts exactly the token, as a bearer — and any other length is a plain no', () => {
    const token = switchOn();
    expect(verifyInboundToken(t.db, `Bearer ${token}`)).toBe(true);
    expect(verifyInboundToken(t.db, `bearer   ${token} `)).toBe(true);
    for (const header of [
      token,
      `Basic ${token}`,
      `Bearer ${token}x`,
      `Bearer ${token.slice(1)}`,
      'Bearer ',
      `Bearer ${'z'.repeat(10_000)}`,
      '',
      undefined,
    ]) {
      expect(verifyInboundToken(t.db, header), String(header).slice(0, 20)).toBe(false);
    }
  });
});

describe('the settings', () => {
  it('stores the domain lower case without its trailing dot, and an empty server name as none', () => {
    const view = setEmailInboundSettings(
      t.db,
      owner,
      { domain: 'Tasks.Example.TEST.', authserv_id: '' },
      SECRET,
      '',
      NOW,
    );
    expect(view).toMatchObject({ domain: DOMAIN, authserv_id: null });
    expect(orgEmailInboundView(t.db)).toEqual({ enabled: false, domain: DOMAIN });
  });

  it('says whether a key can be stored: not without LAIKA_SECRET, which refuses one', () => {
    expect(getEmailInboundSettings(t.db, owner, '', '').can_store_secrets).toBe(false);
    expect(getEmailInboundSettings(t.db, owner, '', SECRET).can_store_secrets).toBe(true);
    expect(
      refusal(() => setEmailInboundSettings(t.db, owner, { api_key: 'xkeysib-0123' }, '', '', NOW)),
    ).toMatchObject({ code: 'internal' });
  });

  it('makes a new token every time, and only the newest is accepted', () => {
    const first = switchOn();
    const second = rotateEmailInboundToken(t.db, owner, '', NOW).token;
    expect(second).not.toBe(first);
    expect(second).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(verifyInboundToken(t.db, `Bearer ${first}`)).toBe(false);
    expect(verifyInboundToken(t.db, `Bearer ${second}`)).toBe(true);
  });
});

describe('a space’s address', () => {
  it('is made once, and New address makes a different one', () => {
    switchOn();
    const first = getProjectEmailAddress(t.db, owner, 'laika', NOW);
    expect(first.address).toMatch(/^laika-[a-z2-7]{12}@tasks\.example\.test$/);
    expect(getProjectEmailAddress(t.db, owner, 'laika', NOW).address).toBe(first.address);
    const next = rotateProjectEmailAddress(t.db, owner, 'laika', NOW);
    expect(next.address).not.toBe(first.address);
    expect(getProjectEmailAddress(t.db, owner, 'laika', NOW).address).toBe(next.address);
  });

  it('has no address before the organisation has a domain', () => {
    expect(getProjectEmailAddress(t.db, owner, 'laika', NOW)).toEqual({
      address: null,
      enabled: false,
      can_rotate: true,
    });
  });
});

describe('a delivery', () => {
  it('is { items: [...] }, at most fifty', () => {
    switchOn();
    expect(refusal(() => receiveInboundEmail(t.sqlite, t.db, null, NOW))).toMatchObject({
      code: 'unprocessable',
    });
    expect(refusal(() => receiveInboundEmail(t.sqlite, t.db, [mail('x')], NOW)).code).toBe(
      'unprocessable',
    );
    const many = Array.from({ length: INBOUND_ITEMS_MAX + 1 }, () => mail('x'));
    expect(refusal(() => receiveInboundEmail(t.sqlite, t.db, { items: many }, NOW)).code).toBe(
      'unprocessable',
    );
  });

  it('skips an item that is not a mail, and records nothing for it', () => {
    switchOn();
    expect(receiveInboundEmail(t.sqlite, t.db, { items: [null, 'mail', 7] }, NOW)).toEqual([]);
    expect(t.db.select().from(emailInbound).all()).toHaveLength(0);
  });

  it('is never written as someone deactivated: their address is nobody’s', () => {
    switchOn();
    const to = getProjectEmailAddress(t.db, owner, 'laika', NOW).address!;
    t.db.update(users).set({ isActive: 0 }).where(eq(users.id, s.userId)).run();
    expect(receiveInboundEmail(t.sqlite, t.db, { items: [mail(to)] }, NOW)).toEqual([
      { outcome: 'dropped', reason: 'unknown_sender' },
    ]);
    expect(t.db.select().from(tasks).all()).toHaveLength(0);
  });

  it('records a mail with no space address at the domain once, as unknown_address', () => {
    switchOn();
    expect(
      receiveInboundEmail(t.sqlite, t.db, { items: [mail('someone@elsewhere.test')] }, NOW),
    ).toEqual([{ outcome: 'dropped', reason: 'unknown_address' }]);
    expect(t.db.select().from(emailInbound).get()).toMatchObject({
      addressToken: '',
      projectId: null,
    });
  });
});

describe('retention', () => {
  it('keeps 90 days of records and no more', () => {
    switchOn();
    const to = getProjectEmailAddress(t.db, owner, 'laika', NOW).address!;
    receiveInboundEmail(t.sqlite, t.db, { items: [mail(to)] }, NOW);
    expect(pruneEmailInbound(t.db, NOW + 90 * 86_400_000 - 1)).toBe(0);
    expect(pruneEmailInbound(t.db, NOW + 90 * 86_400_000 + 1)).toBe(1);
    // The task the mail made is not the record's to delete.
    expect(t.db.select().from(tasks).all()).toHaveLength(1);
  });
});
