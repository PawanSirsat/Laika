import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type Database from 'better-sqlite3';
import { and, desc, eq, inArray, isNotNull, lt } from 'drizzle-orm';
import { type ResolvedActor, loadActor, withProject } from '../auth/resolve-actor.ts';
import { type Db } from '../db/client.ts';
import { type EmailInboundOutcome, type EmailInboundReason } from '../db/enums.ts';
import { newId } from '../db/ids.ts';
import { requireOrgId } from '../db/orgs.ts';
import {
  emailInbound,
  emailInboundAttachments,
  orgEmailInbound,
  projectInboundAddresses,
  projects,
  tasks,
  users,
} from '../db/schema.ts';
import { ApiError } from '../errors.ts';
import { assertCan, can, systemPrincipal } from '../policy/can.ts';
import { encryptSecret } from '../secrets.ts';
import { addComment } from './comments.ts';
import {
  addressToken,
  authservIds,
  authVerdict,
  domainOf,
  type InboundMail,
  isAutomatic,
  readInboundMail,
  subjectKey,
  taskTitle,
} from './email-inbound-parse.ts';
import { boardFromAddress } from './email-settings.ts';
import { requireReadableProjectBySlug } from './projects.ts';
import { createTask, resolveTaskRef } from './tasks.ts';

/**
 * Email to tasks (D-155, LAI-1315): a mail to a space's address becomes a task
 * written as its sender, and a reply in the thread a comment on that task.
 *
 * ## New authority: the webhook writes as a person
 *
 * Nothing else in Laika acts as a person who did not sign in. Here the From
 * header names a member, and the task or comment is written as them — their
 * `can()`, their name on the activity. **That is only as good as the proof the
 * mail came from them**, and a From header is a line of text anybody can
 * write. So a mail is written as its sender only when all of these hold:
 *
 * - the organisation turned *Email to tasks* on (it ships off);
 * - it came through Brevo, which proved it by the webhook's bearer token;
 * - it was sent to a space's address, which carries sixty random bits;
 * - the receiving server vouched for the From domain — a DMARC, DKIM
 *   or SPF pass in the `Authentication-Results` header Laika believes (on
 *   unless an owner turns it off);
 * - it is not the board's own mail, an auto-reply, a bounce, list mail or
 *   spam;
 * - the address belongs to an active person, and `can()` lets that person
 *   create the task, or comment, in that space.
 *
 * Anything else is **dropped and never answered**: a row in `email_inbound`
 * with the reason, and no reply a forger could learn from.
 *
 * ## Never the mail's text in a record
 *
 * The subject and text go into the task or comment they make, and nowhere
 * else: not `email_inbound`, not a log line, not the webhook's answer.
 */

/** The receiving domain the card offers as an example. */
export const EXAMPLE_INBOUND_DOMAIN = 'tasks.kvelld.com';

/** A mail Brevo scored at or above this is spam. */
export const SPAM_SCORE_LINE = 5;

/** How many inbound mails the card lists. */
const RECENT_INBOUND = 20;

/** Inbound records are kept 90 days (§11.6). */
const INBOUND_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

/** The most mails one delivery may carry. */
export const INBOUND_ITEMS_MAX = 50;

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

/** A new address token: twelve characters of lower-case base32, sixty bits. */
function newAddressToken(): string {
  return [...randomBytes(12)].map((b) => BASE32[b % 32]).join('');
}

/** The SHA-256 of a token, as 32 bytes. */
function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

// --------------------------------------------------------------------- views

/** Who someone is, on the card. */
export interface InboundPersonView {
  id: string;
  name: string;
}

/** The space a mail went to, on the card. */
export interface InboundProjectView {
  slug: string;
  name: string;
}

/** One inbound mail as the card lists it — never its subject or text. */
export interface EmailInboundRowView {
  id: string;
  received_at: number;
  outcome: EmailInboundOutcome;
  reason: EmailInboundReason | null;
  /** The From address, as the mail gave it. */
  from_address: string | null;
  /** The person it was matched to. */
  sender: InboundPersonView | null;
  project: InboundProjectView | null;
  /** The task it made or commented on, by key. */
  task_key: string | null;
  comment_id: string | null;
  /** The believed server and its verdicts, e.g. `mx.example dmarc=pass`. */
  auth: string | null;
  /** Every server the mail's `Authentication-Results` named, topmost first. */
  authserv_ids: string[];
  attachment_count: number;
}

