import { count, desc, eq, gte } from 'drizzle-orm';
import { type ResolvedActor } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { EMAIL_STATES, type EmailState } from '../db/enums.ts';
import { newId } from '../db/ids.ts';
import { requireOrgId } from '../db/orgs.ts';
import { emailOutbox, orgs } from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan } from '../policy/can.ts';
import { decryptSecret, encryptSecret, SecretAuthError, SecretFormatError } from '../secrets.ts';
import { testEmail } from './email-templates.ts';
import { errorLine, type MailTransport, type SmtpConfig } from './email-transport.ts';
import { z } from 'zod';

/**
 * The organisation's outbound email (D-153, LAI-1312): the SMTP settings on
 * Organisation › Integrations, the *Email on* switch, and *Send test email*.
 *
 * ## The switch ships off
 *
 * The owner's words: *"implement everything and workable but I don't want to
 * enable this email thing … right now, will do that later at one click"*. So
 * every path is built and tested, and nothing is mailed until an owner or admin
 * turns `orgs.email_enabled` on. Turning it on later is three steps: paste the
 * key, *Send test email*, flip the switch.
 *
 * ## Who
 *
 * §3.1's *Org settings (AI provider, SMTP, signup mode)* row, which has named
 * SMTP since the matrix was written — `org.settings.edit`, owners and the
 * admins the matrix grants it to. No new action: the row was always this.
 *
 * ## Two columns, so a view never decrypts
 *
 * The key is ciphertext in `smtp_json_enc` under §12's `smtp_json` purpose; the
 * rest — host, port, username, From and the key's last four characters — is
 * plain JSON in `smtp_settings`. Building `EmailSettingsView` reads only the
 * second, which is LAI-447's rule for the AI key kept for this one: *"a
 * serialiser that can reach plaintext is one refactor away from returning it"*.
 * Only the sender and the test send decrypt, and neither returns what it read.
 */

/**
 * What the card is pre-filled with before anything is saved: Brevo's relay and
 * Kvell's sender (D-153). Pre-filled, not saved — an admin on any other board
 * changes them before pressing Save.
 */
export const EMAIL_DEFAULTS = {
  host: 'smtp-relay.brevo.com',
  port: 587,
  from_address: 'ksage@kvelld.com',
  from_name: 'Ksage',
} as const;

/** The name a message uses for the board when no From name is set. */
const FALLBACK_PRODUCT = 'Laika';

/** What `smtp_settings` holds. Never the key. */
const StoredSettings = z.object({
  host: z.string(),
  port: z.number().int(),
  username: z.string(),
  from_address: z.string(),
  from_name: z.string(),
  key_last4: z.string().nullable(),
});
type StoredSettings = z.infer<typeof StoredSettings>;

/** What `smtp_json_enc` decrypts to. */
const StoredSecret = z.object({ password: z.string() });

/** The defaults, as the view states them. */
export interface EmailDefaultsView {
  host: string;
  port: number;
  from_address: string;
  from_name: string;
}

/** The last *Send test email*, from the outbox. */
export interface EmailLastTestView {
  at: number;
  ok: boolean;
  to: string | null;
  /** The SMTP reply code or the transport's code; null when it was sent. */
  code: string | null;
}

/** The outbox over the last seven days, by state — the card's health line. */
export interface EmailCountsView {
  queued: number;
  sending: number;
  sent: number;
  failed: number;
  unconfirmed: number;
  suppressed: number;
}

/** `GET /org/email` (§6.4): the Email card, for `org.settings.edit`. */
export interface EmailSettingsView {
  /** The *Email on* switch. */
  enabled: boolean;
  /** Settings saved **and** a key stored — what the switch needs. */
  configured: boolean;
  host: string | null;
  port: number | null;
  username: string | null;
  from_address: string | null;
  from_name: string | null;
  /** The key's last four characters, stored when it was set. Never the key. */
  key_last4: string | null;
  defaults: EmailDefaultsView;
  /**
   * `LAIKA_PUBLIC_URL`, or null when the server has none — and then an invite
   * or a reset is suppressed `no_public_url`, because a link in an email must
   * be absolute. The card says so.
   */
  public_url: string | null;
  last_test: EmailLastTestView | null;
  last_7_days: EmailCountsView;
}