/** `GET /org/email-inbound` (§6.4): the *Email to tasks* card, for `org.email.configure`. */
export interface EmailInboundSettingsView {
  /** The switch. Off, every mail is recorded and dropped `switch_off`. */
  enabled: boolean;
  /** The receiving subdomain, e.g. `tasks.kvelld.com`. */
  domain: string | null;
  /** Drop a mail without a DMARC, DKIM or SPF pass for its From domain. */
  require_authenticated: boolean;
  /** The receiving server whose first `Authentication-Results` is believed; null believes nothing. */
  authserv_id: string | null;
  /** The webhook token's last four characters; null until one is made. */
  token_last4: string | null;
  /** The Brevo API key's last four characters. */
  api_key_last4: string | null;
  /** Where Brevo posts: `LAIKA_PUBLIC_URL/webhooks/email`; null without a public URL. */
  webhook_url: string | null;
  /** The board's own From address: a mail from it is dropped. */
  own_address: string;
  /**
   * Whether this server has `LAIKA_SECRET`, without which an API key cannot be
   * stored (§12) — so the card can say so before *Save*, not after.
   */
  can_store_secrets: boolean;
  /**
   * Whether the caller may change anything but turning it off (M2): an owner.
   * An admin may turn it off and read the rest.
   */
  can_change: boolean;
  /**
   * The receiving servers the recent mail named, newest first — what an owner
   * names `authserv_id` from, read off a real delivery (M1).
   */
  authserv_seen: string[];
  example_domain: string;
  updated_at: number | null;
  updated_by: InboundPersonView | null;
  /** The newest inbound mails, newest first, in spaces the caller can open. */
  recent: EmailInboundRowView[];
}

/** `OrgView.email_inbound` (§6.4): readable by everyone, so a space can show its address. */
export interface OrgEmailInboundView {
  enabled: boolean;
  domain: string | null;
}

/** `GET /projects/:slug/email-address`. */
export interface ProjectEmailAddressView {
  /** `<slug>-<token>@<domain>`; null until the organisation has a receiving domain. */
  address: string | null;
  /** The organisation's switch: off, mail to the address is recorded and dropped. */
  enabled: boolean;
  /** Whether the caller may replace it (`project.settings.edit`). */
  can_rotate: boolean;
}

/** The receiving servers recent mail named, newest first, each once. */
function authservSeen(rows: readonly { authserv_ids: readonly string[] }[]): string[] {
  return [...new Set(rows.flatMap((r) => r.authserv_ids))];
}

type SettingsRow = typeof orgEmailInbound.$inferSelect;

function settingsRow(db: Db): SettingsRow | undefined {
  return db.select().from(orgEmailInbound).limit(1).get();
}

function personView(db: Db, userId: string | null): InboundPersonView | null {
  if (userId === null) return null;
  return (
    db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, userId)).get() ??
    null
  );
}

/** `OrgView.email_inbound`. */
export function orgEmailInboundView(db: Db): OrgEmailInboundView {
  const row = settingsRow(db);
  return { enabled: row?.enabled === 1, domain: row?.domain ?? null };
}

function recentRows(db: Db, actor: ResolvedActor): EmailInboundRowView[] {
  const rows = db
    .select({
      row: emailInbound,
      project: {
        id: projects.id,
        slug: projects.slug,
        name: projects.name,
        prefix: projects.prefix,
      },
      taskNumber: tasks.number,
    })
    .from(emailInbound)
    .leftJoin(projects, eq(projects.id, emailInbound.projectId))
    .leftJoin(tasks, eq(tasks.id, emailInbound.taskId))
    .orderBy(desc(emailInbound.receivedAt), desc(emailInbound.id))
    .limit(RECENT_INBOUND * 3)
    .all();
  return (
    rows
      // A space the caller cannot open is not named to them, nor its mail.
      .filter(
        ({ project }) =>
          project === null ||
          can(withProject(actor, project.id), 'project.read', { projectId: project.id }),
      )
      .slice(0, RECENT_INBOUND)
      .map(({ row, project, taskNumber }) => ({
        id: row.id,
        received_at: row.receivedAt,
        outcome: row.outcome,
        reason: row.reason,
        from_address: row.fromAddress === '' ? null : row.fromAddress,
        sender: personView(db, row.userId),
        project: project === null ? null : { slug: project.slug, name: project.name },
        task_key:
          project === null || taskNumber === null
            ? null
            : `${project.prefix}-${String(taskNumber)}`,
        comment_id: row.commentId,
        auth: row.auth,
        authserv_ids: (row.authservIds ?? '').split(' ').filter((id) => id !== ''),
        attachment_count: row.attachmentCount,
      }))
  );
}

/** `GET /org/email-inbound` (§6.4, D-155). */
export function getEmailInboundSettings(
  db: Db,
  actor: ResolvedActor,
  publicUrl = '',
  serverSecret = '',
): EmailInboundSettingsView {
  assertCan(actor, 'org.email.configure');
  const row = settingsRow(db);
  const base = publicUrl.replace(/\/+$/, '');
  const recent = recentRows(db, actor);
  const owner = actor.orgRole === 'owner';
  return {
    enabled: row?.enabled === 1,
    domain: row?.domain ?? null,
    require_authenticated: (row?.requireAuthenticated ?? 1) === 1,
    authserv_id: row?.authservId ?? null,
    token_last4: row?.tokenLast4 ?? null,
    api_key_last4: row?.apiKeyLast4 ?? null,
    webhook_url: base === '' ? null : `${base}/webhooks/email`,
    own_address: boardFromAddress(db),
    can_store_secrets: serverSecret !== '',
    can_change: owner,
    authserv_seen: authservSeen(recent),
    example_domain: EXAMPLE_INBOUND_DOMAIN,
    updated_at: row?.updatedBy == null ? null : row.updatedAt,
    updated_by: personView(db, row?.updatedBy ?? null),
    recent,
  };
}

/** `PUT /org/email-inbound`: every field optional; one absent is left alone. */
export interface SetEmailInboundInput {
  enabled?: boolean | undefined;
  /** `null` clears it — and the switch with it. */
  domain?: string | null | undefined;
  require_authenticated?: boolean | undefined;
  authserv_id?: string | null | undefined;
  /** Write-only. `null` removes the stored key. */
  api_key?: string | null | undefined;
}

/** A host name, lower case: labels of letters, digits and inner hyphens. */
const HOST_NAME =
  /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

function refuse(field: string, message: string): never {
  throw new ApiError('unprocessable', message, { field });
}

function ownerOnly(field: string): ApiError {
  return new ApiError(
    'forbidden',
    'Only an owner may change Email to tasks; an admin may turn it off',
    { field, reason: 'owner_only' },
  );
}

function ensureRow(db: Db, now: number): string {
  const orgId = requireOrgId(db);
  db.insert(orgEmailInbound)
    .values({ orgId, enabled: 0, requireAuthenticated: 1, updatedAt: now })
    .onConflictDoNothing()
    .run();
  return orgId;
}