/** What `OrgView.email` says to everyone (§6.4): whether mail can go out at all. */
export interface OrgEmailView {
  enabled: boolean;
  configured: boolean;
}

/** The two `orgs` fields the Email card and `OrgView.email` read. */
interface EmailColumns {
  emailEnabled: number;
  smtpSettings: string | null;
  smtpJsonEnc: string | null;
}

/** `smtp_settings` parsed, or null when it is absent or not what this wrote. */
function parseSettings(raw: string | null): StoredSettings | null {
  if (raw === null || raw === '') return null;
  try {
    const parsed = StoredSettings.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Settings saved and a key stored: the one definition of *configured*. */
export function isEmailConfigured(row: EmailColumns): boolean {
  return parseSettings(row.smtpSettings) !== null && (row.smtpJsonEnc ?? '') !== '';
}

/** `OrgView.email`, from the row `getOrg` already read. */
export function orgEmailView(row: EmailColumns): OrgEmailView {
  return { enabled: row.emailEnabled === 1, configured: isEmailConfigured(row) };
}

function readColumns(db: Db): EmailColumns & { name: string } {
  const row = db
    .select({
      name: orgs.name,
      emailEnabled: orgs.emailEnabled,
      smtpSettings: orgs.smtpSettings,
      smtpJsonEnc: orgs.smtpJsonEnc,
    })
    .from(orgs)
    .where(eq(orgs.id, requireOrgId(db)))
    .get();
  if (row === undefined) throw ApiError.notFound('This instance has no organisation yet');
  return row;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/** `GET /org/email` (§6.4, D-153). */
export function getEmailSettings(
  db: Db,
  actor: ResolvedActor,
  publicUrl = '',
  now: number = Date.now(),
): EmailSettingsView {
  assertCan(actor, 'org.settings.edit');
  const row = readColumns(db);
  const settings = parseSettings(row.smtpSettings);

  const counts = Object.fromEntries(EMAIL_STATES.map((s) => [s, 0])) as Record<EmailState, number>;
  for (const r of db
    .select({ state: emailOutbox.state, n: count() })
    .from(emailOutbox)
    .where(gte(emailOutbox.createdAt, now - SEVEN_DAYS_MS))
    .groupBy(emailOutbox.state)
    .all()) {
    counts[r.state] = r.n;
  }

  const test = db
    .select({
      at: emailOutbox.updatedAt,
      state: emailOutbox.state,
      to: emailOutbox.toAddress,
      lastError: emailOutbox.lastError,
    })
    .from(emailOutbox)
    .where(eq(emailOutbox.kind, 'test'))
    .orderBy(desc(emailOutbox.createdAt), desc(emailOutbox.id))
    .limit(1)
    .get();

  const base = publicUrl.replace(/\/+$/, '');
  return {
    enabled: row.emailEnabled === 1,
    configured: isEmailConfigured(row),
    host: settings?.host ?? null,
    port: settings?.port ?? null,
    username: settings?.username ?? null,
    from_address: settings?.from_address ?? null,
    from_name: settings?.from_name ?? null,
    key_last4: settings?.key_last4 ?? null,
    defaults: { ...EMAIL_DEFAULTS },
    public_url: base === '' ? null : base,
    last_test:
      test === undefined
        ? null
        : {
            at: test.at,
            ok: test.state === 'sent',
            to: test.to,
            code: test.state === 'sent' ? null : codeOf(test.lastError),
          },
    last_7_days: {
      queued: counts.queued,
      sending: counts.sending,
      sent: counts.sent,
      failed: counts.failed,
      unconfirmed: counts.unconfirmed,
      suppressed: counts.suppressed,
    },
  };
}

/** The code at the front of a `last_error` (`535: …`). */
function codeOf(lastError: string | null): string | null {
  if (lastError === null) return null;
  const colon = lastError.indexOf(':');
  return colon === -1 ? lastError : lastError.slice(0, colon);
}

/** `PUT /org/email` (§6.4). `password` absent keeps the stored key. */
export interface SetEmailSettingsInput {
  host: string;
  port: number;
  username: string;
  /** The Brevo key. Write-only: absent keeps the one stored, and nothing returns it. */
  password?: string | undefined;
  from_address: string;
  from_name: string;
}

/** Characters that would let a value start a new SMTP header or command. */
const LINE_BREAK = /[\r\n]/;

/** A host name or an address: letters, digits, dots, hyphens and colons (IPv6). */
const HOST = /^[A-Za-z0-9.:-]+$/;

/** Plain `local@domain` — the sender must be one the relay will accept. */
const ADDRESS = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/;

function refuse(field: string, message: string): never {
  throw new ApiError('unprocessable', message, { field });
}

/** The rules a route cannot see: shape, not just length. */
function assertSettings(input: SetEmailSettingsInput): void {
  if (!HOST.test(input.host) || input.host.startsWith('-')) {
    refuse('host', 'host must be a host name, such as smtp-relay.brevo.com');
  }
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
    refuse('port', 'port must be a whole number from 1 to 65535');
  }
  if (!ADDRESS.test(input.from_address)) {
    refuse('from_address', 'from_address must be an email address');
  }
  for (const [field, value] of [
    ['username', input.username],
    ['from_name', input.from_name],
    ['password', input.password ?? ''],
  ] as const) {
    if (LINE_BREAK.test(value)) refuse(field, `${field} cannot contain a line break`);
  }
}

/**
 * `PUT /org/email` — save the SMTP settings (§6.4, D-153).
 *
 * Saving without a key is allowed and leaves `configured` false: an admin can
 * fill in the host now and paste the key later. A key, once given, is kept
 * until another replaces it or the settings are cleared.
 */
export function setEmailSettings(
  db: Db,
  actor: ResolvedActor,
  input: SetEmailSettingsInput,
  serverSecret: string,
  publicUrl = '',
  now: number = Date.now(),
): EmailSettingsView {
  assertCan(actor, 'org.settings.edit');
  assertSettings(input);
  if (input.password !== undefined && serverSecret === '') {
    throw new ApiError('internal', 'This server cannot store secrets');
  }

  const orgId = requireOrgId(db);
  const current = parseSettings(readColumns(db).smtpSettings);
  const keyLast4 =
    input.password === undefined ? (current?.key_last4 ?? null) : input.password.slice(-4);

  const settings: StoredSettings = {
    host: input.host,
    port: input.port,
    username: input.username,
    from_address: input.from_address,
    from_name: input.from_name,
    key_last4: keyLast4,
  };

  db.update(orgs)
    .set({
      smtpSettings: JSON.stringify(settings),
      ...(input.password === undefined
        ? {}
        : {
            smtpJsonEnc: encryptSecret(
              JSON.stringify({ password: input.password }),
              serverSecret,
              'smtp_json',
            ),
          }),
      updatedAt: now,
    })
    .where(eq(orgs.id, orgId))
    .run();

  return getEmailSettings(db, actor, publicUrl, now);
}

/**
 * `DELETE /org/email` — forget the settings and the key, and turn the switch
 * off with them: a switch on with nothing behind it would read as working.
 */
export function clearEmailSettings(db: Db, actor: ResolvedActor, now: number = Date.now()): void {
  assertCan(actor, 'org.settings.edit');
  db.update(orgs)
    .set({ smtpSettings: null, smtpJsonEnc: null, emailEnabled: 0, updatedAt: now })
    .where(eq(orgs.id, requireOrgId(db)))
    .run();
}

/**
 * The stored key could not be read — `LAIKA_SECRET` changed since it was saved,
 * or the row was altered. Not "not configured": LAI-437's family, an
 * infrastructure fault that must not read as an absence (secrets.ts).
 */
export class EmailKeyUnreadableError extends Error {
  constructor() {
    super(
      'The stored SMTP key cannot be read: LAIKA_SECRET has changed since it was saved, or the row was altered. Paste the key again.',
    );
    this.name = 'EmailKeyUnreadableError';
  }
}

/**
 * The full SMTP configuration, key decrypted — for the sender and the test
 * send only, never a view. Null when nothing usable is saved.
 */
export function readSmtpConfig(db: Db, serverSecret: string): SmtpConfig | null {
  const row = readColumns(db);
  const settings = parseSettings(row.smtpSettings);
  if (settings === null || row.smtpJsonEnc === null || row.smtpJsonEnc === '') return null;
  if (serverSecret === '') throw new EmailKeyUnreadableError();

  let password: string;
  try {
    const secret = StoredSecret.safeParse(
      JSON.parse(decryptSecret(row.smtpJsonEnc, serverSecret, 'smtp_json')),
    );
    if (!secret.success) throw new EmailKeyUnreadableError();
    password = secret.data.password;
  } catch (err) {
    if (
      err instanceof SecretAuthError ||
      err instanceof SecretFormatError ||
      err instanceof SyntaxError
    ) {
      throw new EmailKeyUnreadableError();
    }
    throw err;
  }

  return {
    host: settings.host,
    port: settings.port,
    username: settings.username,
    password,
    fromAddress: settings.from_address,
    fromName: settings.from_name,
  };
}

/** What every message is signed as: the From name, and the organisation. */
export function emailBrand(db: Db): { product: string; orgName: string } {
  const row = readColumns(db);
  const name = parseSettings(row.smtpSettings)?.from_name.trim() ?? '';
  return { product: name === '' ? FALLBACK_PRODUCT : name, orgName: row.name };
}

/** `POST /org/email/test`'s answer (§6.4). */
export interface EmailTestView {
  ok: boolean;
  /** Where it went: the address of whoever pressed the button. */
  to: string;
  /** The SMTP reply code (`535`) or the transport's (`ETIMEDOUT`); null when sent. */
  code: string | null;
  /** The server's words, short; null when sent. */
  message: string | null;
  at: number;
}

/**
 * `POST /org/email/test` — send one message, now, to whoever pressed the button
 * (§6.4, D-153).
 *
 * **The one send that works while the switch is off.** That is the point of
 * it: the settings are proved before anything else can go out. It answers
 * `200` whether the server took the message or not — the answer *is* the
 * result, with the SMTP code a failure carried — and leaves an outbox row
 * with no body, so the card can say when it was last tried.
 *
 * Synchronous on purpose, unlike every other message: somebody is waiting on
 * the button, and the transport's timeouts bound how long.
 */
export async function sendTestEmail(
  db: Db,
  actor: ResolvedActor,
  serverSecret: string,
  transport: MailTransport,
  now: () => number = Date.now,
): Promise<EmailTestView> {
  assertCan(actor, 'org.settings.edit');

  let config: SmtpConfig | null;
  try {
    config = readSmtpConfig(db, serverSecret);
  } catch (err) {
    if (err instanceof EmailKeyUnreadableError) {
      throw new ApiError('unprocessable', err.message, { reason: 'email_key_unreadable' });
    }
    throw err;
  }
  if (config === null) {
    throw new ApiError('unprocessable', 'Save the SMTP settings and the key first', {
      reason: 'email_not_configured',
    });
  }

  const brand = emailBrand(db);
  const rendered = testEmail({ brand, userName: actor.name });
  const id = newId();
  const outcome = await transport.send(config, {
    to: actor.email,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    idempotencyKey: `test:${id}`,
  });

  const at = now();
  const ok = outcome.kind === 'sent';
  const code = ok ? null : outcome.code;
  const message = ok ? null : outcome.detail;
  const state: EmailState = ok
    ? 'sent'
    : outcome.kind === 'indeterminate'
      ? 'unconfirmed'
      : 'failed';

  db.insert(emailOutbox)
    .values({
      id,
      kind: 'test',
      idempotencyKey: `test:${id}`,
      recipientUserId: actor.userId,
      toAddress: actor.email,
      subject: rendered.subject,
      bodyEnc: null,
      state,
      attempts: 1,
      sendBefore: at,
      sentAt: ok ? at : null,
      lastError: ok ? null : errorLine(code ?? 'EUNKNOWN', message ?? ''),
      createdBy: actor.userId,
      createdAt: at,
      updatedAt: at,
    })
    .run();

  return { ok, to: actor.email, code, message, at };
}

/** Whether mail may go out now: the switch, and something to send with. */
export function emailSwitch(db: Db): { enabled: boolean; configured: boolean } {
  const row = readColumns(db);
  return { enabled: row.emailEnabled === 1, configured: isEmailConfigured(row) };
}