/** `PUT /org/email-inbound` (§6.4, D-155). */
export function setEmailInboundSettings(
  db: Db,
  actor: ResolvedActor,
  input: SetEmailInboundInput,
  serverSecret: string,
  publicUrl = '',
  now: number = Date.now(),
): EmailInboundSettingsView {
  assertCan(actor, 'org.email.configure');

  const domain =
    input.domain === undefined || input.domain === null
      ? input.domain
      : input.domain.trim().toLowerCase().replace(/\.$/, '');
  if (typeof domain === 'string' && !HOST_NAME.test(domain)) {
    refuse('domain', `domain must be a host name, such as ${EXAMPLE_INBOUND_DOMAIN}`);
  }
  // An empty name is no name: nothing is believed until one is given.
  const authserv =
    input.authserv_id === undefined
      ? undefined
      : (input.authserv_id ?? '').trim().toLowerCase() || null;
  if (typeof authserv === 'string' && !/^[a-z0-9][a-z0-9.-]{0,252}$/.test(authserv)) {
    refuse('authserv_id', 'authserv_id must be a server name, such as mx.example.com');
  }
  const apiKey =
    input.api_key === undefined || input.api_key === null ? input.api_key : input.api_key.trim();
  if (typeof apiKey === 'string' && !/^\S{8,512}$/.test(apiKey)) {
    refuse('api_key', 'api_key must be a Brevo API key, with no spaces');
  }
  if (typeof apiKey === 'string' && serverSecret === '') {
    throw new ApiError('internal', 'This server cannot store secrets');
  }

  // **Every change but turning it off is an owner's** (LAI-1315 review, M2,
  // rounds 1 and 2). Turning it on accepts D-155's residual risk, and turning
  // authentication off widens it — but so does every other write: a new
  // domain or receiving server, a new key, let whoever makes them write a
  // mail's verdict themselves. `org.email.configure` reaches admins; an admin
  // may turn Email to tasks off, and nothing else.
  if (actor.orgRole !== 'owner') {
    const changing = (
      [
        ['enabled', input.enabled === true],
        ['domain', domain !== undefined],
        ['require_authenticated', input.require_authenticated !== undefined],
        ['authserv_id', authserv !== undefined],
        ['api_key', apiKey !== undefined],
      ] as const
    ).find(([, changed]) => changed);
    if (changing !== undefined) throw ownerOnly(changing[0]);
  }

  const orgId = ensureRow(db, now);
  const current = settingsRow(db)!;
  const nextDomain = domain === undefined ? current.domain : domain;
  // Clearing the domain turns the switch off with it: there is nowhere to receive.
  const nextEnabled = domain === null ? false : (input.enabled ?? current.enabled === 1);
  const nextRequire = input.require_authenticated ?? current.requireAuthenticated === 1;
  const nextAuthserv = authserv === undefined ? current.authservId : authserv;

  if (nextEnabled && (nextDomain === null || current.tokenHash === null)) {
    throw new ApiError(
      'unprocessable',
      'Email to tasks needs a receiving domain and a webhook token before it can be turned on',
      { field: 'enabled', reason: 'inbound_not_configured' },
    );
  }
  // With no server named nothing is believed, so every mail would be dropped:
  // name it from a real delivery first (M1).
  if (nextEnabled && nextRequire && nextAuthserv === null) {
    throw new ApiError(
      'unprocessable',
      'Name the receiving server, from a real delivery, before Email to tasks is turned on',
      { field: 'authserv_id', reason: 'authserv_required' },
    );
  }

  db.update(orgEmailInbound)
    .set({
      enabled: nextEnabled ? 1 : 0,
      ...(domain === undefined ? {} : { domain }),
      ...(input.require_authenticated === undefined
        ? {}
        : { requireAuthenticated: input.require_authenticated ? 1 : 0 }),
      ...(authserv === undefined ? {} : { authservId: authserv }),
      ...(apiKey === undefined
        ? {}
        : apiKey === null
          ? { apiKeyEnc: null, apiKeyLast4: null }
          : {
              apiKeyEnc: encryptSecret(apiKey, serverSecret, 'brevo_api_key'),
              apiKeyLast4: apiKey.slice(-4),
            }),
      updatedBy: actor.userId,
      updatedAt: now,
    })
    .where(eq(orgEmailInbound.orgId, orgId))
    .run();
  return getEmailInboundSettings(db, actor, publicUrl, serverSecret);
}

/** `POST /org/email-inbound/token`: the new token, said once. */
export interface EmailInboundTokenView {
  /** Paste it into Brevo's webhook as its bearer token. It is not shown again. */
  token: string;
  settings: EmailInboundSettingsView;
}

/**
 * `POST /org/email-inbound/token` (§6.4, D-155) — make the webhook's bearer
 * token, replacing any before it: Brevo's webhook then needs the new one, and
 * a delivery with the old one is refused from this moment.
 */
export function rotateEmailInboundToken(
  db: Db,
  actor: ResolvedActor,
  publicUrl = '',
  now: number = Date.now(),
  serverSecret = '',
): EmailInboundTokenView {
  assertCan(actor, 'org.email.configure');
  // A new bearer is a delivery the holder writes themselves, verdicts and all (M2).
  if (actor.orgRole !== 'owner') throw ownerOnly('token');
  const orgId = ensureRow(db, now);
  const token = randomBytes(32).toString('base64url');
  db.update(orgEmailInbound)
    .set({
      tokenHash: digest(token).toString('hex'),
      tokenLast4: token.slice(-4),
      updatedBy: actor.userId,
      updatedAt: now,
    })
    .where(eq(orgEmailInbound.orgId, orgId))
    .run();
  return { token, settings: getEmailInboundSettings(db, actor, publicUrl, serverSecret) };
}

/**
 * Whether an `Authorization` header carries the webhook's bearer token.
 *
 * **Both sides are hashed to 32 bytes first**, so `timingSafeEqual` always
 * compares two buffers of one length: a token of the wrong length neither
 * throws nor answers faster. No token stored is no token accepted — an
 * organisation that has not made one has not agreed to receive anything.
 */
export function verifyInboundToken(db: Db, authorization: string | undefined): boolean {
  const stored = settingsRow(db)?.tokenHash ?? null;
  if (stored === null) return false;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(authorization ?? '');
  const given = digest(match?.[1] ?? '');
  return timingSafeEqual(given, Buffer.from(stored, 'hex'));
}

// ----------------------------------------------------------------- addresses

function addressOf(slug: string, token: string, domain: string | null): string | null {
  if (domain === null) return null;
  // A local part is at most 64 characters; the token and its hyphen take 13.
  return `${slug.slice(0, 51)}-${token}@${domain}`;
}

function ensureAddress(db: Db, projectId: string, userId: string, now: number): string {
  const existing = db
    .select({ token: projectInboundAddresses.token })
    .from(projectInboundAddresses)
    .where(eq(projectInboundAddresses.projectId, projectId))
    .get();
  if (existing !== undefined) return existing.token;
  const token = newAddressToken();
  db.insert(projectInboundAddresses)
    .values({ projectId, token, createdBy: userId, createdAt: now })
    .onConflictDoNothing()
    .run();
  return (
    db
      .select({ token: projectInboundAddresses.token })
      .from(projectInboundAddresses)
      .where(eq(projectInboundAddresses.projectId, projectId))
      .get()?.token ?? token
  );
}

function addressView(
  db: Db,
  actor: ResolvedActor,
  project: { id: string; slug: string },
  token: string,
): ProjectEmailAddressView {
  const settings = orgEmailInboundView(db);
  return {
    address: addressOf(project.slug, token, settings.domain),
    enabled: settings.enabled,
    can_rotate: can(withProject(actor, project.id), 'project.settings.edit', {
      projectId: project.id,
    }),
  };
}

/**
 * `GET /projects/:slug/email-address` (§6.4, D-155) — for anyone who may
 * create a task in the space, since that is what mailing it does. The token is
 * made the first time anyone asks.
 */
export function getProjectEmailAddress(
  db: Db,
  actor: ResolvedActor,
  slug: string,
  now: number = Date.now(),
): ProjectEmailAddressView {
  const project = requireReadableProjectBySlug(db, actor, slug);
  assertCan(withProject(actor, project.id), 'task.create', { projectId: project.id });
  return addressView(db, actor, project, ensureAddress(db, project.id, actor.userId, now));
}

/**
 * `POST /projects/:slug/email-address/rotate` (§6.4, D-155) — a new token; the
 * old address stops at once. `project.settings.edit`: whoever runs the space
 * decides when its address has leaked.
 */
export function rotateProjectEmailAddress(
  db: Db,
  actor: ResolvedActor,
  slug: string,
  now: number = Date.now(),
): ProjectEmailAddressView {
  const project = requireReadableProjectBySlug(db, actor, slug);
  assertCan(withProject(actor, project.id), 'project.settings.edit', { projectId: project.id });
  // Sixty bits make a collision all but impossible; the unique index makes it harmless.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = newAddressToken();
    const taken = db
      .select({ projectId: projectInboundAddresses.projectId })
      .from(projectInboundAddresses)
      .where(eq(projectInboundAddresses.token, token))
      .get();
    if (taken !== undefined) continue;
    db.insert(projectInboundAddresses)
      .values({ projectId: project.id, token, createdBy: actor.userId, createdAt: now })
      .onConflictDoUpdate({
        target: projectInboundAddresses.projectId,
        set: { token, createdBy: actor.userId, createdAt: now },
      })
      .run();
    return addressView(db, actor, project, token);
  }
  throw new ApiError('internal', 'A new address could not be made');
}

// -------------------------------------------------------------- receiving

/**
 * What became of one mail at one address — the webhook's answer, ids and
 * reasons only. `failed` is a fault, not a decision: nothing the mail would
 * have written was kept, only a record that it failed, which Brevo's retry
 * tries again — three faults, and it is `dropped` `failed_repeatedly` (F3).
 */
export interface InboundItemOutcome {
  outcome: EmailInboundOutcome | 'duplicate';
  reason: EmailInboundReason | null;
}

/** A row to record, before its outcome is known. */
interface InboundRecord {
  mail: InboundMail;
  addressToken: string;
  projectId: string | null;
  userId: string | null;
  auth: string | null;
  authservIds: string | null;
  /** Deliveries of it that failed before this one. */
  attempts: number;
}

function recordInbound(
  db: Db,
  rec: InboundRecord,
  outcome: EmailInboundOutcome,
  reason: EmailInboundReason | null,
  ids: { taskId?: string; commentId?: string },
  now: number,
): string {
  const id = newId();
  db.insert(emailInbound)
    .values({
      id,
      messageId: rec.mail.messageId,
      addressToken: rec.addressToken,
      projectId: rec.projectId,
      fromAddress: rec.mail.from ?? '',
      userId: rec.userId,
      outcome,
      reason,
      taskId: ids.taskId ?? null,
      commentId: ids.commentId ?? null,
      auth: rec.auth,
      authservIds: rec.authservIds,
      attachmentCount: rec.mail.attachments.length,
      attempts: rec.attempts,
      receivedAt: now,
    })
    .run();
  return id;
}

/** The task a reply belongs to, in this space: by its thread, else by `[KEY-N]` in its subject. */
function replyTarget(db: Db, projectId: string, mail: InboundMail): string | null {
  if (mail.replyTo.length > 0) {
    const thread = db
      .select({ taskId: emailInbound.taskId })
      .from(emailInbound)
      .innerJoin(tasks, eq(tasks.id, emailInbound.taskId))
      .where(
        and(
          eq(emailInbound.projectId, projectId),
          inArray(emailInbound.messageId, mail.replyTo),
          isNotNull(emailInbound.taskId),
        ),
      )
      .orderBy(desc(emailInbound.receivedAt))
      .limit(1)
      .get();
    if (thread?.taskId != null) return thread.taskId;
  }
  const key = subjectKey(mail.subject);
  if (key === null) return null;
  const taskId = resolveTaskRef(db, key);
  const task = db
    .select({ id: tasks.id, projectId: tasks.projectId })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .get();
  // A key naming a task in another space is not a reply to this one.
  return task?.projectId === projectId ? task.id : null;
}

/** Why the sender may not have this mail written as them, before anything is written. */
function dropReason(
  settings: SettingsRow,
  mail: InboundMail,
  ownAddress: string,
  authPass: boolean,
): EmailInboundReason | null {
  const domain = settings.domain ?? '';
  if (
    mail.from !== null &&
    (mail.from === ownAddress ||
      domainOf(mail.from) === domain ||
      domainOf(mail.from).endsWith(`.${domain}`))
  ) {
    return 'own_sender';
  }
  if (isAutomatic(mail.headers)) return 'auto_reply';
  if (mail.spamScore !== null && mail.spamScore >= SPAM_SCORE_LINE) return 'spam';
  if (settings.requireAuthenticated === 1 && !authPass) return 'unauthenticated';
  if (mail.from === null) return 'unknown_sender';
  return null;
}

/** An `ApiError` from the write, as a reason; anything else is a fault and rethrown. */
function refusalReason(cause: unknown): EmailInboundReason {
  if (!(cause instanceof ApiError)) throw cause;
  return cause.code === 'forbidden' || cause.code === 'not_found' ? 'not_allowed' : 'refused';
}

/**
 * One mail at one space's address: dropped with its reason, or written as its
 * sender. **One transaction**: the record that claims the mail, and the task
 * or comment it makes, land together or not at all — so a redelivery finds
 * the record and makes nothing twice, and a failure leaves nothing half-made.
 */
function receiveAtAddress(
  sqlite: Database.Database,
  db: Db,
  settings: SettingsRow | undefined,
  mail: InboundMail,
  token: string,
  ownAddress: string,
  now: number,
): InboundItemOutcome {
  return sqlite
    .transaction((): InboundItemOutcome => {
      const seen = db
        .select({
          id: emailInbound.id,
          outcome: emailInbound.outcome,
          attempts: emailInbound.attempts,
        })
        .from(emailInbound)
        .where(sameMail(mail, token))
        .get();
      // A mail decided about is decided. One that failed before is tried again:
      // its record goes, and this attempt writes the next — or, if it fails
      // again, the rollback keeps it for `recordFault` to count.
      if (seen !== undefined && seen.outcome !== 'failed') {
        return { outcome: 'duplicate', reason: null };
      }
      if (seen !== undefined) db.delete(emailInbound).where(eq(emailInbound.id, seen.id)).run();

      const project =
        token === ''
          ? undefined
          : db
              .select({ id: projects.id, slug: projects.slug })
              .from(projectInboundAddresses)
              .innerJoin(projects, eq(projects.id, projectInboundAddresses.projectId))
              .where(eq(projectInboundAddresses.token, token))
              .get();
      const auth =
        mail.from === null
          ? { pass: false, summary: null }
          : authVerdict(mail.headers, mail.from, settings?.authservId ?? null);
      const rec: InboundRecord = {
        mail,
        addressToken: token,
        projectId: project?.id ?? null,
        userId: null,
        auth: auth.summary,
        authservIds: authservIds(mail.headers).join(' ').slice(0, 300) || null,
        attempts: seen?.attempts ?? 0,
      };
      const drop = (reason: EmailInboundReason): InboundItemOutcome => {
        recordInbound(db, rec, 'dropped', reason, {}, now);
        return { outcome: 'dropped', reason };
      };

      // The switch first: off is off, whatever the mail is.
      if (settings?.enabled !== 1) return drop('switch_off');
      if (project === undefined) return drop('unknown_address');
      const early = dropReason(settings, mail, ownAddress, auth.pass);
      if (early !== null) return drop(early);

      const sender = db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.email, mail.from!), eq(users.isActive, 1)))
        .get();
      const actor = sender === undefined ? null : loadActor(db, sender.id);
      if (sender === undefined || actor === null) return drop('unknown_sender');
      rec.userId = sender.id;

      const target = replyTarget(db, project.id, mail);
      if (target === null && mail.subject === '' && mail.text === '') return drop('empty');
      if (target !== null && mail.text === '') return drop('empty');

      let written: { taskId: string; commentId?: string; outcome: EmailInboundOutcome };
      try {
        // A savepoint of its own: a refusal part-way leaves nothing behind.
        written = sqlite.transaction(() => {
          if (target !== null) {
            const comment = addComment(db, actor, target, mail.text, now, 'webhook');
            return { taskId: target, commentId: comment.id, outcome: 'comment_added' as const };
          }
          const task = createTask(sqlite, db, actor, project.slug, {
            title: taskTitle(mail.subject),
            ...(mail.text === '' ? {} : { description_md: mail.text }),
            created_via: 'webhook',
            now,
          });
          return { taskId: task.id, outcome: 'task_created' as const };
        })();
      } catch (cause) {
        return drop(refusalReason(cause));
      }

      const inboundId = recordInbound(
        db,
        rec,
        written.outcome,
        null,
        written.commentId === undefined
          ? { taskId: written.taskId }
          : { taskId: written.taskId, commentId: written.commentId },
        now,
      );
      // Each announced file waits for the attachments job (LAI-1315, PR B).
      for (const file of mail.attachments) {
        db.insert(emailInboundAttachments)
          .values({
            id: newId(),
            inboundId,
            downloadToken: file.downloadToken,
            filename: file.filename,
            contentType: file.contentType,
            sizeBytes: file.sizeBytes,
            state: 'pending',
            createdAt: now,
          })
          .run();
      }
      return { outcome: written.outcome, reason: null };
    })
    .immediate();
}

/**
 * The record of this mail, at this address, **from this sender** (round 3):
 * the same Message-ID from another sender is another mail — so a forged one
 * with a predicted id neither pre-claims the real one as a `duplicate` nor
 * takes over its `failed` record.
 */
function sameMail(mail: InboundMail, token: string) {
  return and(
    eq(emailInbound.messageId, mail.messageId),
    eq(emailInbound.addressToken, token),
    eq(emailInbound.fromAddress, mail.from ?? ''),
  );
}

/** A mail that fails this many times as it arrives is recorded and given up on. */
export const INBOUND_FAILURES_MAX = 3;

/**
 * A mail whose receiving faulted (round 2, F3): counted on its record, outside
 * the transaction that rolled back. Under {@link INBOUND_FAILURES_MAX} it is
 * `failed`, and the route asks Brevo to deliver again; at it, it is `dropped`
 * `failed_repeatedly` and answered, so a mail that can never be received —
 * a poison mail — stops coming back. Either way the card shows it.
 */
function recordFault(
  sqlite: Database.Database,
  db: Db,
  mail: InboundMail,
  token: string,
  now: number,
): InboundItemOutcome {
  return sqlite
    .transaction((): InboundItemOutcome => {
      const seen = db
        .select({ id: emailInbound.id, attempts: emailInbound.attempts })
        .from(emailInbound)
        .where(sameMail(mail, token))
        .get();
      const attempts = (seen?.attempts ?? 0) + 1;
      const final = attempts >= INBOUND_FAILURES_MAX;
      const outcome = final ? ('dropped' as const) : ('failed' as const);
      const reason = final ? ('failed_repeatedly' as const) : null;
      if (seen !== undefined) {
        db.update(emailInbound)
          .set({ outcome, reason, attempts, receivedAt: now })
          .where(eq(emailInbound.id, seen.id))
          .run();
      } else {
        const project =
          token === ''
            ? undefined
            : db
                .select({ id: projectInboundAddresses.projectId })
                .from(projectInboundAddresses)
                .where(eq(projectInboundAddresses.token, token))
                .get();
        db.insert(emailInbound)
          .values({
            id: newId(),
            messageId: mail.messageId,
            addressToken: token,
            projectId: project?.id ?? null,
            fromAddress: mail.from ?? '',
            userId: null,
            outcome,
            reason,
            taskId: null,
            commentId: null,
            auth: null,
            authservIds: authservIds(mail.headers).join(' ').slice(0, 300) || null,
            attachmentCount: mail.attachments.length,
            attempts,
            receivedAt: now,
          })
          .run();
      }
      return { outcome, reason };
    })
    .immediate();
}

/**
 * `POST /webhooks/email` once the bearer token holds (§10.3, D-155): every
 * mail in the delivery, at every space address it was sent to. A mail sent to
 * no space's address is recorded once, `unknown_address`.
 *
 * Resolving the address and the sender reads before anyone is known, so it is
 * `system.email.receive` (§3.4); everything written after is the sender's own
 * `can()`.
 */
export function receiveInboundEmail(
  sqlite: Database.Database,
  db: Db,
  payload: unknown,
  now: number = Date.now(),
  /** Told of each mail that failed for a reason that was not a decision. */
  onFault?: (cause: unknown) => void,
): InboundItemOutcome[] {
  assertCan(systemPrincipal(), 'system.email.receive');
  const items = (payload as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) {
    throw new ApiError('unprocessable', 'A delivery is { "items": [ … ] }', { field: 'items' });
  }
  if (items.length > INBOUND_ITEMS_MAX) {
    throw new ApiError(
      'unprocessable',
      `A delivery carries at most ${String(INBOUND_ITEMS_MAX)} mails`,
      {
        field: 'items',
      },
    );
  }

  const settings = settingsRow(db);
  const ownAddress = boardFromAddress(db);
  const results: InboundItemOutcome[] = [];
  for (const item of items) {
    const mail = readInboundMail(item);
    if (mail === null) continue;
    const domain = settings?.domain ?? null;
    const tokens = [
      ...new Set(
        domain === null
          ? []
          : mail.recipients
              .map((r) => addressToken(r, domain))
              .filter((t): t is string => t !== null),
      ),
    ];
    for (const token of tokens.length === 0 ? [''] : tokens) {
      // **One mail's fault is its own** (LAI-1315 review, F3): its transaction
      // rolled back, so nothing it would have written is kept, and the mails
      // after it are still received. Its record says `failed`, and the route
      // asks Brevo to deliver again — a `duplicate` for every mail that landed,
      // another try for this one, and on the third fault `failed_repeatedly`,
      // answered, so a poison mail stops coming back.
      try {
        results.push(receiveAtAddress(sqlite, db, settings, mail, token, ownAddress, now));
      } catch (cause) {
        onFault?.(cause);
        results.push(recordFault(sqlite, db, mail, token, now));
      }
    }
  }
  return results;
}

/** Inbound retention (§11.6): records 90 days old, under `system.email.prune`. */
export function pruneEmailInbound(db: Db, now: number): number {
  assertCan(systemPrincipal(), 'system.email.prune');
  return db
    .delete(emailInbound)
    .where(lt(emailInbound.receivedAt, now - INBOUND_RETENTION_MS))
    .run().changes;
}
